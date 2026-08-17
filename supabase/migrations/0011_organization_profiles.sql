-- ===========================================================================
-- 0011_organization_profiles
--
-- Fills out the business side of the marketplace. Organisations already exist
-- (migration 0003) with identity and membership; this adds the descriptive and
-- matchable attributes, so a business can be found the same way a rep can.
--
-- Symmetry with rep_profiles is deliberate. Both sides carry industries and
-- product categories drawn from the SAME controlled vocabularies, so matching
-- in Phase 7 compares like with like rather than translating between two
-- descriptions of the world.
-- ===========================================================================

create type org_size_band as enum ('1-10', '11-50', '51-200', '201-1000', '1000+');

alter table organizations
  add column tagline         text,
  add column size_band       org_size_band,
  add column founded_year    int,
  add column hq_territory_id uuid references territories (id) on delete set null,
  add column logo_file_id    uuid references files (id) on delete set null;

alter table organizations
  -- A generous fixed range rather than a computed one: CHECK constraints must
  -- be IMMUTABLE, so now() cannot appear here. The application validates
  -- against the actual current year, which is the check that matters.
  add constraint organizations_founded_year_sane
    check (founded_year is null or founded_year between 1600 and 2100),
  add constraint organizations_tagline_length
    check (tagline is null or length(btrim(tagline)) between 1 and 200);

-- Full-text search over the company, weighted so a name match outranks a
-- description match. Used by the business directory in Phase 4.
alter table organizations
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(tagline, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

create index organizations_search_idx on organizations using gin (search_vector);
create index organizations_hq_territory_idx on organizations (hq_territory_id);

-- ---------------------------------------------------------------------------
-- Logo integrity
--
-- The same rule that guards rep avatars: a logo must be a file uploaded to the
-- logos bucket FOR THIS ORGANISATION. Enforced by trigger so it holds even if a
-- future code path forgets — without it, a business could point its logo at any
-- file id and have the page render it.
-- ---------------------------------------------------------------------------
create or replace function app.file_belongs_to_org(
  p_file_id uuid,
  p_org_id  uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from files f
    where f.id = p_file_id
      and f.bucket = 'logos'
      and f.organization_id = p_org_id
      and f.deleted_at is null
  );
$$;

revoke execute on function app.file_belongs_to_org(uuid, uuid) from public;
grant execute on function app.file_belongs_to_org(uuid, uuid) to app_user;

create or replace function app.enforce_org_logo_ownership()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.logo_file_id is not null
     and (tg_op = 'INSERT' or new.logo_file_id is distinct from old.logo_file_id)
     and not app.file_belongs_to_org(new.logo_file_id, new.id)
  then
    raise exception 'Logo must be a file uploaded to the logos bucket for this organisation'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger organizations_enforce_logo_ownership
  before insert or update of logo_file_id on organizations
  for each row execute function app.enforce_org_logo_ownership();

-- ===========================================================================
-- Attribute join tables
--
-- Same shape, and same RLS reasoning, as the rep attribute tables in migration
-- 0009: the SELECT policy asks only whether the parent organisation row is
-- visible. organizations has RLS, so that subquery is already filtered by its
-- policy — attribute visibility tracks organisation visibility automatically
-- and cannot drift out of step with it.
--
-- Taxonomy references are ON DELETE RESTRICT: an entry in use is retired, never
-- deleted.
-- ===========================================================================

create or replace function app.can_admin_org(p_org_id uuid)
returns boolean
language sql
stable
as $$
  select app.is_org_member(p_org_id, 'admin') or app.is_admin();
$$;

grant execute on function app.can_admin_org(uuid) to app_user;

create table org_industries (
  organization_id uuid not null references organizations (id) on delete cascade,
  industry_id     uuid not null references industries (id) on delete restrict,
  created_at      timestamptz not null default now(),
  primary key (organization_id, industry_id)
);

create index org_industries_industry_idx on org_industries (industry_id);

alter table org_industries enable row level security;
alter table org_industries force row level security;

create policy org_industries_select on org_industries
  for select
  using (exists (select 1 from organizations o where o.id = organization_id));

create policy org_industries_write_admin on org_industries
  for all
  using (app.can_admin_org(organization_id))
  with check (app.can_admin_org(organization_id));

grant select, insert, update, delete on org_industries to app_user;

-- ---------------------------------------------------------------------------

create table org_product_categories (
  organization_id     uuid not null references organizations (id) on delete cascade,
  product_category_id uuid not null references product_categories (id) on delete restrict,
  created_at          timestamptz not null default now(),
  primary key (organization_id, product_category_id)
);

create index org_product_categories_category_idx
  on org_product_categories (product_category_id);

alter table org_product_categories enable row level security;
alter table org_product_categories force row level security;

create policy org_product_categories_select on org_product_categories
  for select
  using (exists (select 1 from organizations o where o.id = organization_id));

create policy org_product_categories_write_admin on org_product_categories
  for all
  using (app.can_admin_org(organization_id))
  with check (app.can_admin_org(organization_id));

grant select, insert, update, delete on org_product_categories to app_user;

-- ---------------------------------------------------------------------------
-- Team member names
--
-- A team management screen needs each member's name and email, both of which
-- live on `users` — whose RLS allows only self and admin, deliberately.
--
-- Rather than widening that policy (which would expose every user row to
-- anyone sharing an organisation with them), this function returns just the two
-- columns a team list needs, and only to someone who is themselves an accepted
-- member of that organisation. Same reasoning as app.rep_display_name() in
-- migration 0009.
-- ---------------------------------------------------------------------------
create or replace function app.org_member_directory(p_org_id uuid)
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id, u.full_name, u.email
  from organization_members m
  join users u on u.id = m.user_id
  where m.organization_id = p_org_id
    and (app.is_org_member(p_org_id) or app.is_admin());
$$;

revoke execute on function app.org_member_directory(uuid) from public;
grant execute on function app.org_member_directory(uuid) to app_user;
