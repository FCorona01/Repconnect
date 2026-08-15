-- ===========================================================================
-- 0005_audit_and_consents
--
-- audit_logs is append-only. Not by convention — by privilege. UPDATE and
-- DELETE are never granted to the application role, so an audit trail cannot
-- be rewritten by any code path short of direct owner access.
--
-- An audit log an admin can edit is not an audit log.
-- ===========================================================================

create table audit_logs (
  id              uuid primary key default app.uuid_generate_v7(),

  actor_user_id   uuid references users (id) on delete set null,
  actor_role      text not null,

  -- Set when the action was performed through admin impersonation, so
  -- "who really did this" is always answerable.
  impersonated_by uuid references users (id) on delete set null,

  action          text not null,
  target_type     text not null,
  target_id       uuid,

  before_state    jsonb,
  after_state     jsonb,

  ip_address      inet,
  user_agent      text,

  created_at      timestamptz not null default now(),

  constraint audit_logs_action_not_blank check (length(btrim(action)) > 0)
);

create index audit_logs_actor_idx  on audit_logs (actor_user_id, created_at desc);
create index audit_logs_target_idx on audit_logs (target_type, target_id, created_at desc);
create index audit_logs_created_idx on audit_logs (created_at desc);

alter table audit_logs enable row level security;
alter table audit_logs force row level security;

-- Only admins may read the audit trail.
create policy audit_logs_select_admin on audit_logs
  for select
  using (app.is_admin());

-- Any authenticated actor may append (their actions generate entries), but the
-- recorded actor must be themselves — an actor cannot forge a log entry
-- attributed to someone else.
create policy audit_logs_insert_self on audit_logs
  for insert
  with check (
    app.is_authenticated()
    and (actor_user_id is null or actor_user_id = app.current_user_id())
  );

-- No UPDATE or DELETE policy, and no UPDATE or DELETE grant. Two independent
-- reasons the trail is immutable.
grant select, insert on audit_logs to app_user;

-- ===========================================================================
-- consents
--
-- Proof of what a user agreed to and when. Legally load-bearing, and trivial
-- to add now versus archaeological later.
-- ===========================================================================

create type consent_policy_type as enum ('terms', 'privacy', 'marketing');

create table consents (
  id             uuid primary key default app.uuid_generate_v7(),

  user_id        uuid not null references users (id) on delete cascade,
  policy_type    consent_policy_type not null,
  policy_version text not null,

  granted        boolean not null,

  ip_address     inet,
  user_agent     text,

  created_at     timestamptz not null default now()
);

create index consents_user_idx on consents (user_id, policy_type, created_at desc);

alter table consents enable row level security;
alter table consents force row level security;

create policy consents_select_self on consents
  for select
  using (user_id = app.current_user_id());

create policy consents_select_admin on consents
  for select
  using (app.is_admin());

create policy consents_insert_self on consents
  for insert
  with check (user_id = app.current_user_id());

-- Consent history is immutable: a withdrawal is a new row, not an edit.
grant select, insert on consents to app_user;
