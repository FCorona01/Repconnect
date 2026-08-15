-- ===========================================================================
-- 0003_organizations
--
-- A business is an organisation with members, not a user with a company name.
-- This is the structural decision that lets a company have a second employee
-- without password sharing, keeps the audit trail meaningful, and makes
-- suspension granular. Retrofitting it later would mean migrating every
-- foreign key in the schema. See docs/02-data-model.md §1.
-- ===========================================================================

create type org_role as enum ('owner', 'admin', 'recruiter', 'viewer');

create type org_status as enum ('active', 'suspended', 'deleted');

create type verification_status as enum ('unverified', 'pending', 'verified', 'rejected');

create table organizations (
  id                  uuid primary key default app.uuid_generate_v7(),

  slug                text not null,
  legal_name          text not null,
  display_name        text not null,

  website             text,
  description         text,

  status              org_status          not null default 'active',
  verification_status verification_status not null default 'unverified',

  created_by          uuid references users (id),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint organizations_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 64),
  constraint organizations_display_name_not_blank
    check (length(btrim(display_name)) > 0),
  constraint organizations_legal_name_not_blank
    check (length(btrim(legal_name)) > 0)
);

create unique index organizations_slug_key on organizations (lower(slug));
create index organizations_status_idx on organizations (status);

create trigger organizations_touch_updated_at
  before update on organizations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
create table organization_members (
  id              uuid primary key default app.uuid_generate_v7(),

  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references users (id) on delete cascade,

  org_role        org_role not null default 'viewer',

  invited_by      uuid references users (id),
  invited_at      timestamptz not null default now(),

  -- Until accepted, a membership grants nothing. Every authorization check
  -- requires accepted_at to be non-null.
  accepted_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint organization_members_unique unique (organization_id, user_id)
);

create index organization_members_user_idx on organization_members (user_id)
  where accepted_at is not null;
create index organization_members_org_idx on organization_members (organization_id)
  where accepted_at is not null;

-- Exactly one owner per organisation, enforced by the database rather than by
-- application code that could lose a race.
create unique index organization_members_single_owner
  on organization_members (organization_id)
  where org_role = 'owner';

create trigger organization_members_touch_updated_at
  before update on organization_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership predicate.
--
-- SECURITY DEFINER is essential here, not incidental. A policy on
-- organization_members that queried organization_members directly would
-- recurse infinitely. Running as the definer skips RLS *inside the function*,
-- which breaks the cycle. The function is narrow, takes no free-form input,
-- and always resolves the caller from the request context rather than an
-- argument — so it cannot be used to impersonate anyone.
-- ---------------------------------------------------------------------------
create or replace function app.is_org_member(
  p_org_id   uuid,
  p_min_role text default 'viewer'
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = p_org_id
      and m.user_id = app.current_user_id()
      and m.accepted_at is not null
      and app.org_role_rank(m.org_role::text) >= app.org_role_rank(p_min_role)
  );
$$;

revoke execute on function app.is_org_member(uuid, text) from public;
grant execute on function app.is_org_member(uuid, text) to app_user;

-- Number of members an organisation has, without triggering RLS recursion.
-- Used only by the founder-claim policy below.
create or replace function app.org_member_count(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select count(*) from organization_members m where m.organization_id = p_org_id;
$$;

revoke execute on function app.org_member_count(uuid) from public;
grant execute on function app.org_member_count(uuid) to app_user;

-- Organisation IDs the current user belongs to, for use in IN (...) predicates.
create or replace function app.current_user_org_ids(p_min_role text default 'viewer')
returns setof uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select m.organization_id
  from organization_members m
  where m.user_id = app.current_user_id()
    and m.accepted_at is not null
    and app.org_role_rank(m.org_role::text) >= app.org_role_rank(p_min_role);
$$;

revoke execute on function app.current_user_org_ids(text) from public;
grant execute on function app.current_user_org_ids(text) to app_user;

-- ---------------------------------------------------------------------------
-- Row Level Security — organizations
-- ---------------------------------------------------------------------------
alter table organizations enable row level security;
alter table organizations force row level security;

-- Active organisations are publicly discoverable: businesses want to be found,
-- and the public directory is a core part of the marketplace.
create policy organizations_select_public on organizations
  for select
  using (status = 'active');

-- Members see their own organisation regardless of status, so a suspended
-- business can still see (and appeal) its own account.
create policy organizations_select_member on organizations
  for select
  using (app.is_org_member(id));

create policy organizations_select_admin on organizations
  for select
  using (app.is_admin());

-- Any signed-in user may create an organisation. The repository layer wraps
-- this in a transaction that also creates the owner membership.
create policy organizations_insert_authenticated on organizations
  for insert
  with check (app.is_authenticated() and created_by = app.current_user_id());

create policy organizations_update_org_admin on organizations
  for update
  using (app.is_org_member(id, 'admin'))
  with check (app.is_org_member(id, 'admin'));

create policy organizations_update_admin on organizations
  for update
  using (app.is_admin())
  with check (app.is_admin());

-- No DELETE policy: organisations are archived via status, never destroyed.

grant select, insert, update on organizations to app_user;

-- ---------------------------------------------------------------------------
-- Row Level Security — organization_members
--
-- This is the table that protects one business's data from another's. Every
-- later phase (opportunities, applications, messages) derives its access rules
-- from membership, so a mistake here propagates everywhere.
-- ---------------------------------------------------------------------------
alter table organization_members enable row level security;
alter table organization_members force row level security;

-- You can see your own membership rows (including pending invitations).
create policy organization_members_select_self on organization_members
  for select
  using (user_id = app.current_user_id());

-- Accepted members can see the rest of their team.
create policy organization_members_select_team on organization_members
  for select
  using (app.is_org_member(organization_id));

create policy organization_members_select_admin on organization_members
  for select
  using (app.is_admin());

-- Founder claim.
--
-- Creating an organisation and becoming its owner is a single logical act, but
-- the two rows cannot be written under the same rule: at the moment the owner
-- membership is inserted the creator is not yet a member of anything, so the
-- org-admin policy below cannot apply to them.
--
-- Rather than dropping to a privileged connection for the insert (which would
-- take the operation outside RLS entirely), this policy states the real rule:
-- the person who created an organisation may claim ownership of it, once,
-- while it has no members. The partial unique index on (organization_id) where
-- org_role = 'owner' is a second, independent guarantee of the "once".
create policy organization_members_insert_founder on organization_members
  for insert
  with check (
    user_id = app.current_user_id()
    and org_role = 'owner'
    and app.org_member_count(organization_id) = 0
    and exists (
      select 1 from organizations o
      where o.id = organization_id
        and o.created_by = app.current_user_id()
    )
  );

-- Only an org admin or owner may add members.
create policy organization_members_insert_org_admin on organization_members
  for insert
  with check (app.is_org_member(organization_id, 'admin'));

create policy organization_members_insert_admin on organization_members
  for insert
  with check (app.is_admin());

-- An org admin may change roles; a user may accept their own invitation.
create policy organization_members_update_org_admin on organization_members
  for update
  using (app.is_org_member(organization_id, 'admin'))
  with check (app.is_org_member(organization_id, 'admin'));

create policy organization_members_update_self on organization_members
  for update
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy organization_members_update_admin on organization_members
  for update
  using (app.is_admin())
  with check (app.is_admin());

-- An org admin may remove members; a user may leave.
create policy organization_members_delete_org_admin on organization_members
  for delete
  using (app.is_org_member(organization_id, 'admin'));

create policy organization_members_delete_self on organization_members
  for delete
  using (user_id = app.current_user_id());

create policy organization_members_delete_admin on organization_members
  for delete
  using (app.is_admin());

grant select, insert, update, delete on organization_members to app_user;
