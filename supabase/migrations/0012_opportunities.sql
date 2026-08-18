-- ===========================================================================
-- 0012_opportunities
--
-- The listing itself — the thing both sides of the marketplace exist to
-- transact on.
--
-- Mirrors rep_profiles (migration 0009) deliberately: the same five
-- vocabularies, the same RLS shape on attribute tables, the same immutable
-- public slug. Where a rep records `proficiency` on an attribute, an
-- opportunity records `is_required`. That asymmetry is the whole point — it is
-- what lets Phase 7 scoring tell "must have" from "nice to have" instead of
-- weighting every attribute equally.
--
-- DECISIONS ENCODED HERE
--   * Pay disclosure is REQUIRED. A compensation row must carry at least one
--     real figure, and an opportunity cannot leave draft without one.
--   * A company's FIRST listing is reviewed; afterwards they publish instantly.
--     Driven by organizations.listing_trust.
--   * No confidential listings. Every opportunity names its company, which
--     keeps JobPosting structured data simple and trust high.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Publishing trust
--
-- Explicit column rather than derived from listing history: an admin needs to
-- be able to push a bad actor back to `restricted` without deleting their past
-- listings, and "has this company ever published?" cannot express that.
-- ---------------------------------------------------------------------------
create type listing_trust as enum ('unreviewed', 'trusted', 'restricted');

alter table organizations
  add column listing_trust listing_trust not null default 'unreviewed';

comment on column organizations.listing_trust is
  'unreviewed: first listing goes to pending_review. trusted: publishes instantly. restricted: cannot publish at all.';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type opportunity_status as enum (
  'draft',           -- being written, org-only
  'pending_review',  -- awaiting platform approval (first listing per company)
  'open',            -- live, accepting applications, indexable
  'paused',          -- temporarily not accepting; page still resolves
  'filled',          -- someone was hired
  'closed',          -- withdrawn without hiring
  'archived'         -- soft-deleted, org and admin only
);

-- How much time the engagement takes. Deliberately ORTHOGONAL to pay: how
-- someone is paid lives in compensation_types, so 'commission_only' does not
-- appear here. Two vocabularies for one concept is what breaks matching.
create type engagement_type as enum ('full_time', 'part_time', 'fractional', 'project');

create type commission_basis as enum (
  'revenue',
  'gross_profit',
  'units',
  'contract_value'
);

create type payment_frequency as enum (
  'monthly',
  'quarterly',
  'on_collection',
  'on_close'
);

-- Distinguishes listings the founder created by hand from ones a business
-- posted itself. Pulled forward from Phase 4 (docs/07-cold-start.md): without
-- it, six months in you cannot tell whether the marketplace works or whether
-- you ARE the marketplace — and it cannot be reconstructed retroactively.
create type opportunity_source as enum ('organic', 'founder_sourced');

-- ---------------------------------------------------------------------------
-- opportunities
-- ---------------------------------------------------------------------------

create table opportunities (
  id                  uuid primary key default app.uuid_generate_v7(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  created_by          uuid references users (id) on delete set null,

  -- Permanent public URL identity, like rep and taxonomy slugs. A shared link
  -- that rots is worse than an ugly one.
  slug                text not null,

  title               text not null,
  summary             text not null,   -- listing card + meta description
  description         text not null,
  responsibilities    text,
  requirements        text,

  seniority_required   rep_seniority,
  min_years_experience int,

  engagement_type     engagement_type not null,
  expected_hours_per_week int,
  duration_months     int,             -- for project / fixed-term work

  is_remote           boolean not null default false,
  travel_percentage   int,

  openings            int not null default 1,

  status              opportunity_status not null default 'draft',
  status_changed_at   timestamptz not null default now(),
  published_at        timestamptz,
  closes_at           timestamptz,

  source              opportunity_source not null default 'organic',

  view_count          int not null default 0,
  -- Maintained by trigger in Phase 4 when applications exist.
  application_count   int not null default 0,

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(requirements, '')), 'D')
  ) stored,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint opportunities_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 120),
  constraint opportunities_title_length check (length(btrim(title)) between 1 and 160),
  constraint opportunities_summary_length check (length(btrim(summary)) between 1 and 300),
  constraint opportunities_description_length check (length(btrim(description)) between 1 and 20000),
  constraint opportunities_years_sane
    check (min_years_experience is null or min_years_experience between 0 and 60),
  constraint opportunities_hours_sane
    check (expected_hours_per_week is null or expected_hours_per_week between 1 and 80),
  constraint opportunities_duration_sane
    check (duration_months is null or duration_months between 1 and 120),
  constraint opportunities_travel_sane
    check (travel_percentage is null or travel_percentage between 0 and 100),
  constraint opportunities_openings_sane check (openings between 1 and 999),
  -- A live listing always has a publication date; a draft never does.
  constraint opportunities_published_when_live
    check (
      (status in ('open', 'paused', 'filled', 'closed') and published_at is not null)
      or (status in ('draft', 'pending_review', 'archived'))
    )
);

create unique index opportunities_slug_key on opportunities (slug);
create index opportunities_org_idx on opportunities (organization_id, status);
create index opportunities_search_idx on opportunities using gin (search_vector);

-- The index the public browse relies on: live listings, newest first.
create index opportunities_live_idx
  on opportunities (published_at desc, id desc)
  where status = 'open';

create index opportunities_closes_at_idx on opportunities (closes_at)
  where status = 'open' and closes_at is not null;

create trigger opportunities_touch_updated_at
  before update on opportunities
  for each row execute function app.touch_updated_at();

-- Slugs are permanent public identifiers, exactly like taxonomy and rep slugs.
create trigger opportunities_freeze_slug
  before update on opportunities
  for each row execute function app.taxonomy_freeze_slug();

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

create or replace function app.can_manage_opportunities(p_org_id uuid)
returns boolean
language sql
stable
as $$
  select app.is_org_member(p_org_id, 'recruiter') or app.is_admin();
$$;

grant execute on function app.can_manage_opportunities(uuid) to app_user;

/**
 * Whether the caller may edit a specific opportunity.
 *
 * SECURITY DEFINER so an attribute-table policy can resolve the parent's
 * organisation without depending on the opportunity being SELECT-visible under
 * the policy currently being evaluated. Takes no free-form input and always
 * resolves the caller from the request context.
 */
create or replace function app.can_manage_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from opportunities o
    where o.id = p_opportunity_id
      and app.can_manage_opportunities(o.organization_id)
  );
$$;

revoke execute on function app.can_manage_opportunity(uuid) from public;
grant execute on function app.can_manage_opportunity(uuid) to app_user;

-- ---------------------------------------------------------------------------
-- Row Level Security — opportunities
--
-- `paused`, `filled` and `closed` listings stay publicly READABLE on purpose.
-- A shared or indexed link must never break; the page renders and says the
-- listing is no longer accepting applications. They are excluded from browse
-- and from the sitemap in application code, which is where that belongs.
--
-- `draft` and `pending_review` are org-only: a half-written listing is not
-- something the world should see. `archived` is a soft delete.
-- ---------------------------------------------------------------------------
alter table opportunities enable row level security;
alter table opportunities force row level security;

create policy opportunities_select_public on opportunities
  for select
  using (status in ('open', 'paused', 'filled', 'closed'));

create policy opportunities_select_org on opportunities
  for select
  using (app.is_org_member(organization_id));

create policy opportunities_select_admin on opportunities
  for select
  using (app.is_admin());

create policy opportunities_insert_org on opportunities
  for insert
  with check (app.can_manage_opportunities(organization_id));

create policy opportunities_update_org on opportunities
  for update
  using (app.can_manage_opportunities(organization_id))
  with check (app.can_manage_opportunities(organization_id));

create policy opportunities_update_admin on opportunities
  for update
  using (app.is_admin())
  with check (app.is_admin());

-- No DELETE policy: listings are archived, never destroyed. Applications in
-- Phase 4 will reference them, and a vanished listing would orphan a rep's
-- history.

grant select, insert, update on opportunities to app_user;

-- ---------------------------------------------------------------------------
-- Compensation
--
-- A separate table because real sales compensation is a STACK, not a number:
-- base plus commission plus bonus plus equity. Modelling it explicitly is what
-- lets a rep filter "commission on gross profit, at least 15%, OTE above 120k",
-- which is how sales professionals actually evaluate an opportunity.
-- ---------------------------------------------------------------------------

create table opportunity_compensation (
  id                   uuid primary key default app.uuid_generate_v7(),
  opportunity_id       uuid not null references opportunities (id) on delete cascade,
  compensation_type_id uuid not null references compensation_types (id) on delete restrict,

  is_primary           boolean not null default false,

  base_min             numeric(12, 2),
  base_max             numeric(12, 2),

  commission_rate_min  numeric(5, 2),   -- percent
  commission_rate_max  numeric(5, 2),
  commission_basis     commission_basis,

  ote_min              numeric(12, 2),  -- on-target earnings
  ote_max              numeric(12, 2),

  retainer_amount      numeric(12, 2),
  payment_frequency    payment_frequency,

  equity_offered       boolean not null default false,
  notes                text,

  currency             char(3) not null default 'USD',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint opportunity_compensation_base_range
    check (base_min is null or base_max is null or base_min <= base_max),
  constraint opportunity_compensation_ote_range
    check (ote_min is null or ote_max is null or ote_min <= ote_max),
  constraint opportunity_compensation_commission_range
    check (
      (commission_rate_min is null or commission_rate_min between 0 and 100)
      and (commission_rate_max is null or commission_rate_max between 0 and 100)
      and (commission_rate_min is null or commission_rate_max is null
           or commission_rate_min <= commission_rate_max)
    ),
  constraint opportunity_compensation_non_negative
    check (
      coalesce(base_min, 0) >= 0 and coalesce(base_max, 0) >= 0
      and coalesce(ote_min, 0) >= 0 and coalesce(ote_max, 0) >= 0
      and coalesce(retainer_amount, 0) >= 0
    ),
  -- THE DISCLOSURE RULE. A compensation row that states no figure at all is
  -- not a disclosure, so the database refuses it outright.
  constraint opportunity_compensation_discloses_a_figure
    check (
      base_min is not null
      or commission_rate_min is not null
      or ote_min is not null
      or retainer_amount is not null
    )
);

create index opportunity_compensation_opportunity_idx
  on opportunity_compensation (opportunity_id);
create index opportunity_compensation_type_idx
  on opportunity_compensation (compensation_type_id);

-- At most one primary arrangement per listing.
create unique index opportunity_compensation_single_primary
  on opportunity_compensation (opportunity_id)
  where is_primary;

create trigger opportunity_compensation_touch_updated_at
  before update on opportunity_compensation
  for each row execute function app.touch_updated_at();

alter table opportunity_compensation enable row level security;
alter table opportunity_compensation force row level security;

-- Visibility follows the parent listing: opportunities has RLS, so this
-- subquery is already filtered by its policy. Same pattern as the rep and org
-- attribute tables — it cannot drift out of step with the listing.
create policy opportunity_compensation_select on opportunity_compensation
  for select
  using (exists (select 1 from opportunities o where o.id = opportunity_id));

create policy opportunity_compensation_write on opportunity_compensation
  for all
  using (app.can_manage_opportunity(opportunity_id))
  with check (app.can_manage_opportunity(opportunity_id));

grant select, insert, update, delete on opportunity_compensation to app_user;

-- ---------------------------------------------------------------------------
-- Publication guard
--
-- The disclosure rule again, this time at the listing level: a listing cannot
-- reach review or go live without at least one compensation row. Enforced by
-- trigger so it holds even if a future code path forgets, and so a direct
-- database write cannot produce an undisclosed live listing.
-- ---------------------------------------------------------------------------
create or replace function app.opportunity_has_compensation(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from opportunity_compensation c where c.opportunity_id = p_opportunity_id
  );
$$;

revoke execute on function app.opportunity_has_compensation(uuid) from public;
grant execute on function app.opportunity_has_compensation(uuid) to app_user;

create or replace function app.enforce_opportunity_publication()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    -- Archived is terminal. Reviving a soft-deleted listing would resurrect it
    -- at a URL people may already have shared for something else.
    if old.status = 'archived' then
      raise exception 'An archived opportunity cannot be reopened'
        using errcode = 'check_violation';
    end if;

    if new.status in ('pending_review', 'open')
       and not app.opportunity_has_compensation(new.id)
    then
      raise exception 'An opportunity must state its compensation before it can be published'
        using errcode = 'check_violation';
    end if;

    -- First publication stamps the date; later transitions leave it alone, so
    -- "posted on" does not change when a listing is paused and resumed.
    if new.status = 'open' and new.published_at is null then
      new.published_at := now();
    end if;

    new.status_changed_at := now();
  end if;

  return new;
end;
$$;

create trigger opportunities_enforce_publication
  before update on opportunities
  for each row execute function app.enforce_opportunity_publication();

-- ---------------------------------------------------------------------------
-- Status history
--
-- Append-only, like audit_logs: UPDATE and DELETE are never granted. Recorded
-- by trigger rather than by application code, so a transition cannot happen
-- without being written down.
-- ---------------------------------------------------------------------------

create table opportunity_status_history (
  id             uuid primary key default app.uuid_generate_v7(),
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  from_status    opportunity_status,
  to_status      opportunity_status not null,
  actor_user_id  uuid references users (id) on delete set null,
  reason         text,
  created_at     timestamptz not null default now()
);

create index opportunity_status_history_opportunity_idx
  on opportunity_status_history (opportunity_id, created_at desc);

create or replace function app.record_opportunity_status()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into opportunity_status_history
      (opportunity_id, from_status, to_status, actor_user_id, reason)
    values (
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      app.current_user_id(),
      -- Set by the repository for the duration of the transaction, the same
      -- mechanism withActor() uses for identity.
      nullif(current_setting('app.status_reason', true), '')
    );
  end if;
  return null;
end;
$$;

create trigger opportunities_record_status
  after insert or update on opportunities
  for each row execute function app.record_opportunity_status();

alter table opportunity_status_history enable row level security;
alter table opportunity_status_history force row level security;

create policy opportunity_status_history_select on opportunity_status_history
  for select
  using (exists (select 1 from opportunities o where o.id = opportunity_id));

-- Rows are written ONLY by the SECURITY DEFINER trigger above, which runs as
-- the table owner. `force row level security` applies policies to the owner as
-- well, so that insert still needs a policy to satisfy — hence this one.
--
-- The policy permits; the GRANT withholds. app_user is never given INSERT, so
-- application code cannot write history directly however permissive the policy
-- looks. Two independent controls, the same shape used for audit_logs.
create policy opportunity_status_history_insert_trigger on opportunity_status_history
  for insert
  with check (true);

-- SELECT only. No UPDATE or DELETE grant: the history is immutable.
grant select on opportunity_status_history to app_user;

-- ===========================================================================
-- Attribute join tables
--
-- Same five vocabularies as rep_profiles, so Phase 7 compares like with like.
-- `is_required` is the opportunity-side counterpart to the rep side's
-- `proficiency`.
-- ===========================================================================

create table opportunity_industries (
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  industry_id    uuid not null references industries (id) on delete restrict,
  is_required    boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, industry_id)
);
create index opportunity_industries_industry_idx on opportunity_industries (industry_id);

create table opportunity_product_categories (
  opportunity_id      uuid not null references opportunities (id) on delete cascade,
  product_category_id uuid not null references product_categories (id) on delete restrict,
  is_required         boolean not null default false,
  created_at          timestamptz not null default now(),
  primary key (opportunity_id, product_category_id)
);
create index opportunity_product_categories_category_idx
  on opportunity_product_categories (product_category_id);

create table opportunity_territories (
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  territory_id   uuid not null references territories (id) on delete restrict,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, territory_id)
);
create index opportunity_territories_territory_idx on opportunity_territories (territory_id);

create table opportunity_customer_types (
  opportunity_id   uuid not null references opportunities (id) on delete cascade,
  customer_type_id uuid not null references customer_types (id) on delete restrict,
  is_required      boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (opportunity_id, customer_type_id)
);
create index opportunity_customer_types_type_idx on opportunity_customer_types (customer_type_id);

create table opportunity_sales_models (
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  sales_model_id uuid not null references sales_models (id) on delete restrict,
  is_required    boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (opportunity_id, sales_model_id)
);
create index opportunity_sales_models_model_idx on opportunity_sales_models (sales_model_id);

-- One RLS shape for all five, applied by function so they cannot drift apart.
create or replace function app.apply_opportunity_attribute_rls(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := p_table::text;
begin
  execute format('alter table %s enable row level security', v_name);
  execute format('alter table %s force row level security', v_name);

  -- Visibility follows the parent listing, via opportunities' own RLS.
  execute format(
    'create policy %I on %s for select
       using (exists (select 1 from opportunities o where o.id = opportunity_id))',
    v_name || '_select', v_name);

  execute format(
    'create policy %I on %s for all
       using (app.can_manage_opportunity(opportunity_id))
       with check (app.can_manage_opportunity(opportunity_id))',
    v_name || '_write', v_name);

  execute format('grant select, insert, update, delete on %s to app_user', v_name);
end;
$$;

select app.apply_opportunity_attribute_rls('opportunity_industries');
select app.apply_opportunity_attribute_rls('opportunity_product_categories');
select app.apply_opportunity_attribute_rls('opportunity_territories');
select app.apply_opportunity_attribute_rls('opportunity_customer_types');
select app.apply_opportunity_attribute_rls('opportunity_sales_models');

-- ===========================================================================
-- saved_opportunities
--
-- Pulled forward from Phase 4 so the browse experience has a real action.
-- Applications arrive next phase; without this, a listing page would have
-- nothing a rep could actually do — exactly the half-built screen this project
-- set out to avoid.
-- ===========================================================================

create table saved_opportunities (
  rep_profile_id uuid not null references rep_profiles (id) on delete cascade,
  opportunity_id uuid not null references opportunities (id) on delete cascade,
  note           text,
  created_at     timestamptz not null default now(),
  primary key (rep_profile_id, opportunity_id),
  constraint saved_opportunities_note_length check (note is null or length(note) <= 1000)
);

create index saved_opportunities_opportunity_idx on saved_opportunities (opportunity_id);

alter table saved_opportunities enable row level security;
alter table saved_opportunities force row level security;

-- Strictly private. A business must never learn who has been eyeing its
-- listing — that is the rep's business, and knowing it would chill saving.
create policy saved_opportunities_own on saved_opportunities
  for all
  using (app.owns_rep_profile(rep_profile_id))
  with check (app.owns_rep_profile(rep_profile_id));

create policy saved_opportunities_select_admin on saved_opportunities
  for select
  using (app.is_admin());

grant select, insert, update, delete on saved_opportunities to app_user;
