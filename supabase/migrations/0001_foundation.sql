-- ===========================================================================
-- 0001_foundation
--
-- Establishes the primitives every later migration depends on:
--   * extensions
--   * the `app` schema (our helper functions live here, never in `public`)
--   * UUIDv7 generation
--   * the request-context functions that Row Level Security policies read
--   * the restricted `app_user` database role the application downgrades to
--
-- SECURITY MODEL
-- --------------
-- The application connects as the database owner, but before running any
-- user-originated query it does two things inside the transaction:
--
--   1. sets `app.user_id` / `app.platform_role` to the *verified* session identity
--   2. `SET LOCAL ROLE app_user`, which is NOT the owner and therefore has RLS
--      enforced against it
--
-- This means Row Level Security is genuinely load-bearing even though queries
-- originate from our own server. An authorization bug in application code is
-- still caught by the database. See docs/03-security.md.
-- ===========================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- UUIDv7 — time-ordered, so primary keys index efficiently, but random enough
-- that identifiers cannot be guessed or enumerated from a URL.
--
-- PostgreSQL 18 provides uuidv7() natively; we are on 16, so we implement it.
-- Layout: 48 bits of unix milliseconds, 4 bits version, 74 bits randomness.
-- ---------------------------------------------------------------------------
create or replace function app.uuid_generate_v7()
returns uuid
language plpgsql
volatile
parallel safe
as $$
declare
  v_time_ms bigint;
  v_bytes   bytea;
begin
  v_time_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- 6 bytes of big-endian timestamp, then 10 bytes of randomness.
  -- uuid_send(gen_random_uuid()) is used as the entropy source so this
  -- function needs no extension beyond the built-in gen_random_uuid().
  v_bytes := substring(int8send(v_time_ms) from 3 for 6)
          || substring(uuid_send(gen_random_uuid()) from 1 for 10);

  -- version 7 in the high nibble of byte 6
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
  -- RFC 4122 variant in the top two bits of byte 8
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);

  return encode(v_bytes, 'hex')::uuid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request context.
--
-- These read transaction-local settings established by withActor() in
-- src/lib/db/rls.ts. When nothing is set they return NULL / 'anonymous',
-- which makes every ownership policy fail closed.
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function app.current_platform_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.platform_role', true), ''), 'anonymous');
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
as $$
  select app.current_platform_role() in ('admin', 'superadmin');
$$;

create or replace function app.is_authenticated()
returns boolean
language sql
stable
as $$
  select app.current_user_id() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Organisation role ranking, so policies can express "admin or above".
-- ---------------------------------------------------------------------------
create or replace function app.org_role_rank(p_role text)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner'     then 40
    when 'admin'     then 30
    when 'recruiter' then 20
    when 'viewer'    then 10
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The restricted application role.
--
-- NOLOGIN: nothing connects as this role directly. The application connects as
-- the owner and downgrades with SET LOCAL ROLE for the duration of a
-- transaction. NOBYPASSRLS is the default and is the entire point.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end
$$;

-- The connecting role must be a member of app_user to SET ROLE to it.
-- current_user is `postgres` both locally and on Supabase.
do $$
begin
  if not pg_has_role(current_user, 'app_user', 'member') then
    execute format('grant app_user to %I', current_user);
  end if;
end
$$;

grant usage on schema public to app_user;
grant usage on schema app to app_user;
grant execute on all functions in schema app to app_user;

-- Future functions in `app` are usable by the restricted role by default.
alter default privileges in schema app grant execute on functions to app_user;

-- Deliberately NOT granted by default on tables. Each migration grants exactly
-- the privileges its table needs, so a new table is unreachable until someone
-- makes a deliberate decision about it.
