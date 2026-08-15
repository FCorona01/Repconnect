# 02 — Data Model

You listed 18 candidate entities and asked me not to assume they are all required.
Here is the verdict on each, plus the ones you were missing.

---

## Verdict on your proposed entities

| You proposed | Verdict | Note |
| --- | --- | --- |
| Users | **Keep** | Split: identity vs. profiles. |
| Rep profiles | **Keep** | 1:1 optional with user. |
| Business profiles | **Restructure → `organizations` + `organization_members`** | Businesses have teams. See §1. |
| Opportunities | **Keep** | Owned by an organisation, not a user. |
| Applications | **Keep** | Core state machine. |
| Saved opportunities | **Keep** | Trivial, high value. |
| Invitations | **Keep** | The demand-side outbound channel. |
| Conversations | **Keep** | But context-scoped. See §5. |
| Messages | **Keep** | Plus read cursors. |
| Reviews | **Keep** | But attached to engagements, not applications. |
| Notifications | **Keep** | Plus per-type preferences. |
| Reports | **Keep** | Polymorphic over target type. |
| Verification | **Keep** | Separate from user status. |
| Categories | **Keep** — rename `product_categories` | Disambiguates from industries. |
| Industries | **Keep** | |
| Territories | **Keep — but hierarchical** | The hardest table in the schema. See §3. |
| Compensation types | **Keep, but split** | A type *and* a per-opportunity compensation record. See §4. |
| Audit logs | **Keep** | Append-only. |
| Platform settings | **Reduce** | Mostly an anti-pattern. See §9. |

### Entities you were missing, and need

| Entity | Why it is necessary |
| --- | --- |
| **`organization_members`** | Businesses are not one person. Without this, a company's account is one shared login — which breaks authorization, breaks audit, and is the first thing an enterprise customer rejects. |
| **`engagements`** | The state between "accepted" and "reviewed". Without it there is no verifiable transaction to attach a review to, and the review system becomes ungameable-in-theory but trivially gameable in practice. This is the single most important addition. |
| **`customer_types`** and **`sales_models`** | You listed these as profile *fields*. They must be controlled vocabularies, or the two sides describe the world differently and matching cannot work. |
| **`job_queue`** | Background work — emails, match recomputation, exports. |
| **`email_events`** | Delivery, bounce, and complaint tracking from Resend. Without it you cannot diagnose "users say they never got the email", and you cannot protect your sending reputation. |
| **`subscriptions` + `entitlements`** | The local mirror of Stripe state. Feature gates read entitlements, never Stripe. |
| **`match_scores`** | Precomputed matching results. |
| **`consents`** | Proof of what was agreed and when. Legally load-bearing. |
| **`files`** | One registry for every upload, with owner and access rules, rather than access logic scattered per feature. |

---

## §1 Identity: why users, orgs, and reps are three things

```
users ──1:0..1── rep_profiles
  │
  └──< organization_members >── organizations
```

- **`users`** — authentication identity and platform role. Nothing domain-specific.
- **`rep_profiles`** — the sales professional. Optional; a user may not be a rep.
- **`organizations`** — the business. A legal entity, not a person.
- **`organization_members`** — the join, carrying the org-scoped role.

**Why not a `business_profiles` table with a `user_id`?** Because a business is not
a person. The moment a company's second employee needs access — a sales manager
reviewing applicants, a founder who wants to stop being the only login — a
one-user-per-business model forces password sharing. That destroys the audit trail,
makes suspension all-or-nothing, and is an immediate blocker for any customer above
a very small size. Adding it later means migrating every foreign key in the schema.

**Why a user can be both a rep and an org member:** a fractional VP of Sales may
sell their own time and also hire reps. Forcing two accounts fragments their
reputation — the asset the whole marketplace is built on.

```sql
users
  id                uuid pk            -- UUIDv7
  auth_user_id      uuid unique        -- Supabase Auth link
  email             citext unique not null
  full_name         text not null
  platform_role     enum('member','admin','superadmin') default 'member'
  status            enum('pending_verification','active','suspended','deactivated')
  email_verified_at timestamptz
  mfa_enabled       boolean default false
  last_active_at    timestamptz
  deleted_at        timestamptz        -- soft delete → anonymisation
  created_at, updated_at

organizations
  id                uuid pk
  slug              citext unique not null   -- URL identity
  legal_name        text not null
  display_name      text not null
  website           text
  description       text
  size_band         enum('1-10','11-50','51-200','201-1000','1000+')
  founded_year      int
  logo_file_id      uuid fk → files
  hq_territory_id   uuid fk → territories
  verification_status enum('unverified','pending','verified','rejected')
  status            enum('active','suspended','deleted')
  created_at, updated_at

organization_members
  id                uuid pk
  organization_id   uuid fk → organizations on delete cascade
  user_id           uuid fk → users
  org_role          enum('owner','admin','recruiter','viewer') not null
  invited_by        uuid fk → users
  accepted_at       timestamptz
  unique (organization_id, user_id)
  -- partial unique index guarantees exactly one owner per org
```

```sql
rep_profiles
  id                    uuid pk
  user_id               uuid fk → users unique
  headline              text not null           -- "Enterprise MedTech closer, Southwest"
  bio                   text
  years_experience      int check (between 0 and 60)
  seniority             enum('sdr','ae','senior_ae','enterprise_ae','sales_manager','director','vp','cro')
  avatar_file_id        uuid fk → files
  linkedin_url          text
  visibility            enum('public','businesses_only','applied_only') default 'businesses_only'
  open_to_work          boolean default true
  availability_hours    int                     -- per week, for fractional
  earliest_start_date   date
  min_base_required     numeric                 -- null = open to commission-only
  currency              char(3) default 'USD'
  profile_completeness  int                     -- computed 0..100, drives ranking
  response_rate         numeric                 -- computed, drives ranking
  verification_status   enum('unverified','pending','verified','rejected')
  search_vector         tsvector generated
  created_at, updated_at
```

`visibility` is doing serious work. Reps often have current employers. Without
control over who sees their profile, they will not create one — and reps are the
scarce side.

---

## §2 The shared taxonomy

The highest-leverage tables in the schema. If both sides do not describe the world
with the same words, matching is impossible and no amount of clever scoring saves it.

```sql
industries            id, slug, name, parent_id, sort_order, is_active
product_categories    id, slug, name, parent_id, is_active
customer_types        id, slug, name   -- SMB, Mid-Market, Enterprise, Government,
                                       -- Healthcare Systems, Channel/Reseller, Consumer
sales_models          id, slug, name   -- Inside, Field/Outside, Channel, Inbound,
                                       -- Outbound/Hunting, Account Management/Farming
compensation_types    id, slug, name   -- Commission-only, Base+Commission, Retainer,
                                       -- Fractional, Contract/Project, Equity component
```

All are **admin-managed, never free-text.** Free-text kills matching: one side
writes "SaaS", the other "Software as a Service", and they never meet.

Both `industries` and `product_categories` are hierarchical, so a rep can say
"Healthcare" and match an opportunity in "Medical Devices → Surgical Implants".

Attributes attach to both sides through symmetric join tables — deliberately
symmetric, because it makes the matching queries simple and the scoring fair:

```
rep_industries          ↔  opportunity_industries
rep_product_categories  ↔  opportunity_product_categories
rep_territories         ↔  opportunity_territories
rep_customer_types      ↔  opportunity_customer_types
rep_sales_models        ↔  opportunity_sales_models
rep_compensation_prefs  ↔  opportunity_compensation
```

Rep-side join rows carry a `proficiency` (`familiar` / `experienced` / `expert`) and
`years`. Opportunity-side rows carry `is_required`. This distinction is what lets
scoring separate "must have" from "nice to have" — without it every requirement is
equally weighted and the results are mush.

---

## §3 Territories — the hardest table

Sales territory is not a string. "Southwest US", "California", "Los Angeles Metro",
"90210", and "Remote/Nationwide" must all interoperate.

```sql
territories
  id            uuid pk
  slug          citext unique
  name          text not null
  kind          enum('global','country','region','state','metro','county','postal')
  parent_id     uuid fk → territories
  path          ltree not null       -- 'world.us.west.ca.los_angeles'
  iso_code      text
  is_active     boolean
  -- GiST index on path
```

The `ltree` path makes hierarchical questions cheap and bidirectional:

| Question | Query |
| --- | --- |
| Rep covers California — does this LA opportunity match? | `opportunity.path <@ rep.path` (descendant) |
| Rep covers LA only — does this California opportunity match? | `opportunity.path @> rep.path` (ancestor) |
| Rep is remote/nationwide | path is `world.us` — an ancestor of everything US |

A match exists when the paths overlap **in either direction**. That single rule
handles every territory case, including the awkward ones, and a flat text column
handles none of them.

**Seeding:** US states and metros, Canadian provinces, UK regions, and a `Remote`
node. Expand by market. Doing this properly in Phase 2 is far cheaper than
migrating dirty territory data later.

---

## §4 Opportunities and compensation

```sql
opportunities
  id                    uuid pk
  organization_id       uuid fk → organizations
  created_by            uuid fk → users
  slug                  citext                    -- SEO URL
  title                 text not null
  summary               text not null             -- listing card + meta description
  description           text not null
  responsibilities      text
  requirements          text
  seniority_required    enum(...)
  min_years_experience  int
  engagement_type       enum('commission_only','fractional','contract','part_time','full_time_1099')
  expected_hours        int
  duration_months       int
  is_remote             boolean
  travel_percentage     int
  openings              int default 1
  application_deadline  date
  status                enum('draft','pending_review','open','paused','filled','closed','archived')
  published_at          timestamptz
  closes_at             timestamptz
  view_count            int default 0
  application_count     int default 0             -- denormalised, trigger-maintained
  search_vector         tsvector generated
  created_at, updated_at
  -- index (status, published_at desc) where status = 'open'
```

Compensation is a **separate table**, not columns, because real sales compensation
is a stack: base plus commission plus bonus plus equity.

```sql
opportunity_compensation
  id                   uuid pk
  opportunity_id       uuid fk → opportunities
  compensation_type_id uuid fk → compensation_types
  is_primary           boolean
  base_min, base_max   numeric
  commission_rate_min  numeric        -- percent
  commission_rate_max  numeric
  commission_basis     enum('revenue','gross_profit','units','contract_value')
  ote_min, ote_max     numeric        -- on-target earnings
  retainer_amount      numeric
  currency             char(3)
  payment_frequency    enum('monthly','quarterly','on_collection','on_close')
  equity_offered       boolean
  notes                text
```

Modelling OTE and commission basis explicitly is not over-engineering. It is what
lets a rep filter "commission on gross profit, ≥15%, OTE above $120k" — which is
how sales reps actually evaluate opportunities, and which a single `salary` column
cannot express. Compensation transparency is also increasingly a legal requirement
in several US states.

---

## §5 The transaction path

This is the marketplace's actual product. Four tables, one state machine.

```sql
applications
  id                uuid pk
  opportunity_id    uuid fk → opportunities
  rep_profile_id    uuid fk → rep_profiles
  source            enum('direct','invited','recommended')
  invitation_id     uuid fk → invitations
  cover_note        text
  attachments       -- via files
  status            enum('submitted','viewed','shortlisted','interviewing',
                         'offer_extended','accepted','rejected','withdrawn','expired')
  status_changed_at timestamptz
  rejection_reason  text                    -- internal to the business
  match_score       numeric                 -- snapshot at apply time
  created_at, updated_at
  -- partial unique index: one live application per (opportunity, rep)
```

That partial unique index is the database preventing duplicate applications under a
double-click or a race, rather than trusting the application code to win a race it
will eventually lose.

```sql
saved_opportunities   rep_profile_id, opportunity_id, note, unique together

invitations
  id, opportunity_id, organization_id, rep_profile_id, invited_by,
  message, status enum('sent','viewed','accepted','declined','expired'),
  expires_at, responded_at

engagements                          -- the missing entity
  id                uuid pk
  application_id    uuid fk → applications unique
  opportunity_id, organization_id, rep_profile_id
  started_at        date
  ended_at          date
  end_reason        enum('completed','ended_early','converted_to_employment','abandoned')
  confirmed_by_rep  boolean          -- BOTH must confirm
  confirmed_by_org  boolean
  created_at, updated_at
```

**Why `engagements` is non-negotiable.** Reviews must attach to a transaction both
parties confirm actually happened. Attach reviews to applications instead and
anyone can apply, get rejected, and leave a revenge review. `engagements` also
gives you the metric that proves the marketplace works — placements — which is what
an investor asks about first and what you cannot reconstruct retroactively.

**Status transitions are enforced in code, not free-form.** A state machine defines
legal moves; illegal ones are rejected and logged. Every change writes an
`application_status_history` row, so disputes are answerable with evidence.

---

## §6 Messaging

```sql
conversations
  id               uuid pk
  context_type     enum('application','invitation')   -- never null
  context_id       uuid
  organization_id  uuid fk
  rep_profile_id   uuid fk
  subject          text
  status           enum('active','archived','blocked')
  last_message_at  timestamptz        -- indexed, drives inbox ordering
  unique (context_type, context_id)

conversation_participants
  conversation_id, user_id, role enum('rep','business'),
  last_read_at timestamptz, notifications_enabled boolean

messages
  id, conversation_id, sender_user_id, body,
  attachments → files,
  flagged_reason text,                -- contact-info detection
  edited_at, deleted_at, created_at
  -- index (conversation_id, created_at desc)
```

Read state is a **timestamp cursor per participant**, not a row per message per
user. The latter is a table that grows as messages × participants and becomes the
largest table in the database for no benefit.

`context_type`/`context_id` being non-null is the structural guarantee that cold
messaging is impossible. It is a schema-level business rule, which is the most
durable place to put one.

---

## §7 Trust, safety, and moderation

```sql
reviews
  id, engagement_id fk, reviewer_user_id, subject_type enum('rep','organization'),
  subject_id,
  rating_overall int check (1..5),
  rating_communication, rating_reliability, rating_results, rating_accuracy int,
  headline, body text,
  is_published boolean default false,        -- double-blind gate
  published_at timestamptz,
  response_body text, response_at timestamptz,   -- one right of reply
  status enum('pending','published','under_review','removed')
  unique (engagement_id, reviewer_user_id)

verifications
  id, subject_type enum('user','organization'), subject_id,
  method enum('email_domain','business_registry','document','linkedin','manual'),
  status enum('pending','approved','rejected','expired'),
  evidence_file_ids uuid[],
  reviewed_by uuid fk → users, reviewed_at, notes,
  expires_at                                  -- ID documents deleted after decision

reports
  id, reporter_user_id,
  target_type enum('user','organization','opportunity','message','review','rep_profile'),
  target_id, reason enum(...), details text,
  status enum('open','investigating','actioned','dismissed'),
  handled_by, handled_at, resolution_note

moderation_actions
  id, target_type, target_id, action enum('warn','hide','unpublish','suspend','ban'),
  reason, actor_user_id, expires_at, created_at
```

Verification is **separate from user status** deliberately. A user can be active but
unverified, or verified and then suspended. Collapsing them into one column makes
several real situations unrepresentable.

---

## §8 Platform infrastructure tables

```sql
files
  id, owner_user_id, organization_id,
  bucket enum('avatars','logos','documents','verification'),
  storage_path text, original_filename, content_type, size_bytes,
  checksum, scan_status enum('pending','clean','infected','skipped'),
  visibility enum('private','org','public'),
  created_at, deleted_at

notifications
  id, user_id, type, title, body,
  entity_type, entity_id, read_at, created_at
  -- index (user_id, created_at desc) where read_at is null

notification_preferences
  user_id, notification_type, in_app boolean, email boolean, digest_frequency enum

job_queue
  id, job_type, payload jsonb, idempotency_key unique,
  status enum('pending','processing','succeeded','failed','dead'),
  attempts int, max_attempts int, run_after timestamptz,
  locked_at, locked_by, last_error, created_at
  -- index (status, run_after) where status = 'pending'

email_events
  id, user_id, message_id, template, event enum('sent','delivered','opened',
  'bounced','complained'), payload jsonb, occurred_at

audit_logs                                    -- append-only, no UPDATE/DELETE grant
  id, actor_user_id, actor_role, impersonated_by,
  action, target_type, target_id,
  before jsonb, after jsonb,
  ip_address inet, user_agent, created_at
  -- partitioned by month once volume justifies

match_scores
  rep_profile_id, opportunity_id, score numeric, breakdown jsonb,
  computed_at, primary key (rep_profile_id, opportunity_id)

consents
  id, user_id, policy_type enum('terms','privacy','marketing'),
  policy_version, granted boolean, ip_address, created_at

subscriptions                                 -- Stripe mirror, Phase 9
  id, organization_id, stripe_customer_id, stripe_subscription_id,
  plan enum, status enum, current_period_end, cancel_at_period_end

entitlements                                  -- what feature gates actually read
  organization_id, feature_key, limit_value, resets_at
```

`audit_logs` has `UPDATE` and `DELETE` revoked at the database role level. An
append-only log that an admin can edit is not an audit log.

`entitlements` exists separately from `subscriptions` so that feature gates read one
simple table, and so we can grant an entitlement manually — for a pilot customer, a
support gesture, or a beta — without faking a Stripe subscription.

---

## §9 On `platform_settings`

You listed it. My recommendation is to **keep it very small**, because a generic
key-value settings table is usually an anti-pattern: it becomes untyped, unvalidated,
untested configuration that nobody remembers exists, and changing a value silently
alters production behaviour with no review and no history.

Split it three ways:

| Kind of setting | Where it belongs | Why |
| --- | --- | --- |
| Constants (score weights, page sizes, limits) | Code, version-controlled | Reviewed, tested, revertable via Git |
| Feature flags (staged rollout, kill switches) | PostHog | Built for it, with targeting and audit |
| Genuine operational toggles (maintenance mode, signup open/closed, default plan limits) | `platform_settings` table | Must change without a deploy |

The table stays, typed and small, with every change audited.

---

## §10 Entity relationship overview

```
                          ┌──────────┐
                          │  users   │
                          └────┬─────┘
                 ┌─────────────┼─────────────┐
                 │             │             │
        ┌────────▼──────┐  ┌───▼──────────┐  │
        │ rep_profiles  │  │ org_members  │  │
        └────────┬──────┘  └───┬──────────┘  │
                 │             │             │
                 │      ┌──────▼────────┐    │
                 │      │ organizations │    │
                 │      └──────┬────────┘    │
                 │             │             │
                 │      ┌──────▼────────┐    │
                 │      │ opportunities │    │
                 │      └──────┬────────┘    │
                 │             │             │
     ┌───────────┴─────────────┴──────────┐  │
     │                                    │  │
┌────▼────────┐  ┌─────────────┐  ┌───────▼──┴─────┐
│ applications│  │ invitations │  │saved_opportun. │
└────┬────────┘  └──────┬──────┘  └────────────────┘
     │                  │
     │    ┌─────────────┴──┐
     │    │ conversations  │──< messages
     │    └────────────────┘
┌────▼────────┐
│ engagements │──< reviews
└─────────────┘

Taxonomy (industries, product_categories, territories,
customer_types, sales_models, compensation_types)
  ──< join tables >── rep_profiles AND opportunities

Platform (files, notifications, job_queue, email_events,
audit_logs, reports, verifications, match_scores,
consents, subscriptions, entitlements, platform_settings)
```

**Roughly 45 tables.** That sounds like a lot; about 20 are two-column join tables
or small controlled vocabularies. The genuinely complex ones are `opportunities`,
`applications`, `territories`, and `conversations` — and each is complex because the
domain is, not because the design is.

---

## §11 Build order for the schema

Migrations are applied in this order so that each phase is independently useful and
independently testable:

1. `users`, `organizations`, `organization_members`, `files`, `audit_logs`, `consents`
2. Taxonomy tables + seed data (territories are the big one)
3. `rep_profiles` + rep join tables
4. `opportunities` + `opportunity_compensation` + opportunity join tables
5. `applications`, `saved_opportunities`, `invitations`, `application_status_history`
6. `conversations`, `conversation_participants`, `messages`
7. `engagements`, `reviews`
8. `verifications`, `reports`, `moderation_actions`
9. `notifications`, `notification_preferences`, `job_queue`, `email_events`
10. `match_scores`
11. `subscriptions`, `entitlements`, `platform_settings`

Every migration ships with its RLS policies in the same file. A table is never
created in one commit and secured in another — that gap is exactly where production
data leaks come from.
