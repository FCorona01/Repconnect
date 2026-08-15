-- ===========================================================================
-- 0004_files
--
-- One registry for every upload, so access rules live in a single place rather
-- than being reimplemented per feature.
--
-- No storage bucket is public. This table records *who may be issued a signed
-- URL*; the URL itself is minted per request, after an authorization check,
-- and expires in minutes. See docs/03-security.md.
-- ===========================================================================

create type file_bucket as enum ('avatars', 'logos', 'documents', 'verification');

create type file_visibility as enum ('private', 'org', 'public');

create type file_scan_status as enum ('pending', 'clean', 'infected', 'skipped');

create table files (
  id                uuid primary key default app.uuid_generate_v7(),

  owner_user_id     uuid not null references users (id) on delete cascade,
  organization_id   uuid references organizations (id) on delete cascade,

  bucket            file_bucket     not null,
  visibility        file_visibility not null default 'private',

  -- Randomly generated server-side. Never derived from the user's filename,
  -- which is a path-traversal vector.
  storage_path      text not null,

  original_filename text not null,
  content_type      text not null,
  size_bytes        bigint not null,
  checksum_sha256   text,

  scan_status       file_scan_status not null default 'pending',

  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint files_size_positive check (size_bytes > 0),
  constraint files_size_cap      check (size_bytes <= 26214400),  -- 25 MiB
  -- Verification documents are admin-only by definition; never let one be
  -- created with a wider visibility by mistake.
  constraint files_verification_is_private
    check (bucket <> 'verification' or visibility = 'private')
);

create unique index files_storage_path_key on files (bucket, storage_path);
create index files_owner_idx on files (owner_user_id) where deleted_at is null;
create index files_org_idx on files (organization_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table files enable row level security;
alter table files force row level security;

create policy files_select_owner on files
  for select
  using (owner_user_id = app.current_user_id() and deleted_at is null);

create policy files_select_org on files
  for select
  using (
    visibility = 'org'
    and organization_id is not null
    and app.is_org_member(organization_id)
    and deleted_at is null
  );

create policy files_select_public on files
  for select
  using (visibility = 'public' and deleted_at is null);

-- Admins can see everything, including verification documents. This is the
-- only path to a verification file — the counterparty never gets one.
create policy files_select_admin on files
  for select
  using (app.is_admin());

create policy files_insert_owner on files
  for insert
  with check (owner_user_id = app.current_user_id());

create policy files_update_owner on files
  for update
  using (owner_user_id = app.current_user_id())
  with check (owner_user_id = app.current_user_id());

create policy files_update_admin on files
  for update
  using (app.is_admin())
  with check (app.is_admin());

create policy files_delete_owner on files
  for delete
  using (owner_user_id = app.current_user_id());

create policy files_delete_admin on files
  for delete
  using (app.is_admin());

grant select, insert, update, delete on files to app_user;
