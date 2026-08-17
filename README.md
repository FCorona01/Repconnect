# RepConnect

A two-sided marketplace connecting businesses with independent sales representatives,
fractional sales professionals, contract salespeople, and commission-based sales talent.

## Current status

**Phase 2, Checkpoint 4 complete: taxonomy, rep profiles, file pipeline, company profiles.**

Built and verified against a real PostgreSQL 16 database:

- Next.js 16 · TypeScript · Tailwind 4 · Drizzle · Supabase Auth
- **21 tables, 11 migrations**, Row Level Security forced and deny-by-default on all
- Organisations, members, platform and organisation roles
- Shared taxonomy: 142 industries, 68 product categories, 211 territories
  (US + Canada), 23 flat vocabulary entries — hierarchical, bidirectional matching
- Rep profiles with a three-level visibility control and a public `/r/<slug>` page
- Company profiles with a public `/c/<slug>` page and team management
- Secure upload pipeline: magic-byte validation, EXIF stripping, private buckets
- **169 unit/integration tests + 36 E2E**, all passing
- CI: typecheck → lint → test → security verify → seed drift → build → E2E

Migrations reach Supabase through a workflow that reads credentials from GitHub
encrypted secrets — nothing sensitive is ever pasted into a chat or a commit.
See [`docs/08-phase-0-setup.md`](docs/08-phase-0-setup.md) §3.

## Quick start

```bash
pnpm install
pnpm db:up && pnpm db:migrate     # local PostgreSQL
pnpm verify                       # typecheck + lint + tests
pnpm dev                          # http://localhost:3000
```

## Read these in order

| Document | What it answers |
| --- | --- |
| [`docs/00-executive-summary.md`](docs/00-executive-summary.md) | The plan in plain English. Start here. |
| [`docs/01-architecture.md`](docs/01-architecture.md) | What we build it with and how the pieces fit. |
| [`docs/02-data-model.md`](docs/02-data-model.md) | Every table, every relationship, and why. |
| [`docs/03-security.md`](docs/03-security.md) | How each attack you named is actually prevented. |
| [`docs/04-services.md`](docs/04-services.md) | Every external account, and exactly what you must do. |
| [`docs/05-monetization.md`](docs/05-monetization.md) | How RepConnect makes money and what that means to build. |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | Build order, phase by phase, with exit criteria. |
| [`docs/07-cold-start.md`](docs/07-cold-start.md) | How we get the first users when neither side exists yet. |
| [`docs/08-phase-0-setup.md`](docs/08-phase-0-setup.md) | **What is built, and how to connect Supabase.** |

## Repository layout

```
src/lib/db/schema/     Drizzle schema — the typed query surface
src/lib/db/rls.ts      withActor(): drops privileges so RLS applies to our own queries
src/lib/auth/actor.ts  Actor type — every repository call requires one
src/lib/repositories/  All database access. Nothing else queries the database.
supabase/migrations/   Source of truth for DDL, RLS policies, roles and grants
tests/authorization.test.ts  The authorization matrix
scripts/verify-security.ts   Security invariants, runnable against any environment
```

## Repository

`github.com/FCorona01/RepConnect` (rename from `Reconnect` pending).
