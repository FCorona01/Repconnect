# 08 — Phase 0: What Was Built and How to Connect It

Written for a non-technical reader. Every command is copy-paste.

---

## What exists now

The foundation described in [`06-roadmap.md`](06-roadmap.md) Phases 0 and 1, built
and verified against a real PostgreSQL 16 database — the same version Supabase runs.

| Area | State |
| --- | --- |
| Next.js 16 + TypeScript + Tailwind 4 | ✅ Builds, 5 routes |
| PostgreSQL schema | ✅ 7 tables, 5 migrations |
| Row Level Security | ✅ Enabled, forced, deny-by-default on every table |
| Authentication (Supabase Auth) | ✅ Code complete — needs your project keys |
| Organisations + members + roles | ✅ With atomic owner creation |
| Authorization test matrix | ✅ 32 tests, all passing |
| E2E smoke tests | ✅ 8 passing, desktop + mobile viewports |
| CI pipeline | ✅ Typecheck, lint, test, security verify, build, E2E |
| Secretless migration pipeline | ✅ See §3 |

**Verified, not assumed:**

```
typecheck   clean
lint        clean
unit/integration   32 passed (32)
e2e         8 passed, 2 skipped (need a live Supabase project)
build       succeeded
security    5/5 invariants hold
```

---

## §1 The security model, in one page

The rule that shapes everything: **the browser never talks to the database.**
Many Supabase tutorials let it. We do not, because a marketplace is a system where
users are actively motivated to see each other's data.

Three walls, all switched on at once:

**Wall 1 — the route gate.** Middleware redirects signed-out visitors away from
private pages. This is for user experience, not security. It is never the only thing
protecting anything.

**Wall 2 — the repository layer.** Every function that touches the database takes
"who is asking" as its first, mandatory argument. There is no version of these
functions without it, so a query that forgot to check permissions is not something
this codebase can express.

**Wall 3 — the database itself.** This is the unusual part, and the most valuable.

Normally, code running on your own server can read anything — the database trusts
it. That means a bug in the code is a data breach. Instead, before every query, the
app tells the database *who the request is for*, then **drops its own privileges**
for the length of that query. The database then enforces the rules itself.

So a mistake in the code is caught by the database, and a mistake in the database
rules is caught by the code. Both would have to be wrong in the same way, on the
same table, at the same moment, for data to leak.

This is proven, not claimed — `tests/rls.test.ts` demonstrates the privilege drop
actually happens, and that the identity does not leak into the next request.

**A guardrail that keeps it true over time:** a test fails if *any* table exists
without security enabled. Add a table in Phase 3 and forget its rules, and the build
breaks before it ever reaches real data.

### The bug this already caught

While building, the org-creation flow tried to insert its own owner record — and the
database refused it, because the creator was not yet a member of the organisation
they had just created. That is Wall 3 doing its job on the very first day, on my
code. It was fixed by writing the real rule ("the person who created an organisation
may claim ownership of it, once, while it has no members"), not by weakening the
protection.

---

## §2 What is in the database

Seven tables. Deliberately small — this is identity and access only. Profiles,
opportunities, and applications arrive in Phases 2–4.

| Table | Purpose |
| --- | --- |
| `users` | Identity, platform role, account status |
| `organizations` | Businesses |
| `organization_members` | Who belongs to which business, and with what role |
| `files` | Every upload, with its access rules |
| `audit_logs` | Append-only record of consequential actions |
| `consents` | Proof of what a user agreed to, and when |
| `schema_migrations` | Which migrations have run |

**Two roles, on purpose:**

- **Platform role** — `member`, `admin`, `superadmin`. Who you are on RepConnect.
- **Organisation role** — `owner`, `admin`, `recruiter`, `viewer`. Who you are inside
  one business.

Kept separate because one person can be both a sales rep and part of a business. A
single "role" column would force them into two accounts and split their reputation —
the asset the whole marketplace runs on.

**Admin cannot be self-granted.** There is no signup option, no invite flow, no
button. The first superadmin is created by running a command against the database
(§5). After that, only a superadmin can promote others, never themselves, and every
change is audited.

---

## §3 Connecting your Supabase project — without sending me anything

You asked that no keys pass through this chat. Here is the path that honours that,
and is better practice anyway: **your credentials go into GitHub's encrypted secrets,
which I cannot read, and a workflow uses them to set up your database.**

### 👉 Step 1 — Copy your connection string from Supabase

1. Open your Supabase project.
2. **Project Settings → Database → Connection string**.
3. Select the **Direct connection** tab (port **5432**, *not* 6543).
4. Copy it. It looks like
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres`.
5. Replace `[YOUR-PASSWORD]` with the database password you saved when creating the
   project.

### 👉 Step 2 — Store it in GitHub, where it stays encrypted

1. Go to your repository on GitHub.
2. **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `SUPABASE_DIRECT_DATABASE_URL`
4. Value: paste the connection string.
5. **Add secret.**

GitHub encrypts it and masks it in all logs. I cannot read it, and neither can anyone
browsing the repository.

### 👉 Step 3 — Run the migration workflow

1. Repository → **Actions** tab.
2. Select **"Apply migrations to Supabase"** in the left sidebar.
3. **Run workflow** → type `apply` in the confirmation box → **Run workflow**.

It applies all five migrations and then verifies the security invariants on your real
database. Green tick = your database is built and provably secure.

If it fails, the log will say why without revealing the connection string.

### 👉 Step 4 — Tell me it is done

That is all I need. No keys, no strings, no passwords.

> **Why the direct connection, not the pooled one?** Migrations create database roles
> and run other session-level statements that the pooled connection cannot carry. The
> app itself will use the pooled connection later — that one is for many short
> queries, this one is for a few long ones.

### Alternative, if you would rather not use GitHub Actions

Open the **SQL Editor** in Supabase and run the contents of each file in
`supabase/migrations/` in order (0001 → 0005). Slower and manual, but identical
result. The workflow is better because it is repeatable and keeps a record.

---

## §4 Running it locally (optional)

You do not need this to keep making progress. It is here for when you want to click
around the app yourself.

```bash
# One-time
pnpm install
cp .env.example .env.local        # then fill in the Supabase values

# Start a local database (Docker)
pnpm db:up
pnpm db:migrate

# Run the app
pnpm dev                          # → http://localhost:3000
```

Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm verify` | Typecheck, lint, and all tests — run before every commit |
| `pnpm test` | The authorization matrix and RLS guarantees |
| `pnpm test:e2e` | Browser tests, desktop and mobile |
| `pnpm db:migrate` | Apply any new migrations |
| `pnpm db:reset` | Wipe and rebuild the local database (refuses to run on anything but localhost) |
| `pnpm db:studio` | Browse the database in a GUI |

---

## §5 Making yourself an administrator

Once the database is live and you have signed up through the app:

```bash
pnpm exec tsx scripts/promote-admin.ts you@example.com superadmin
```

This is deliberately the only way the first admin can exist. There is no in-app path,
so there is no privilege-escalation route for an attacker to find. The change is
written to the audit log like any other.

---

## §6 What I need from you next

**One action: complete §3 above** — the three steps that connect your Supabase
project. Nothing else.

Once your database reports green, Phase 2 begins: the shared taxonomy (industries,
territories, customer types, sales models, compensation types) and the rep and
business profiles built on top of it.

**One decision needed within about three weeks, not today:** which industry and metro
area is the beachhead. Phase 2's taxonomy should be seeded deep in that vertical
rather than shallow across all of them. See [`07-cold-start.md`](07-cold-start.md).

---

## §7 Deliberate omissions

Things a demo would have faked, listed so their absence is a decision rather than an
oversight:

- **No mock dashboards.** There is a status page that reports what genuinely works.
- **No rep or business profile screens.** Those need the taxonomy first, or they
  collect free text that makes matching impossible later.
- **No Vercel, Stripe, domain, or email.** You asked to hold these, and none is on
  the critical path yet.
- **No Content-Security-Policy header yet.** Added in Phase 8, once the set of scripts
  the app loads has stabilised. A CSP written this early is either wrong or so
  permissive it is decorative.
- **No file upload UI.** The `files` table and its access rules exist; the upload
  pipeline is built in Phase 2 alongside avatars and logos, where it has a real use.
