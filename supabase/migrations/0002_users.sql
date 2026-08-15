-- ===========================================================================
-- 0002_users
--
-- Identity only. Domain data (rep profiles) arrives in Phase 2.
--
-- `platform_role` is deliberately NOT settable through any application code
-- path. It is changed by migration or by a superadmin acting through the admin
-- console. There is no self-service escalation route to exploit.
-- ===========================================================================

create type platform_role as enum ('member', 'admin', 'superadmin');

create type user_status as enum (
  'pending_verification',
  'active',
  'suspended',
  'deactivated'
);

create table users (
  id                uuid primary key default app.uuid_generate_v7(),

  -- Link to the Supabase Auth user. Nullable so an admin can pre-create a
  -- record, and so the domain model does not hard-depend on one auth vendor.
  auth_user_id      uuid unique,

  email             text not null,
  full_name         text not null,

  platform_role     platform_role not null default 'member',
  status            user_status   not null default 'pending_verification',

  email_verified_at timestamptz,
  mfa_enabled       boolean not null default false,
  last_active_at    timestamptz,

  -- Soft delete. Deletion is implemented as anonymisation because messages,
  -- reviews and engagements involve a counterparty whose records we cannot
  -- unilaterally destroy. See docs/03-security.md.
  deleted_at        timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint users_email_format check (position('@' in email) > 1),
  constraint users_full_name_not_blank check (length(btrim(full_name)) > 0)
);

-- Case-insensitive uniqueness without depending on the citext extension.
-- Emails are also normalised to lowercase in application code before insert.
create unique index users_email_lower_key on users (lower(email));

create index users_platform_role_idx on users (platform_role)
  where platform_role <> 'member';
create index users_status_idx on users (status);
create index users_auth_user_id_idx on users (auth_user_id) where auth_user_id is not null;

create trigger users_touch_updated_at
  before update on users
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table users force row level security;

-- A user may read themselves.
create policy users_select_self on users
  for select
  using (id = app.current_user_id());

-- Admins may read everyone.
create policy users_select_admin on users
  for select
  using (app.is_admin());

-- A user may update themselves. Which *columns* may change is constrained by
-- an explicit allowlist in the repository layer — RLS controls rows, not
-- fields, so mass-assignment protection lives in application code.
create policy users_update_self on users
  for update
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

create policy users_update_admin on users
  for update
  using (app.is_admin())
  with check (app.is_admin());

-- No INSERT policy and no DELETE policy: account creation runs through the
-- audited system path, and rows are never hard-deleted.

grant select, update on users to app_user;
