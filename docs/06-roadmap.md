# 06 — Implementation Roadmap

Nine phases. Each has a definition of done that must pass before the next begins.

Timeline assumes focused, continuous work. Treat the sequence as fixed and the
weeks as estimates.

---

## Why this order

Three principles govern the sequence, and each one prevents a specific, common,
expensive failure:

1. **Security infrastructure comes before features.** Retrofitting authorization
   means touching every query in the codebase. Building it first costs a week;
   adding it later costs a month and leaks data in the meantime.
2. **The taxonomy comes before anything that uses it.** Industries, territories,
   customer types, and sales models are referenced by profiles, opportunities,
   search, and matching. Changing them after data exists means migrating live user
   records — the most expensive kind of change there is.
3. **The transaction path comes before intelligence.** Matching, recommendations,
   and notifications are refinements of a loop that must already work. Building a
   recommendation engine before anyone can apply to anything is building on air.

---

## Phase 0 — Foundations · Week 1

**Blocked on:** your Supabase account.

- Next.js + TypeScript project, strict compiler settings
- Tailwind + shadcn/ui, design tokens, dark mode
- Drizzle connected to Supabase, migration pipeline working
- Local development database in Docker
- ESLint, Prettier, `lint-staged`, commit hooks
- Vitest and Playwright configured, both running in CI
- GitHub Actions: lint → typecheck → test → build on every PR
- Secret scanning in CI and pre-commit
- Deployed to Vercel, preview deployments per PR
- Health check endpoint (database + storage + queue, not just "server responded")

**Done when:** I push a change to a branch, CI runs, a preview URL appears, you open
it in a browser and see a page. The pipeline works end to end before any feature
exists.

---

## Phase 1 — Identity and access · Week 2

- `users`, `organizations`, `organization_members`, `files`, `audit_logs`, `consents`
- Signup, login, logout, email verification, password reset
- Google OAuth; MFA for admins
- Session middleware; cookie handling; suspension terminates sessions immediately
- The `Actor` type and repository pattern established
- Route group gates for rep / business / admin
- RLS enabled deny-by-default, with the automated test that proves it
- **The authorization test matrix, seeded with its first cases**
- Admin bootstrap by migration
- Audit logging on every consequential write

**Done when:** the authorization test suite is green, a normal user is denied at
every admin route, and RLS provably blocks cross-user reads at the database level.

**This phase is the foundation of every security guarantee in
[`03-security.md`](03-security.md). It does not get compressed.**

---

## Phase 2 — Taxonomy and profiles · Weeks 3–4

- All taxonomy tables, seeded: industries, product categories, **territories with
  the full `ltree` hierarchy**, customer types, sales models, compensation types
- Admin CRUD for every taxonomy
- Rep profile: multi-step creation, all attributes, visibility controls
- Organisation profile: company details, logo, team members with roles
- Avatar and logo upload through the secure file pipeline
- Profile completeness scoring
- Public profile pages with role-specific field projections

**Done when:** a rep can build a complete profile on a phone, a business can create
an organisation and invite a colleague, and profile visibility settings demonstrably
control who sees what.

**Territory seeding is the highest-risk task in this phase.** Getting the hierarchy
right now is dramatically cheaper than migrating dirty territory data later. Budget
real time for it.

---

## Phase 3 — Opportunities · Weeks 5–6

**Also: buy the domain and start Resend DNS this phase** — propagation is on the
critical path.

- `opportunities` + `opportunity_compensation` + attribute joins
- Create/edit with draft → review → publish state machine
- Compensation builder (base, commission, OTE, retainer, equity)
- Public browse with faceted filters, all state in the URL
- PostgreSQL full-text search with weighted ranking
- Territory-aware search using the hierarchy
- Keyset pagination
- Public opportunity detail page: server-rendered, `JobPosting` structured data
- Sitemap, robots, canonical URLs
- Business dashboard: list, edit, pause, close

**Done when:** a business can post an opportunity that appears in search, on a
public SEO-ready page, findable by industry, territory, and compensation type — with
loading, empty, and error states on every screen.

---

## Phase 4 — The transaction · Weeks 7–8

The core loop. Everything before this was setup.

- `applications` with the full status state machine and history
- Apply flow: cover note, attachments, duplicate prevention at the database level
- Rep application tracker
- Business applicant pipeline: view, shortlist, reject with reason, advance stage
- `saved_opportunities`
- `invitations` — business searches reps, shortlists, invites
- Rep directory search for businesses, with field-level projections
- `engagements` — created on acceptance, confirmed by both sides
- In-app notifications for every status change
- Rate limits on applications and invitations

**Done when:** the full loop works end to end — rep applies, business reviews,
shortlists, accepts, an engagement is created and both parties confirm it — and the
authorization matrix proves Business A cannot see Business B's applicants.

---

## Phase 5 — Messaging · Week 9

- `conversations`, `conversation_participants`, `messages`
- Context-scoped: a conversation exists only against an application or invitation
- Realtime delivery via Supabase, authorized by participant membership server-side
- Read cursors, unread counts, inbox ordering
- Attachments through the secure file pipeline
- Contact-information detection and tier-appropriate masking
- Report-a-message into the moderation queue
- Email notification for unread messages, digested not per-message

**Done when:** two users converse in real time, a third cannot subscribe to their
conversation, and cold messaging is structurally impossible.

---

## Phase 6 — Trust, safety and admin · Weeks 10–12

The longest phase, and the one most often skipped. Skipping it is how marketplaces
become unusable at exactly the moment they get traction.

- `verifications`: email domain, business registry, document upload, admin queue
- `reviews`: double-blind release, structured dimensions, right of reply, aggregates
- `reports` and `moderation_actions` with a full moderation queue
- **The admin console:**
  - User, organisation, and rep management
  - Opportunity moderation
  - Verification queue
  - Report queue with actions
  - Taxonomy management
  - Audit log search
  - Platform analytics dashboard (marketplace liquidity metrics)
  - Suspension and reinstatement
  - Time-limited, audited impersonation
- Admin MFA enforced
- GDPR: data export job, deletion-by-anonymisation

**Done when:** you can operate the platform entirely from the admin console without
ever touching the database, and every admin action appears in the audit log.

---

## Phase 7 — Intelligence · Weeks 13–14

- Matching engine, stage 1: weighted deterministic scoring in SQL
- **Explainable match reasons rendered in the UI** — not just a number
- `match_scores` precomputed via the job queue
- Recommendations for reps ("opportunities for you") and businesses ("reps to invite")
- Match-alert emails, digested by preference
- Full notification preference centre
- All transactional email templates, live
- Bounce and complaint handling; one-click unsubscribe
- Job queue running the whole email pipeline

**Done when:** a rep signing in sees relevant opportunities with a plain-English
reason for each, and every email type sends reliably with working unsubscribe.

---

## Phase 8 — Launch readiness · Week 15

**Nothing here is optional. This is the gate before real users.**

- Sentry, PostHog, uptime monitoring, alerting to your phone
- Full security checklist from [`03-security.md`](03-security.md) passed
- Penetration pass against OWASP Top 10
- Load test with realistic data volume (k6)
- Core Web Vitals green on mobile
- Accessibility audit — WCAG 2.2 AA
- Full Playwright journeys passing at mobile and desktop viewports
- **Backup restore rehearsed for real, at least once**
- Legal pages: terms, privacy, cookie policy, subprocessor list
- Incident response runbook
- Seed data and manual onboarding plan for the first cohort

**Done when:** every box in the security checklist is ticked and a database restore
has actually been performed, not merely assumed to work.

---

## Phase 9 — Monetization · When justified

**Trigger, stated in advance so it is not an emotional decision later:** businesses
are reliably receiving quality applications within a week of posting, and some are
posting a second opportunity. Not before.

- Stripe integration: Checkout, Billing, Customer Portal, Tax
- `subscriptions` and `entitlements`
- Webhook handler: signature verification, idempotency, out-of-order tolerance
- Feature gates reading entitlements
- Upgrade and downgrade flows, including over-limit handling that destroys nothing
- Dunning and payment-failure emails
- Billing section in the business dashboard
- Revenue metrics in the admin console

**Done when:** a business can subscribe, upgrade, downgrade, and cancel; entitlements
update correctly from webhooks alone; and a failed payment degrades access without
destroying data.

---

## What happens after

Not committed to — this is where judgement replaces plan, informed by real usage:

- LinkedIn OAuth and profile import (large signup-friction reduction for reps)
- Matching stage 2: weights tuned against real acceptance outcomes
- Matching stage 3: semantic matching with `pgvector`
- Programmatic SEO landing pages from the taxonomy
- Referral loops (reps referring reps is the cheapest supply channel a marketplace has)
- Public API for ATS/CRM integration
- Team collaboration features for larger businesses
- Native mobile app — only if retention data justifies a second codebase

---

## Standards that apply to every phase

Not a phase. A definition of "done" that holds throughout.

Nothing ships without:

- Real database functionality — no mocked data, ever
- Real authorization, covered by the test matrix
- Loading, empty, error, and success states on every screen
- Zod validation on client and server
- Tests: unit for logic, integration for repositories, E2E for the journey
- Mobile layout verified at 375px
- Keyboard navigable, screen-reader labelled
- Audit logging on consequential writes

**If a feature cannot be finished to this standard within a phase, it moves to the
next phase rather than shipping incomplete.** A half-built feature in production is
worse than an absent one: it generates support burden, damages trust, and gets
forgotten in exactly the state that makes it dangerous.

---

## Blocking dependencies

| Phase | Needs from you | Lead time |
| --- | --- | --- |
| 0 | Supabase account | **Now** |
| 0 | Vercel account | 5 min, week 1 |
| 3 | Domain purchased | ~1 week before phase 5 |
| 3 | Resend + DNS records | ⚠️ Up to 48h propagation |
| 8 | Sentry + PostHog accounts | 5 min total |
| 8 | Legal review of terms/privacy | Recommend a lawyer; 1–2 weeks |
| 9 | Stripe account verified | ⚠️ Several days |

The two that catch people out are **DNS propagation** and **Stripe verification**.
Both are waiting, not working, and neither can be accelerated. I will flag each one
several weeks early.
