-- ===========================================================================
-- 0009_rep_profiles
--
-- The sales professional. One profile per user, optional — a user may exist
-- without being a rep (they might only be part of a business).
--
-- ---------------------------------------------------------------------------
-- VISIBILITY IS THE LOAD-BEARING FIELD
-- ---------------------------------------------------------------------------
-- Many reps have a current employer. A rep who cannot control who sees their
-- profile will not create one, and reps are the scarce side of this
-- marketplace — so visibility is a first-class control, not a setting buried
-- in preferences, and it defaults to the guarded option rather than the open
-- one.
--
--   public           anyone, including search engines
--   businesses_only  signed-in members of a business (the default)
--   applied_only     only businesses this rep has applied to
--
-- PHASE 2 LIMITATION, DELIBERATE AND FAIL-CLOSED:
-- `applications` does not exist until Phase 4, so `applied_only` currently
-- resolves to owner-and-admin only. That is MORE restrictive than its final
-- behaviour, never less. Widening a permission later is safe; discovering you
-- shipped it too wide is not.
-- ===========================================================================

create extension if not exists pg_trgm;

create type rep_seniority as enum (
  'sdr',
  'ae',
  'senior_ae',
  'enterprise_ae',
  'sales_manager',
  'director',
  'vp',
  'cro'
);

create type rep_visibility as enum ('public', 'businesses_only', 'applied_only');

-- How deeply a rep knows an area. Distinct from the opportunity side, which
-- records whether an attribute is REQUIRED — that asymmetry is what lets
-- Phase 7 scoring tell "must have" from "nice to have".
create type rep_proficiency as enum ('familiar', 'experienced', 'expert');

-- ---------------------------------------------------------------------------
-- Does the caller belong to any business at all?
--
-- SECURITY DEFINER to avoid applying organization_members' own RLS inside a
-- policy that is being evaluated for a different table. Takes no arguments and
-- always resolves the caller from the request context, so it cannot be used to
-- ask about anyone else.
-- ---------------------------------------------------------------------------
create or replace function app.is_org_member_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = app.current_user_id()
      and m.accepted_at is not null
  );
$$;

revoke execute on function app.is_org_member_anywhere() from public;
grant execute on function app.is_org_member_anywhere() to app_user;

-- ===========================================================================
-- rep_profiles
-- ===========================================================================

create table rep_profiles (
  id                    uuid primary key default app.uuid_generate_v7(),
  user_id               uuid not null unique references users (id) on delete cascade,

  -- Public URL identity: /r/<slug>. Generated once from the person's name plus
  -- a short random suffix, then immutable — it is a link people put on
  -- LinkedIn, and a link that rots is worse than an ugly one.
  slug                  text not null,

  headline              text not null,
  bio                   text,

  years_experience      int,
  seniority             rep_seniority,

  avatar_file_id        uuid references files (id) on delete set null,
  linkedin_url          text,

  visibility            rep_visibility not null default 'businesses_only',
  open_to_work          boolean not null default true,

  -- Fractional and contract reps sell capacity, not just outcomes.
  availability_hours_per_week int,
  earliest_start_date   date,

  -- The hard gate in matching. NULL means "open to commission-only".
  min_base_required     numeric(12, 2),
  currency              char(3) not null default 'USD',

  -- Denormalised, recomputed on every write by the repository layer. Stored
  -- rather than derived because it drives ranking, and recomputing it across
  -- six join tables at query time does not scale.
  profile_completeness  int not null default 0,

  verification_status   verification_status not null default 'unverified',

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(bio, '')), 'B')
  ) stored,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint rep_profiles_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80),
  constraint rep_profiles_headline_not_blank
    check (length(btrim(headline)) between 1 and 160),
  constraint rep_profiles_bio_length check (bio is null or length(bio) <= 5000),
  constraint rep_profiles_years_sane
    check (years_experience is null or years_experience between 0 and 60),
  constraint rep_profiles_hours_sane
    check (availability_hours_per_week is null or availability_hours_per_week between 1 and 80),
  constraint rep_profiles_min_base_sane
    check (min_base_required is null or min_base_required >= 0),
  constraint rep_profiles_completeness_range
    check (profile_completeness between 0 and 100)
);

create unique index rep_profiles_slug_key on rep_profiles (slug);
create index rep_profiles_search_idx on rep_profiles using gin (search_vector);
create index rep_profiles_headline_trgm on rep_profiles using gin (headline gin_trgm_ops);

-- Supports the rep directory in Phase 4: open, discoverable reps ranked by how
-- complete their profile is.
create index rep_profiles_discoverable_idx
  on rep_profiles (visibility, profile_completeness desc)
  where open_to_work;

create trigger rep_profiles_touch_updated_at
  before update on rep_profiles
  for each row execute function app.touch_updated_at();

-- Slugs are permanent public identifiers, exactly like taxonomy slugs.
create trigger rep_profiles_freeze_slug
  before update on rep_profiles
  for each row execute function app.taxonomy_freeze_slug();

-- ---------------------------------------------------------------------------
-- Visibility predicate.
--
-- Defined once and reused by every attribute table below, so a change to the
-- rule cannot be applied to the profile but forgotten on its industries.
-- ---------------------------------------------------------------------------
create or replace function app.can_view_rep_profile(
  p_visibility rep_visibility,
  p_owner_id   uuid
)
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select
    -- the owner, always
    p_owner_id = app.current_user_id()
    -- admins, always
    or app.is_admin()
    -- public profiles, anyone at all
    or p_visibility = 'public'
    -- businesses-only: signed in AND actually part of a business
    or (p_visibility = 'businesses_only' and app.is_org_member_anywhere());
    -- applied_only deliberately has no clause here: until `applications`
    -- exists in Phase 4 it falls through to owner/admin only. Fail closed.
$$;

grant execute on function app.can_view_rep_profile(rep_visibility, uuid) to app_user;

/**
 * The rep's display name, and nothing else.
 *
 * A profile is useless without the person's name, but the name lives in
 * `users`, whose RLS deliberately allows only self and admin — because that
 * row also holds the email address, and RLS is row-level, not column-level.
 * Opening `users` up to "anyone who can see this profile" would hand out email
 * addresses to every business browsing the directory.
 *
 * So instead of widening a policy, this SECURITY DEFINER function exposes
 * exactly one column, and only when the profile itself is visible to the
 * caller. It takes a profile id rather than a user id, so it cannot be used to
 * probe users who have no rep profile.
 */
create or replace function app.rep_display_name(p_rep_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.full_name
  from rep_profiles r
  join users u on u.id = r.user_id
  where r.id = p_rep_profile_id
    and app.can_view_rep_profile(r.visibility, r.user_id);
$$;

revoke execute on function app.rep_display_name(uuid) from public;
grant execute on function app.rep_display_name(uuid) to app_user;

alter table rep_profiles enable row level security;
alter table rep_profiles force row level security;

create policy rep_profiles_select on rep_profiles
  for select
  using (app.can_view_rep_profile(visibility, user_id));

-- A user may create exactly one profile, for themselves. The unique constraint
-- on user_id enforces the "one"; this policy enforces the "for themselves".
create policy rep_profiles_insert_self on rep_profiles
  for insert
  with check (user_id = app.current_user_id());

create policy rep_profiles_update_self on rep_profiles
  for update
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy rep_profiles_update_admin on rep_profiles
  for update
  using (app.is_admin())
  with check (app.is_admin());

create policy rep_profiles_delete_self on rep_profiles
  for delete
  using (user_id = app.current_user_id());

grant select, insert, update, delete on rep_profiles to app_user;

-- ===========================================================================
-- Attribute join tables
--
-- Visibility is NOT restated here. Each policy asks whether the parent profile
-- row is visible, and because rep_profiles has RLS enabled, that subquery is
-- itself filtered by the profile's own policy. Attribute visibility therefore
-- tracks profile visibility automatically and cannot drift out of step.
--
-- Taxonomy references are ON DELETE RESTRICT: a vocabulary entry in use cannot
-- be deleted, only retired (is_active = false). Matches migration 0006.
-- ===========================================================================

create or replace function app.owns_rep_profile(p_rep_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from rep_profiles r
    where r.id = p_rep_profile_id
      and r.user_id = app.current_user_id()
  );
$$;

revoke execute on function app.owns_rep_profile(uuid) from public;
grant execute on function app.owns_rep_profile(uuid) to app_user;

-- --- industries ------------------------------------------------------------
create table rep_industries (
  rep_profile_id uuid not null references rep_profiles (id) on delete cascade,
  industry_id    uuid not null references industries (id) on delete restrict,
  proficiency    rep_proficiency not null default 'experienced',
  years          int,
  created_at     timestamptz not null default now(),
  primary key (rep_profile_id, industry_id),
  constraint rep_industries_years_sane check (years is null or years between 0 and 60)
);

create index rep_industries_industry_idx on rep_industries (industry_id);

alter table rep_industries enable row level security;
alter table rep_industries force row level security;

create policy rep_industries_select on rep_industries
  for select
  using (exists (select 1 from rep_profiles r where r.id = rep_profile_id));

create policy rep_industries_write_owner on rep_industries
  for all
  using (app.owns_rep_profile(rep_profile_id) or app.is_admin())
  with check (app.owns_rep_profile(rep_profile_id) or app.is_admin());

grant select, insert, update, delete on rep_industries to app_user;

-- --- product categories ----------------------------------------------------
create table rep_product_categories (
  rep_profile_id      uuid not null references rep_profiles (id) on delete cascade,
  product_category_id uuid not null references product_categories (id) on delete restrict,
  proficiency         rep_proficiency not null default 'experienced',
  years               int,
  created_at          timestamptz not null default now(),
  primary key (rep_profile_id, product_category_id),
  constraint rep_product_categories_years_sane check (years is null or years between 0 and 60)
);

create index rep_product_categories_category_idx on rep_product_categories (product_category_id);

alter table rep_product_categories enable row level security;
alter table rep_product_categories force row level security;

create policy rep_product_categories_select on rep_product_categories
  for select
  using (exists (select 1 from rep_profiles r where r.id = rep_profile_id));

create policy rep_product_categories_write_owner on rep_product_categories
  for all
  using (app.owns_rep_profile(rep_profile_id) or app.is_admin())
  with check (app.owns_rep_profile(rep_profile_id) or app.is_admin());

grant select, insert, update, delete on rep_product_categories to app_user;

-- --- territories -----------------------------------------------------------
-- No proficiency: you either cover a territory or you do not.
create table rep_territories (
  rep_profile_id uuid not null references rep_profiles (id) on delete cascade,
  territory_id   uuid not null references territories (id) on delete restrict,
  created_at     timestamptz not null default now(),
  primary key (rep_profile_id, territory_id)
);

create index rep_territories_territory_idx on rep_territories (territory_id);

alter table rep_territories enable row level security;
alter table rep_territories force row level security;

create policy rep_territories_select on rep_territories
  for select
  using (exists (select 1 from rep_profiles r where r.id = rep_profile_id));

create policy rep_territories_write_owner on rep_territories
  for all
  using (app.owns_rep_profile(rep_profile_id) or app.is_admin())
  with check (app.owns_rep_profile(rep_profile_id) or app.is_admin());

grant select, insert, update, delete on rep_territories to app_user;

-- --- customer types --------------------------------------------------------
create table rep_customer_types (
  rep_profile_id   uuid not null references rep_profiles (id) on delete cascade,
  customer_type_id uuid not null references customer_types (id) on delete restrict,
  proficiency      rep_proficiency not null default 'experienced',
  created_at       timestamptz not null default now(),
  primary key (rep_profile_id, customer_type_id)
);

create index rep_customer_types_type_idx on rep_customer_types (customer_type_id);

alter table rep_customer_types enable row level security;
alter table rep_customer_types force row level security;

create policy rep_customer_types_select on rep_customer_types
  for select
  using (exists (select 1 from rep_profiles r where r.id = rep_profile_id));

create policy rep_customer_types_write_owner on rep_customer_types
  for all
  using (app.owns_rep_profile(rep_profile_id) or app.is_admin())
  with check (app.owns_rep_profile(rep_profile_id) or app.is_admin());

grant select, insert, update, delete on rep_customer_types to app_user;

-- --- sales models ----------------------------------------------------------
create table rep_sales_models (
  rep_profile_id uuid not null references rep_profiles (id) on delete cascade,
  sales_model_id uuid not null references sales_models (id) on delete restrict,
  proficiency    rep_proficiency not null default 'experienced',
  created_at     timestamptz not null default now(),
  primary key (rep_profile_id, sales_model_id)
);

create index rep_sales_models_model_idx on rep_sales_models (sales_model_id);

alter table rep_sales_models enable row level security;
alter table rep_sales_models force row level security;

create policy rep_sales_models_select on rep_sales_models
  for select
  using (exists (select 1 from rep_profiles r where r.id = rep_profile_id));

create policy rep_sales_models_write_owner on rep_sales_models
  for all
  using (app.owns_rep_profile(rep_profile_id) or app.is_admin())
  with check (app.owns_rep_profile(rep_profile_id) or app.is_admin());

grant select, insert, update, delete on rep_sales_models to app_user;

-- --- compensation preferences ----------------------------------------------
create table rep_compensation_prefs (
  rep_profile_id       uuid not null references rep_profiles (id) on delete cascade,
  compensation_type_id uuid not null references compensation_types (id) on delete restrict,
  created_at           timestamptz not null default now(),
  primary key (rep_profile_id, compensation_type_id)
);

create index rep_compensation_prefs_type_idx on rep_compensation_prefs (compensation_type_id);

alter table rep_compensation_prefs enable row level security;
alter table rep_compensation_prefs force row level security;

create policy rep_compensation_prefs_select on rep_compensation_prefs
  for select
  using (exists (select 1 from rep_profiles r where r.id = rep_profile_id));

create policy rep_compensation_prefs_write_owner on rep_compensation_prefs
  for all
  using (app.owns_rep_profile(rep_profile_id) or app.is_admin())
  with check (app.owns_rep_profile(rep_profile_id) or app.is_admin());

grant select, insert, update, delete on rep_compensation_prefs to app_user;
