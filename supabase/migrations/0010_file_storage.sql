-- ===========================================================================
-- 0010_file_storage
--
-- Storage buckets and the metadata the upload pipeline needs.
--
-- ---------------------------------------------------------------------------
-- NO BUCKET IS PUBLIC. EVER.
-- ---------------------------------------------------------------------------
-- A public bucket is a permanent, unauthenticated URL to a document. Once one
-- leaks it can never be un-leaked, and for a `verification` bucket holding
-- government ID that is a reportable incident rather than an inconvenience.
--
-- Every download goes through our server: it checks authorization against the
-- `files` row, then mints a signed URL that expires in minutes. A leaked
-- signed URL stops working; a public bucket never does.
--
-- The storage schema only exists on Supabase, so every statement touching it is
-- guarded. Local development and CI run against plain PostgreSQL with a
-- filesystem-backed adapter, and must still migrate cleanly.
-- ===========================================================================

-- Image dimensions, recorded at upload time so pages can reserve the right
-- amount of space before the image loads (avoids layout shift).
alter table files add column image_width  int;
alter table files add column image_height int;

alter table files
  add constraint files_image_dimensions_sane
  check (
    (image_width is null and image_height is null)
    or (image_width between 1 and 20000 and image_height between 1 and 20000)
  );

-- Uploads are re-encoded and stored by our server, so a row should never sit
-- in 'pending' for long. Kept as a column because Phase 6 adds real virus
-- scanning for the verification bucket.
comment on column files.scan_status is
  'Phase 3: images are re-encoded (which destroys embedded payloads) and marked clean. Real AV scanning arrives with verification review in Phase 6.';

-- ---------------------------------------------------------------------------
-- Buckets (Supabase only)
--
-- file_size_limit and allowed_mime_types are a backstop, not the primary
-- control — our server validates before it ever calls storage. Two independent
-- limits means a bug in ours is still caught.
--
-- The allowed MIME types are narrow because we re-encode: every image lands as
-- webp regardless of what was uploaded, so storage never has to accept jpeg,
-- png, heic or anything else.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('avatars',      'avatars',      false,  5242880, array['image/webp']),
      ('logos',        'logos',        false,  5242880, array['image/webp']),
      ('documents',    'documents',    false, 26214400, array['application/pdf']),
      ('verification', 'verification', false, 10485760, array['image/webp', 'application/pdf'])
    on conflict (id) do update
      set public             = false,
          file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    -- storage.objects has RLS enabled by Supabase, and a bucket with no
    -- policies denies everything to anon and authenticated roles. That is
    -- exactly what we want: only our server (service role) touches storage,
    -- and it does so only after checking the `files` row.
    --
    -- Policies are therefore deliberately NOT created here. Adding a
    -- permissive one would open a second, unauthorized path to these objects
    -- that bypasses every check in the application.
    raise notice 'Storage buckets configured (private, deny-by-default).';
  else
    raise notice 'No storage schema (local PostgreSQL) — skipping bucket setup.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Owners can see their own soft-deleted files
--
-- The original policy (migration 0004) carried `deleted_at is null`, which made
-- a file invisible to its own owner the instant it was marked deleted. That
-- breaks soft delete itself: `UPDATE ... RETURNING` has to read the row back,
-- and the row it just wrote no longer satisfies the SELECT policy.
--
-- The right place for that filter is the query, not the ownership rule — and
-- it is already there in getFile(). Every OTHER policy keeps `deleted_at is
-- null`, so a deleted file stops being visible to organisations, to the public
-- and through profiles; only its owner can still see it, which is how "recently
-- deleted" behaves everywhere else.
-- ---------------------------------------------------------------------------
drop policy files_select_owner on files;

create policy files_select_owner on files
  for select
  using (owner_user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Avatars follow the profile that uses them
--
-- An avatar is stored private, like every other file. But a profile is useless
-- if its photo 404s for everyone except its owner, so this policy makes an
-- avatar visible exactly when the profile referencing it is visible.
--
-- It restates no visibility rules of its own: rep_profiles has RLS, so the
-- subquery is already filtered by that table's policy. Same pattern as the rep
-- attribute tables in migration 0009 — attribute visibility tracks profile
-- visibility automatically and cannot drift out of step with it.
--
-- Scoped to `bucket = 'avatars'` so it can never widen access to a document or
-- a verification file.
-- ---------------------------------------------------------------------------
create policy files_select_rep_avatar on files
  for select
  using (
    bucket = 'avatars'
    and deleted_at is null
    and exists (select 1 from rep_profiles r where r.avatar_file_id = files.id)
  );

-- ---------------------------------------------------------------------------
-- Avatar integrity
--
-- A rep's avatar must be a file they own, in the avatars bucket. Without this
-- someone could point their avatar at another user's document id and have the
-- profile page render it — an authorization check that lives in the schema
-- rather than relying on every future code path remembering it.
-- ---------------------------------------------------------------------------
create or replace function app.file_is_usable_as(
  p_file_id uuid,
  p_bucket  file_bucket,
  p_owner   uuid
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
      and f.bucket = p_bucket
      and f.owner_user_id = p_owner
      and f.deleted_at is null
  );
$$;

revoke execute on function app.file_is_usable_as(uuid, file_bucket, uuid) from public;
grant execute on function app.file_is_usable_as(uuid, file_bucket, uuid) to app_user;

create or replace function app.enforce_avatar_ownership()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.avatar_file_id is not null
     and (tg_op = 'INSERT' or new.avatar_file_id is distinct from old.avatar_file_id)
     and not app.file_is_usable_as(new.avatar_file_id, 'avatars', new.user_id)
  then
    raise exception 'Avatar must be a file you uploaded to the avatars bucket'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger rep_profiles_enforce_avatar_ownership
  before insert or update of avatar_file_id on rep_profiles
  for each row execute function app.enforce_avatar_ownership();
