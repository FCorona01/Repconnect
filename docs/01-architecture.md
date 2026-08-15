# 01 — Architecture

Covers items 1–8, 13–14, 18–25 of the discovery brief.
Versions listed are latest stable as verified on 2026-08-15.

---

## 1. Technology stack

| Layer | Choice | Version | Why this, not the alternatives |
| --- | --- | --- | --- |
| Language | TypeScript | 5.x | One language across browser, server, database queries, and tests. For a solo non-technical founder, context-switching between languages is a tax with no return. Types catch the class of bug ("you forgot to check the owner") that matters most here. |
| Framework | Next.js (App Router) | 16.3.x | Server-rendered pages (needed for SEO on opportunity listings) plus server-side logic in one deployable unit. React Server Components let us query the database directly in a page without shipping that code to the browser. |
| UI runtime | React | 19.2.x | Required by Next.js; the largest component ecosystem. |
| Styling | Tailwind CSS | 4.3.x | Utility CSS. No separate stylesheet architecture to maintain, no naming debates, responsive breakpoints built in. |
| Components | shadcn/ui (Radix primitives) | — | Accessible, keyboard-navigable, screen-reader-correct components that we **own as source code in our repo**, not a dependency we cannot modify. Accessibility is very hard to retrofit. |
| Database | PostgreSQL (via Supabase) | 16/17 | Relational data with hard integrity constraints. A marketplace is relational to its core. Also gives us full-text search, `ltree` hierarchies, and `pgvector` embeddings with no extra service. |
| Query layer | Drizzle ORM | 0.45.x | SQL-shaped, fully typed, tiny runtime, first-class migrations. Chosen over Prisma because it runs a raw driver we control — which we *need*, to set the per-request database identity described in §6. |
| Validation | Zod | 4.4.x | One schema defines the TypeScript type, the form validation, and the server-side check. Impossible for them to drift apart. |
| Auth | Supabase Auth | — | Email/password with verification, magic link, Google OAuth, MFA, password reset. Building this ourselves would be weeks of work and is the worst possible place to have an original idea. |
| File storage | Supabase Storage | — | S3-compatible, private buckets, signed URLs, already in the account we need for the database. |
| Hosting | Vercel | — | Built by the Next.js team. Preview deployment per pull request, atomic rollback, edge CDN, cron jobs. |
| Email | Resend | 6.20.x | Transactional email with React-based templates, good deliverability, generous free tier. |
| Payments | Stripe | 22.5.x | Not a real decision. Everyone uses Stripe because Stripe is correct. |
| Errors | Sentry | 10.70.x | Stack traces from real user sessions, source-mapped. |
| Analytics | PostHog | 1.417.x | Product analytics, funnels, session replay, and feature flags in one account instead of four. |
| Unit tests | Vitest | 4.1.x | Fast, same config as the build. |
| E2E tests | Playwright | 1.62.x | Real browser, real login, real database. Chromium already present in the build environment. |

### What I deliberately rejected

- **Separate React SPA + separate Node/Nest API.** Two deployments, two sets of
  environment variables, CORS, duplicated types, no server rendering, worse SEO.
  Pure cost, no benefit at this scale.
- **A NoSQL database (MongoDB, Firestore).** Every core question in this product
  is a join — "opportunities in territories this rep covers, in industries they
  know, excluding ones they already applied to". Document stores make that painful
  and make data integrity optional. Referential integrity is a feature here.
- **Algolia / Elasticsearch on day one.** PostgreSQL full-text search handles the
  first 50,000+ opportunities comfortably. Adding a search cluster now means a
  second copy of the data, sync bugs, and a bill, to solve a problem we do not have.
- **A third-party chat SDK (Stream, Sendbird).** Messaging must be gated by
  application status and readable by moderators. A vendor's chat product fights
  both requirements, and it puts your core trust data in someone else's system.
- **A native mobile app.** A responsive web app reaches every device today. Native
  is a second codebase, two app-store review processes, and a release cycle. Revisit
  once there is a retention problem a native app would actually solve.

---

## 2. Frontend architecture

### Rendering strategy — chosen per page for a reason

| Page type | Strategy | Why |
| --- | --- | --- |
| Marketing pages, opportunity detail (public view) | Static or incrementally regenerated | These are the SEO asset. Must be fast and fully rendered in HTML for crawlers. |
| Opportunity browse/search | Server-rendered, filters in the URL | A shareable, bookmarkable, crawlable URL per filter combination. Also means the first result set arrives with the page, not after a spinner. |
| Rep and business dashboards | Server-rendered, private, never cached | Personalised, authorization-sensitive. Cached private data is a data-leak incident waiting to happen. |
| Messaging | Server-rendered shell + realtime subscription | Only place that genuinely needs a live connection. |

### Route structure

```
app/
  (marketing)/            public, indexable, static
  (auth)/                 sign-in, sign-up, verify, reset
  (rep)/                  requires an active rep profile
  (business)/[orgSlug]/   requires membership of that organisation
  (admin)/                requires platform admin role + MFA
  opportunities/[id]/     public detail; private actions revealed by role
  api/                    webhooks and machine endpoints only
```

Route groups are not cosmetic. Each has its own layout that performs the
authorization check once, so a page inside `(admin)/` cannot be reached without
passing the admin gate — and a new page added there inherits the gate by default.
**Secure by default, insecure only by explicit effort.** That is the property we want.

### State management

There is no global state library, deliberately.

- **Server state** (opportunities, applications, messages) lives on the server and
  arrives via Server Components. Not duplicated into a client-side store.
- **URL state** (filters, pagination, sort) lives in the query string. Shareable,
  bookmarkable, survives refresh, works with the back button.
- **Form state** — React Hook Form + the shared Zod schema.
- **Ephemeral UI state** (is this dropdown open) — local `useState`.

Redux/Zustand/Jotai solve a problem this architecture does not have.

### Every screen ships four states

This is a hard rule, enforced in code review, because it is the exact difference
between a real product and a demo:

1. **Loading** — skeleton matching the real layout's shape, never a bare spinner.
   Delivered by React Suspense boundaries so the page shell renders instantly.
2. **Empty** — explains why it is empty and gives the one action that fixes it.
   "No applications yet" is useless. "No applications yet — opportunities matching
   your profile are listed here" plus a button is a product.
3. **Error** — what failed, whether it is retryable, and a retry control. Error
   boundaries are placed per section, so one failed panel does not blank the page.
4. **Success** — the actual content.

A component library type (`AsyncBoundary`) will make omitting any of these
awkward enough that it does not happen by accident.

### Mobile responsiveness (item 25)

Mobile-first, not mobile-adapted. Sales reps are, definitionally, not at a desk.
Concretely:

- Base styles target ~375px; larger breakpoints are additive.
- Tap targets minimum 44×44px.
- Tables become stacked cards below `md` — no horizontal scrolling of data.
- Filter panels become bottom sheets on mobile.
- Forms are chunked into steps on small screens; profile creation is long, and a
  20-field wall on a phone is where reps abandon signup.
- Playwright runs the critical E2E flows at mobile viewport as well as desktop, so
  a regression breaks CI rather than being discovered by a user.

### Accessibility

WCAG 2.2 AA as the target. Radix gives correct keyboard and ARIA behaviour for
free; we add semantic headings, visible focus rings, real form labels, 4.5:1
contrast, and `axe` assertions in the Playwright suite. This is both a legal
consideration for a hiring-adjacent platform in several jurisdictions and, more
practically, the same work that makes the product usable one-handed on a phone.

---

## 3. Backend architecture

### Three entry points, and only three

| Entry point | Used for | Authorization |
| --- | --- | --- |
| **Server Components** | All reads that render a page | Layout gate + repository-level check |
| **Server Actions** | All user-initiated writes | Explicit check inside the action |
| **Route Handlers** (`app/api/*`) | Stripe/Supabase webhooks, cron, file signing, sitemap | Signature verification or shared secret |

There is no general-purpose public REST API in v1. Adding one later is easy; the
one we would build now would be a permanently exposed authorization surface for no
current consumer.

### The layer that matters: the repository

Every single database operation goes through a repository function, and every
repository function takes an `Actor` as its **first, mandatory** argument.

```ts
type Actor =
  | { kind: 'anonymous' }
  | { kind: 'rep';    userId: string; repProfileId: string }
  | { kind: 'member'; userId: string; orgId: string; orgRole: OrgRole }
  | { kind: 'admin';  userId: string; adminLevel: AdminLevel }
  | { kind: 'system'; reason: string };   // cron/webhooks only, always audited

// The signature makes the unsafe version unwriteable.
async function getApplicationsForOpportunity(
  actor: Actor,
  opportunityId: string,
): Promise<Application[]>
```

This is the single most important structural decision in the codebase. It means:

- You cannot write a query that "forgot" authorization — there is no function
  signature that permits it.
- Authorization logic is testable in isolation, without a browser.
- A new engineer (or a future AI agent) cannot accidentally introduce a leak by
  copying a pattern, because the pattern carries the check.

Business rules ("can this rep apply to this opportunity?") live in a `services`
layer above repositories. UI components never contain business rules.

### Server Action discipline

Every Server Action follows the same five steps, in this order, with no exceptions:

1. Resolve the actor from the session cookie (never from an argument).
2. Parse and validate every input with Zod. Reject unknown fields.
3. Authorize — explicitly, against the resolved actor.
4. Execute inside a database transaction.
5. Write an audit log entry if the action is consequential, then revalidate caches.

### Background work

Some things must not run inside a user's request: sending 400 match-alert emails,
recomputing match scores, generating a data export. Design:

- A `job_queue` table in PostgreSQL — jobs are rows, enqueued in the same
  transaction as the change that caused them. This is the **transactional outbox**
  pattern, and it removes the entire class of bug where the database commits but
  the email never sends (or vice versa).
- A Vercel Cron endpoint claims a batch every minute using
  `SELECT ... FOR UPDATE SKIP LOCKED`, so multiple concurrent runs cannot process
  the same job twice.
- Every job carries an idempotency key. Retries with exponential backoff, then a
  dead-letter state that surfaces in the admin console.

No extra vendor. If job volume ever outgrows this, we migrate to a dedicated
runner — but that is a good problem, and this design does not block it.

---

## 4. Database architecture

Full schema in [`02-data-model.md`](02-data-model.md). Architectural principles here:

- **Managed PostgreSQL on Supabase.** Point-in-time recovery, automated backups,
  connection pooling. Running our own Postgres would mean you personally owning
  backup verification and security patching. Not a good trade.
- **Migrations are code.** Drizzle Kit generates SQL migration files, committed to
  Git, applied by CI. Nobody — including me — ever changes production schema by
  clicking in a dashboard. The schema is reproducible from the repository alone.
- **UUIDv7 primary keys.** Random enough to be unguessable in a URL, but
  time-ordered, so they index efficiently. Sequential integers would leak business
  volume ("opportunity #47" tells a competitor everything) and make ID-guessing
  attacks trivially easy.
- **Constraints in the database, not just the app.** Foreign keys, `CHECK`
  constraints, partial unique indexes. The database is the last line of defence and
  the only one that cannot be bypassed by a bug in application code. Example: a
  partial unique index guarantees a rep cannot have two live applications to the
  same opportunity, no matter what the application code does under a race.
- **Soft delete where relationships exist**, hard delete where they do not. A
  deleted user who wrote reviews and sent messages cannot vanish without corrupting
  other people's records; they are anonymised instead. See privacy in
  [`03-security.md`](03-security.md).
- **Connection pooling via Supabase's transaction-mode pooler.** Serverless
  functions create many short connections; PostgreSQL is not built for that. The
  pooler sits between. (This constrains us to no prepared statements — Drizzle
  handles it with one config flag.)

---

## 5. Authentication architecture

**Supabase Auth**, with sessions carried in cookies.

- Email + password, with mandatory email verification before any write access.
- Magic link as an alternative — meaningfully improves signup conversion for reps
  who are on a phone.
- Google OAuth. LinkedIn OAuth is the obvious future addition for this audience
  and is worth adding once we have volume, since it also gives us a light identity
  signal.
- MFA (TOTP) available to all users, **mandatory for admins**.
- Password rules follow current NIST guidance: length over composition, checked
  against known-breached password lists (Supabase does this), no forced rotation.

Session handling:

- Tokens in `httpOnly`, `Secure`, `SameSite=Lax` cookies. JavaScript cannot read
  them, so cross-site scripting cannot steal a session.
- Refresh handled server-side in Next.js middleware.
- **Every server request re-verifies the session against Supabase.** We never trust
  a decoded token body alone. This is the difference between real authentication
  and a check that can be forged.
- Sign-out revokes server-side, not just clearing the cookie.

`users.id` in our own database is the identity everything else references —
Supabase's auth user is linked to it, not the other way round. If we ever change
auth provider, the domain data does not move.

---

## 6. Authorization and roles

Two independent dimensions, deliberately not collapsed into one "role" column:

**Platform role** — on the user: `member` | `admin` | `superadmin`.

**Organisation role** — on the membership row linking a user to a business:
`owner` | `admin` | `recruiter` | `viewer`.

This separation matters because **a person can be both a rep and part of a
business.** A fractional VP of Sales might sell their own time *and* hire reps for
a company they advise. A single `role` column would force them into two accounts,
which is a bad experience and, worse, it fragments their reputation — the thing
the marketplace runs on.

Enforcement happens at **three** layers, all active simultaneously:

1. **Middleware** — coarse routing. Not signed in? Not reaching `/rep/*`. This is
   for user experience (a clean redirect), not security.
2. **Repository layer** — the real check. Ownership and membership verified in the
   query itself, in the same round trip as the read. Not a separate "can they?"
   query that could race.
3. **Row Level Security in PostgreSQL** — the backstop, described below.

### Row Level Security, done properly

Most Supabase tutorials do one of two things, and both are wrong for us:

- Let the browser query the database directly, with RLS as the only defence.
  A single missing policy on a single new table is a total data breach.
- Query from the server with an all-powerful service key. Convenient, but RLS is
  bypassed entirely and provides zero protection.

**What we will do instead:** the server opens its database transaction and, inside
it, sets the requesting user's identity for the duration of that transaction
(`SET LOCAL request.jwt.claims`). PostgreSQL then enforces RLS *even though the
query came from our server*.

The result is that both walls are genuinely load-bearing at once. An authorization
bug in application code is caught by the database. A missing RLS policy is caught
by application code. Both would have to fail on the same table, in the same way,
at the same time, for data to leak.

Every table gets RLS enabled and **deny-by-default**. A new table with no policy
returns zero rows rather than everything — a mistake fails closed, loudly, in
development, instead of quietly in production.

The elevated path (`{ kind: 'system' }`) exists for cron jobs and webhooks, is
confined to a handful of named functions, and every use writes an audit row.

---

## 7. File storage (item 7)

**Supabase Storage**, four buckets, **all private**:

| Bucket | Contents | Who may read |
| --- | --- | --- |
| `avatars` | Profile photos | Anyone who can view the profile |
| `logos` | Company logos | Public (they are marketing assets) |
| `documents` | Resumes, portfolios, case studies | Owner + businesses the rep applied to |
| `verification` | ID and business registration documents | Admins only. Never the counterparty. |

Rules, without exception:

- **No bucket is publicly listable.** Every download is a signed URL, valid for
  minutes, generated by our server *after* an authorization check. A leaked URL
  expires; a public bucket never does.
- Uploads go through our server, which validates: file size cap, extension **and**
  magic-byte content type (an attacker renames `.exe` to `.pdf`; the bytes do not
  lie), and a filename we generate ourselves (never the user's, which is a path
  traversal vector).
- Stored filenames are random UUIDs. The real name is a database column.
- EXIF metadata stripped from images — it contains GPS coordinates, and reps
  uploading a photo should not be broadcasting their home address.
- Downloads served with `Content-Disposition: attachment` so an uploaded HTML file
  cannot execute in our origin.
- Verification documents get a short retention period and are deleted after the
  decision. Holding government ID indefinitely is a liability with no upside.

---

## 8. Search (item 8)

**PostgreSQL-native. No search vendor now.** Reasoning: a vendor means a second
copy of the data, a sync pipeline that will develop bugs, and a bill — to solve a
scale problem we will not have for a long time.

Design:

- **Structured filters** (industry, territory, sales model, compensation type,
  customer type) run against normalised join tables with GIN indexes. This is the
  primary way people search, and it is exact, fast, and correct.
- **Free-text** over titles and descriptions uses a `tsvector` generated column
  with a GIN index, weighted so a title match outranks a description match.
- **Fuzzy matching** for company and person names via `pg_trgm`, so "Salesforce"
  finds "SalesForce" and typos still work.
- **Territory-aware search** uses the `ltree` hierarchy — searching "California"
  returns opportunities scoped to San Diego, and searching "San Diego" returns
  opportunities scoped to California or Nationwide. This bidirectional behaviour is
  what makes territory search feel intelligent, and a flat text column cannot do it.
- **Keyset pagination**, not `OFFSET`. Offset pagination degrades badly and shows
  users duplicate rows when the underlying data changes between pages.

**The migration trigger, stated in advance so it is not a judgement call later:**
move to Typesense or Meilisearch when p95 search latency exceeds 300ms on
production data, or when we need typo-tolerant instant-search-as-you-type. Until
one of those is true, adding a search service is architecture theatre.

---

## 9. Matching engine (item 9)

Built in three stages. Stage 1 ships in Phase 7; the rest wait for data.

**Stage 1 — deterministic, explainable, in SQL.**

A weighted score computed from overlap between rep attributes and opportunity
requirements:

| Signal | Weight | Notes |
| --- | --- | --- |
| Industry overlap | 25% | Jaccard-style overlap, not binary |
| Territory overlap | 25% | Hierarchy-aware; "Nationwide" matches everything |
| Customer type (SMB/mid-market/enterprise) | 15% | The most under-rated predictor — enterprise and SMB selling are different jobs |
| Sales model (hunting/farming/inside/field/channel) | 15% | |
| Compensation compatibility | 10% | Hard gate, not a score: a rep who requires a base salary must never be shown commission-only roles |
| Experience level vs. seniority required | 5% | |
| Product category overlap | 5% | |

Then modifiers: recency of opportunity, rep responsiveness, profile completeness,
verification status.

**Explainability is a requirement, not a nice-to-have.** Every score renders as
"Strong match — you've sold MedTech to hospital systems in the Southwest, which is
exactly this role." An opaque score is not trusted, is not acted on, and cannot be
debugged when it is wrong.

**Stage 2 — learn from outcomes.** Once there are a few thousand applications, we
know which matches produced accepted applications and completed engagements. Tune
weights against that, per-segment. Still a linear model — still explainable.

**Stage 3 — semantic matching with `pgvector`.** Attribute matching cannot tell
that "SaaS for dental practices" and "practice management software for clinics" are
the same market. Embeddings can. `pgvector` is already available in Supabase, so
this adds **no new service** — one extension, one column, one index.

Precomputation: scores materialise into a `match_scores` table refreshed by the job
queue when a profile or opportunity changes. Computing 10,000 scores inside a page
request is not viable; reading precomputed rows is trivial.

---

## 10. Messaging (item 10)

PostgreSQL for storage, Supabase Realtime for live delivery.

**The critical design decision — conversations are context-scoped.** A conversation
cannot exist in a vacuum. It is always attached to an application or an invitation.

Why this matters more than it looks:
- It prevents cold-message spam, which is the single fastest way to make reps
  abandon a marketplace.
- It gives every conversation a subject and a state, so both inboxes stay coherent.
- It gives moderators the context to adjudicate a report.
- It preserves RepConnect's position in the relationship, which is the whole
  business.

Implementation: `conversations` → `conversation_participants` → `messages`, with
per-participant read cursors (`last_read_at`) rather than a per-message read flag,
which does not scale. Attachments reuse the storage rules from §7. Realtime
subscriptions are authorized by participant membership, verified server-side —
a client cannot subscribe to a conversation it is not in.

**Anti-disintermediation:** messages are scanned for email addresses and phone
numbers. In the free tier these are masked with an explanation; this is a normal,
expected marketplace mechanic, and it must be *visible* rather than silent, or it
reads as broken software. It should also be a deliberate business decision, not a
default — see [`05-monetization.md`](05-monetization.md).

---

## 11. Notifications (item 11)

Three channels, one pipeline.

| Channel | Phase | Use |
| --- | --- | --- |
| In-app | 1 | Everything. A `notifications` table, unread badge, notification centre. |
| Email | 1 | Anything that needs the user to come back: new application, new message, invitation, status change. |
| Web push | Later | Only if engagement data shows it is needed. |

Every notification type flows through one function that checks the user's
per-type, per-channel preferences, then enqueues the delivery job. Adding a
notification type never means touching delivery logic.

Non-obvious requirements that cause real problems if skipped:

- **Digest, don't flood.** A business posting an opportunity that matches 200 reps
  must not send 200 individual "you have a new applicant" emails. Batch and
  window.
- **Unsubscribe must work, per-type, one click, no login.** Legally required, and
  a broken unsubscribe link is how a sending domain gets blacklisted — which takes
  weeks to recover from and breaks password resets in the meantime.
- **Transactional and marketing email must be separated at the provider level.** If
  a marketing send damages the domain reputation, password reset emails must not
  stop arriving. Use a subdomain for each.

---

## 12. Reviews and reputation (item 12)

The trust layer. Rules that prevent it from becoming worthless:

- **A review requires a completed engagement.** Not an application, not a
  conversation — an `engagement` row that both parties confirmed. Reviews unattached
  to a verifiable transaction are noise, and the marketplace's credibility dies
  with them. (`engagements` is a table you did not list. It is necessary. See
  [`02-data-model.md`](02-data-model.md).)
- **Double-blind release.** Neither side sees the other's review until both have
  submitted, or a 14-day window closes. Otherwise reviews are retaliatory and
  everyone rates 5 stars defensively.
- **Structured plus free-text.** Ratings across specific dimensions
  (communication, reliability, results, accuracy of the brief) are far more useful
  than one star count, and far harder to game.
- **Immutable once published**, with a one-time right of reply. Editable reviews
  invite pressure campaigns.
- **Aggregates are computed and cached**, never recalculated on read.
- **Low-volume reputations show sample size prominently.** "5.0 from 1 review" must
  not visually outrank "4.6 from 40 reviews", or the incentive is to farm one
  review and stop.

---

## 13. Admin architecture (item 13)

A route group inside the same application — **not** a separate app. A separate
admin app means duplicated models, a second deployment, and a second auth system
to secure. Same codebase, hard walls:

- `(admin)/` layout gate requires `platform_role IN ('admin','superadmin')`.
- **MFA mandatory** for any admin session.
- Admin repository functions are physically separate modules, so an admin-scoped
  query can never be imported into a user-facing page by autocomplete accident.
- **Every admin action is audited** — actor, action, target, before/after values,
  IP, timestamp — into an append-only table. Admins cannot delete audit rows.
- **Impersonation** ("view as user") is supported because support is impossible
  without it, is visually unmistakable while active, is time-limited, and is
  audited at start and end. Impersonated sessions are read-only by default.
- Admin role is granted **only by database migration or by a superadmin**. There is
  no self-service path, no invite flow, no "promote" button reachable by a normal
  user. This closes your "normal users accessing admin functions" concern at the
  structural level rather than the check level.

Capabilities: user/business/rep management, opportunity moderation, verification
queue, report queue, taxonomy management (industries, categories, territories,
compensation types), analytics, audit log search, feature flags.

---

## 14. Analytics (item 14)

Two distinct things, often confused:

**Product analytics — PostHog.** Funnels (visit → signup → profile complete →
first application), retention cohorts, session replay for watching where reps
abandon the profile form, and feature flags for staged rollout. Self-hostable and
EU-hosted if data residency ever matters.

**Business analytics — PostgreSQL.** The marketplace health metrics live in your
own database and are queried directly for the admin dashboard:

- Liquidity: % of opportunities receiving ≥1 application within 7 days
- Match quality: application → acceptance rate
- Time to first application; time to fill
- Supply/demand ratio per industry × territory — **this is the metric that tells
  you where the marketplace is actually working**, and it is the one that should
  drive your sales effort
- Repeat usage rate per business

Marketplace health is not a vendor dashboard question. It is a SQL question over
data you own, and it belongs in the admin console.

Web vitals come free from Vercel Analytics. No cookie banner is needed for that.

---

## 15. Deployment (item 19)

```
feature branch → PR → CI (lint, typecheck, unit, E2E, security scan)
              → Vercel preview deploy with an isolated database branch
              → review → merge to main
              → migrations run → production deploy → smoke test
```

- **Three environments:** local (Docker PostgreSQL — already available in this
  environment), preview (per-PR, seeded, disposable), production.
- **Every PR gets its own URL.** You can click through a change before it is real.
  For a non-technical founder this is the single most valuable thing in the
  pipeline — you can review the product, not the code.
- Migrations run before the new code goes live, and must be
  backwards-compatible for one release, so a rollback does not strand the database.
- Secrets live in Vercel environment variables and GitHub Actions secrets. Never in
  the repository. A pre-commit hook and a CI secret-scanner enforce this.
- **Region co-location:** Vercel functions and the Supabase project must be in the
  same region (recommend `us-east-1`). Cross-region adds 80–150ms to every single
  database query, and it is very difficult to change later.

---

## 16. Testing (item 20)

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | Scoring maths, validation schemas, state machines, date/territory logic |
| Integration | Vitest + real PostgreSQL in Docker | Repository functions against a real database with real constraints |
| **Authorization** | Vitest + PostgreSQL | **See below** |
| E2E | Playwright | The full journeys: signup → profile → apply → message → accept → review |
| Accessibility | axe in Playwright | Automated WCAG checks on every key page |
| Load | k6 | Before launch, against realistic data volume |

**The authorization suite is the highest-value tests in this codebase.** A
table-driven matrix asserts, for every protected resource, that:

- Rep A cannot read, update, or delete Rep B's anything
- Business A cannot see Business B's applicants, opportunities, or messages
- A non-member cannot act on an organisation
- A normal user hits every admin route and gets denied
- Substituting another user's ID into any Server Action fails
- Deny-by-default holds: **a newly added table with no policy returns nothing**

That last one is what stops the codebase from decaying. Add a table, forget a
policy, CI fails. Security stays enforced by the build rather than by memory.

Target: ~80% coverage on business logic, **100% on authorization paths.** Coverage
elsewhere is a vanity metric.

---

## 17. Scalability (item 21)

Target: thousands of businesses, tens of thousands of reps. Honest assessment —
**this is not a large system.** Tens of thousands of rows is small for PostgreSQL.
The failure mode will not be data volume; it will be bad queries.

What we do now because it is cheap now and expensive later:

- Indexes designed alongside each query, not added after a slowdown.
- Keyset pagination everywhere. No unbounded queries. Every list has a hard cap.
- No N+1 queries — enforced by a dev-mode query counter that fails tests.
- Precomputed match scores and cached review aggregates.
- Vercel's CDN for static and public pages; opportunity pages cached with tag-based
  invalidation so an edit is live immediately.

What we explicitly do **not** do now: microservices, read replicas, sharding,
Kubernetes, a message broker, a caching layer. Every one of these solves a problem
we do not have, at the cost of complexity you cannot operate alone. The scaling
plan is "measure, then fix the specific slow thing" — which works, and which the
alternatives actively prevent.

Documented next steps, in order, if load ever demands it: read replica for search →
Redis for hot caches → dedicated search engine → queue workers off the cron path.

---

## 18. Error handling (item 22)

- **Typed results, not thrown exceptions, for expected failures.** "Already applied"
  is a normal outcome, not an exception. Server Actions return a discriminated
  union `{ ok: true, data } | { ok: false, error }`, so the UI is forced by the
  type system to handle both.
- **Unexpected errors** are caught by error boundaries per page section, logged to
  Sentry with a correlation ID, and shown to the user as "something went wrong —
  reference `abc123`". Never a stack trace, never a raw database error message —
  both leak schema details to an attacker.
- **User-facing messages are actionable.** "That opportunity closed while you were
  applying" instead of "Error 500".
- **Every write is a transaction.** Partial writes are the origin of the worst
  class of data bug: an application row with no notification, a message with no
  conversation.
- **Retries with backoff** on transient infrastructure failures. Idempotency keys on
  anything that must not double-execute (payments, emails, invitations).
- **Validation runs on the client for speed and on the server for truth.** Client
  validation is a convenience; it is not security and is never treated as such.

---

## 19. Monitoring (item 23)

| Concern | Tool |
| --- | --- |
| Application errors | Sentry — source-mapped stack traces, release tracking, alerts |
| Performance / Core Web Vitals | Vercel Analytics |
| Database health | Supabase dashboard — slow query log, connection count, disk |
| Uptime | Better Stack free tier, hitting a real health endpoint |
| Business metrics | PostHog + admin dashboard |

The health endpoint checks the database, storage, and job queue — not just "the
web server responded", which is the useless version of a health check.

**Alerts that reach your phone** (a small, deliberate list — an alert that fires
often gets ignored, and then the real one is ignored too):

- Error rate above baseline
- Any payment webhook failure
- Job queue depth growing or dead-letter jobs appearing
- Signup or application rate dropping to zero (silent breakage — the most dangerous
  kind, because nothing looks wrong)
- Database above 80% of any limit

---

## 20. SEO (item 24)

Opportunity pages are the organic acquisition channel. Concretely:

- **Server-rendered HTML** for every public page. Crawlers get content, not an
  empty div.
- **`JobPosting` structured data** on opportunity pages. This is what makes listings
  eligible for Google's job experience. Note: commission-only and contract roles
  have specific structured-data requirements around compensation disclosure, and
  getting them wrong means silent exclusion — worth doing carefully.
- **Programmatic landing pages** — `/sales-reps/medical-devices/texas` — generated
  from the taxonomy. This is the highest-leverage SEO play available to a
  marketplace, because it produces thousands of genuinely relevant pages from data
  you already have. It only works if the taxonomy is well designed, which is
  another reason Phase 2 matters so much.
- Dynamic `sitemap.xml`, correct `robots.txt`, canonical URLs on filtered views to
  avoid duplicate-content dilution, OpenGraph images per opportunity.
- **Rep profiles are `noindex` by default.** Many reps have current employers. A
  publicly indexed profile is a serious problem for them and would suppress signup.
  Opt-in to public indexing, never opt-out.

---

## 21. Privacy (item 17)

Treated as an architectural requirement, because retrofitting it is expensive.

- **Data minimisation.** We do not collect date of birth, government ID (except
  transiently for verification), or precise location. Every field must justify
  itself.
- **Rep profile visibility is a first-class control** with three levels: public /
  visible to businesses only / visible only to businesses I have applied to. This
  is not a nicety — a rep who cannot control who sees their profile will not create
  one, and supply is the hard side of this marketplace.
- **Right to export** — a job that produces a complete JSON archive of the user's data.
- **Right to deletion** — implemented as anonymisation, because messages, reviews,
  and engagements involve a counterparty whose records cannot be destroyed. The user's
  identity is severed and personal data purged; the counterparty's history stays
  intact. This is both the legally correct and the operationally correct answer.
- **Consent records** are rows, with timestamp, IP, and policy version — so we can
  prove what someone agreed to and when.
- **Subprocessor list** maintained from day one: Supabase, Vercel, Resend, Stripe,
  Sentry, PostHog. Required for a privacy policy, and trivial now versus
  archaeological later.
- **Cookie banner only if we set non-essential cookies.** PostHog can run in a
  cookieless mode. Fewer banners, fewer compliance surfaces, better UX.
- Data residency: pick US or EU hosting at project creation. **Changing it later
  means a migration.** Worth thirty seconds of thought now.

---

## 22. Payments and email

Covered in detail in [`05-monetization.md`](05-monetization.md) and
[`04-services.md`](04-services.md) respectively. Two principles worth stating here
because they are architectural:

- **Stripe webhooks are the source of truth for subscription state**, never the
  browser redirect after checkout. Users close tabs, networks drop, and redirects
  can be forged. The webhook is the only signal that is both reliable and
  trustworthy. Subscription state mirrors into our database; an `entitlements`
  table is what feature gates actually read.
- **Email sending is transactional-outbox driven** like every other background job,
  so we never lose an email because a request timed out, and never send one twice.
