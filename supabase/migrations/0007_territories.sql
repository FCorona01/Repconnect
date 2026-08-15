-- ===========================================================================
-- 0007_territories
--
-- Sales territory is not a string. "Southwest", "California", "Los Angeles
-- Metro", and "nationwide" must all interoperate, in both directions:
--
--   a rep covering California       matches an opportunity in Los Angeles
--   a rep covering Los Angeles only matches an opportunity scoped to California
--   a rep covering the United States matches everything inside it
--
-- An ltree hierarchy answers all three with one indexed predicate
-- (app.paths_overlap). A flat text column answers none of them.
--
-- ---------------------------------------------------------------------------
-- ON "REMOTE / NATIONWIDE"
-- ---------------------------------------------------------------------------
-- These are represented by NODES IN THE TREE, not by a separate parallel
-- concept:
--
--   * "Nationwide (US)"  IS the `united-states` node — it is the ancestor of
--     every US region, state and metro, so it already matches all of them.
--   * "Anywhere / Fully Remote" IS the root node, ancestor of everything.
--
-- A separate "Remote" node would be a SECOND way to say the same thing, and
-- two vocabularies for one concept is precisely what makes a marketplace fail
-- to match. One rep picks "Remote", another picks "United States", and they
-- never appear in the same result set.
--
-- The genuinely different question — whether the work is done from a desk or
-- in the field — is not a geography question at all. It is captured by
-- `sales_models` ("Inside Sales" vs "Field / Outside Sales") and, on the
-- opportunity, by `is_remote`. Territory says WHERE; sales model says HOW.
-- ===========================================================================

create type territory_kind as enum (
  'global',       -- the root: anywhere / fully remote
  'country',      -- also means "nationwide" for that country
  'region',       -- census region, or a grouping of provinces
  'subdivision',  -- US state or district, Canadian province or territory
  'metro'         -- metropolitan / census metropolitan area
);

create table territories (
  id               uuid primary key default app.uuid_generate_v7(),

  slug             text not null,
  name             text not null,
  kind             territory_kind not null,

  -- 'State', 'District', 'Province', 'Territory'. Kept as free display text
  -- rather than baked into `kind` because calling Nunavut a province is simply
  -- wrong, and a schema that forces a false statement will produce false data.
  subdivision_type text,

  -- ISO 3166-1 alpha-2 for countries, alpha-2 subdivision code for states and
  -- provinces (CA, NY, ON, BC). Null for regions and metros.
  iso_code         text,

  parent_id        uuid references territories (id) on delete restrict,

  -- Derived by trigger from parent_id; never written by application code. The
  -- default exists only so callers can omit it on insert. See the CHECK below.
  path             ltree not null default ''::ltree,

  sort_order       int not null default 0,
  is_active        boolean not null default true,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint territories_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80),
  constraint territories_name_not_blank check (length(btrim(name)) > 0),
  -- Exactly one root, structurally: only the global node may have no parent.
  constraint territories_root_is_global
    check ((parent_id is null) = (kind = 'global')),
  constraint territories_subdivision_has_type
    check (kind <> 'subdivision' or subdivision_type is not null),
  -- Safety net: a dropped path trigger becomes a loud failure, not silent
  -- hierarchy corruption that only shows up as wrong matching results.
  constraint territories_path_derived check (nlevel(path) >= 1)
);

create unique index territories_slug_key on territories (slug);
create unique index territories_path_key on territories (path);

-- The index that makes ancestor/descendant matching fast. Without it every
-- territory overlap check is a sequential scan.
create index territories_path_gist on territories using gist (path);

create index territories_parent_idx on territories (parent_id);
create index territories_kind_idx on territories (kind) where is_active;

-- Only one root node can ever exist.
create unique index territories_single_root on territories ((true)) where parent_id is null;

create trigger territories_set_path
  before insert or update of slug, parent_id on territories
  for each row execute function app.taxonomy_set_path();

create trigger territories_freeze_slug
  before update on territories
  for each row execute function app.taxonomy_freeze_slug();

create trigger territories_repath_descendants
  after update on territories
  for each row execute function app.taxonomy_repath_descendants();

create trigger territories_touch_updated_at
  before update on territories
  for each row execute function app.touch_updated_at();

select app.apply_taxonomy_rls('territories');

-- ---------------------------------------------------------------------------
-- Convenience read helper for pickers and profile rendering: the ancestors of
-- a territory, root first, so the UI can show "California › Los Angeles Metro"
-- without N queries.
-- ---------------------------------------------------------------------------
create or replace function app.territory_ancestors(p_territory_id uuid)
returns table (id uuid, slug text, name text, kind territory_kind, depth int)
language sql
stable
set search_path = public, app, extensions, pg_temp
as $$
  select a.id, a.slug, a.name, a.kind, nlevel(a.path) as depth
  from territories t
  join territories a on a.path @> t.path
  where t.id = p_territory_id
  order by nlevel(a.path);
$$;

grant execute on function app.territory_ancestors(uuid) to app_user;
