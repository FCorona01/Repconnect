-- ===========================================================================
-- 0006_taxonomy
--
-- The shared vocabulary. Both sides of the marketplace must describe the world
-- using the same words or matching is impossible, so none of these are free
-- text — they are admin-managed controlled vocabularies.
--
-- Two shapes:
--   * hierarchical (industries, product_categories) — a rep who says
--     "Healthcare" must match an opportunity in "Medical Devices"
--   * flat (customer_types, sales_models, compensation_types)
--
-- Hierarchical taxonomies carry an ltree `path` alongside `parent_id`, for the
-- same reason territories do: overlap must work in BOTH directions. A rep
-- covering a parent matches an opportunity in a child, and vice versa. A
-- parent_id alone can express the tree but cannot answer that question in one
-- indexed predicate.
--
-- DESIGN COMMITMENT: this schema is deliberately industry-agnostic. Adding
-- industries, sub-categories or whole new branches later is INSERT-only work —
-- no schema change, no migration of user data. Depth is unbounded.
-- ===========================================================================

create extension if not exists ltree;

-- ---------------------------------------------------------------------------
-- Path helpers
--
-- ltree labels are restricted to [A-Za-z0-9_] on PostgreSQL before 16, so
-- slugs (hyphenated, used in URLs) and path labels (underscored) are kept as
-- separate representations rather than assuming hyphens are legal.
-- ---------------------------------------------------------------------------
create or replace function app.slug_to_label(p_slug text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(p_slug, '-', '_');
$$;

/**
 * True when two hierarchy paths overlap in either direction.
 *
 * This single rule is what makes the taxonomy feel intelligent:
 *   'healthcare'                  @> 'healthcare.medical_devices'  → parent matches child
 *   'healthcare.medical_devices'  <@ 'healthcare'                  → child matches parent
 *   'healthcare'                  vs 'software'                    → no match
 *
 * search_path includes `extensions` because Supabase installs extensions there
 * rather than in public; naming both keeps this portable.
 */
create or replace function app.paths_overlap(a ltree, b ltree)
returns boolean
language sql
immutable
parallel safe
set search_path = public, extensions, pg_temp
as $$
  select a is not null and b is not null and (a @> b or a <@ b);
$$;

-- ---------------------------------------------------------------------------
-- Hierarchy maintenance
--
-- `path` is never written by application code. These triggers derive it from
-- parent_id, so the tree cannot be left inconsistent by a bad insert or a
-- forgotten update. Hierarchy integrity is a database guarantee, not a
-- seeding convention.
--
-- Generic over any table with (id, slug, parent_id, path), so industries,
-- product_categories and territories all share one implementation.
-- ---------------------------------------------------------------------------
create or replace function app.taxonomy_set_path()
returns trigger
language plpgsql
set search_path = public, app, extensions, pg_temp
as $$
declare
  v_parent_path ltree;
  v_label       text;
begin
  v_label := app.slug_to_label(new.slug);

  if new.parent_id is null then
    new.path := v_label::ltree;
  else
    execute format('select path from %I where id = $1', tg_table_name)
      into v_parent_path
      using new.parent_id;

    if v_parent_path is null then
      raise exception 'Parent % does not exist in %', new.parent_id, tg_table_name
        using errcode = 'foreign_key_violation';
    end if;

    -- Re-parenting under one's own descendant would create a cycle and an
    -- infinite path. Refuse rather than corrupt the tree.
    if tg_op = 'UPDATE' and v_parent_path <@ old.path then
      raise exception 'Cannot move % under its own descendant', old.slug
        using errcode = 'check_violation';
    end if;

    new.path := v_parent_path || v_label::ltree;
  end if;

  return new;
end;
$$;

/**
 * Slugs are the permanent contract: they appear in URLs, in seed data and in
 * application code. Renaming a node's display name is free; changing its slug
 * is not, so it is refused outright.
 */
create or replace function app.taxonomy_freeze_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'Taxonomy slugs are immutable (% -> %). Deactivate this entry and create a new one instead.',
      old.slug, new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

/**
 * When a node moves, its whole subtree moves with it.
 * Without this, descendants keep a stale path and silently stop matching.
 */
create or replace function app.taxonomy_repath_descendants()
returns trigger
language plpgsql
set search_path = public, app, extensions, pg_temp
as $$
begin
  if new.path is distinct from old.path then
    execute format(
      'update %I
          set path = $1 || subpath(path, nlevel($2))
        where path <@ $2 and id <> $3',
      tg_table_name
    ) using new.path, old.path, new.id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared RLS policy shape for reference data
--
-- SELECT is public — anonymous visitors need filter options before they sign
-- up, and public opportunity pages render these names.
--
-- Reads are NOT filtered by is_active. A retired entry must still resolve, or
-- a profile that references it would render with a hole in it. Pickers filter
-- is_active in the query; history stays intact.
--
-- Writes are admin-only, everywhere, with no exceptions.
-- ---------------------------------------------------------------------------
create or replace function app.apply_taxonomy_rls(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := p_table::text;
begin
  execute format('alter table %s enable row level security', v_name);
  execute format('alter table %s force row level security', v_name);

  execute format(
    'create policy %I on %s for select using (true)',
    v_name || '_select_public', v_name);

  execute format(
    'create policy %I on %s for insert with check (app.is_admin())',
    v_name || '_insert_admin', v_name);

  execute format(
    'create policy %I on %s for update using (app.is_admin()) with check (app.is_admin())',
    v_name || '_update_admin', v_name);

  execute format(
    'create policy %I on %s for delete using (app.is_admin())',
    v_name || '_delete_admin', v_name);

  execute format('grant select, insert, update, delete on %s to app_user', v_name);
end;
$$;

-- ===========================================================================
-- Hierarchical vocabularies
-- ===========================================================================

create table industries (
  id          uuid primary key default app.uuid_generate_v7(),
  slug        text not null,
  name        text not null,
  description text,
  parent_id   uuid references industries (id) on delete restrict,
  -- Derived by trigger from parent_id; never written by application code.
  -- The default exists only so callers can omit the column on insert — the
  -- BEFORE trigger always replaces it. The CHECK below is the safety net: if
  -- the trigger were ever dropped, this turns silent hierarchy corruption into
  -- an immediate, loud failure.
  path        ltree not null default ''::ltree,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint industries_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80),
  constraint industries_name_not_blank check (length(btrim(name)) > 0),
  constraint industries_path_derived check (nlevel(path) >= 1)
);

create unique index industries_slug_key on industries (slug);
create unique index industries_path_key on industries (path);
create index industries_path_gist on industries using gist (path);
create index industries_parent_idx on industries (parent_id);

create trigger industries_set_path
  before insert or update of slug, parent_id on industries
  for each row execute function app.taxonomy_set_path();

create trigger industries_freeze_slug
  before update on industries
  for each row execute function app.taxonomy_freeze_slug();

create trigger industries_repath_descendants
  after update on industries
  for each row execute function app.taxonomy_repath_descendants();

create trigger industries_touch_updated_at
  before update on industries
  for each row execute function app.touch_updated_at();

select app.apply_taxonomy_rls('industries');

-- ---------------------------------------------------------------------------

create table product_categories (
  id          uuid primary key default app.uuid_generate_v7(),
  slug        text not null,
  name        text not null,
  description text,
  parent_id   uuid references product_categories (id) on delete restrict,
  -- Derived by trigger from parent_id; never written by application code.
  -- The default exists only so callers can omit the column on insert — the
  -- BEFORE trigger always replaces it. The CHECK below is the safety net: if
  -- the trigger were ever dropped, this turns silent hierarchy corruption into
  -- an immediate, loud failure.
  path        ltree not null default ''::ltree,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint product_categories_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80),
  constraint product_categories_name_not_blank check (length(btrim(name)) > 0),
  constraint product_categories_path_derived check (nlevel(path) >= 1)
);

create unique index product_categories_slug_key on product_categories (slug);
create unique index product_categories_path_key on product_categories (path);
create index product_categories_path_gist on product_categories using gist (path);
create index product_categories_parent_idx on product_categories (parent_id);

create trigger product_categories_set_path
  before insert or update of slug, parent_id on product_categories
  for each row execute function app.taxonomy_set_path();

create trigger product_categories_freeze_slug
  before update on product_categories
  for each row execute function app.taxonomy_freeze_slug();

create trigger product_categories_repath_descendants
  after update on product_categories
  for each row execute function app.taxonomy_repath_descendants();

create trigger product_categories_touch_updated_at
  before update on product_categories
  for each row execute function app.touch_updated_at();

select app.apply_taxonomy_rls('product_categories');

-- ===========================================================================
-- Flat vocabularies
--
-- Small, stable, closed sets. A hierarchy here would be false precision.
-- ===========================================================================

create table customer_types (
  id          uuid primary key default app.uuid_generate_v7(),
  slug        text not null,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint customer_types_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80)
);

create unique index customer_types_slug_key on customer_types (slug);

create trigger customer_types_freeze_slug
  before update on customer_types
  for each row execute function app.taxonomy_freeze_slug();

create trigger customer_types_touch_updated_at
  before update on customer_types
  for each row execute function app.touch_updated_at();

select app.apply_taxonomy_rls('customer_types');

-- ---------------------------------------------------------------------------

create table sales_models (
  id          uuid primary key default app.uuid_generate_v7(),
  slug        text not null,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint sales_models_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80)
);

create unique index sales_models_slug_key on sales_models (slug);

create trigger sales_models_freeze_slug
  before update on sales_models
  for each row execute function app.taxonomy_freeze_slug();

create trigger sales_models_touch_updated_at
  before update on sales_models
  for each row execute function app.touch_updated_at();

select app.apply_taxonomy_rls('sales_models');

-- ---------------------------------------------------------------------------

create table compensation_types (
  id          uuid primary key default app.uuid_generate_v7(),
  slug        text not null,
  name        text not null,
  description text,
  -- Whether this arrangement includes guaranteed money. Used as a HARD GATE in
  -- matching, not a score: a rep who needs a base salary must never be shown
  -- commission-only work, however well it matches on every other axis.
  has_guaranteed_pay boolean not null default false,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint compensation_types_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80)
);

create unique index compensation_types_slug_key on compensation_types (slug);

create trigger compensation_types_freeze_slug
  before update on compensation_types
  for each row execute function app.taxonomy_freeze_slug();

create trigger compensation_types_touch_updated_at
  before update on compensation_types
  for each row execute function app.touch_updated_at();

select app.apply_taxonomy_rls('compensation_types');
