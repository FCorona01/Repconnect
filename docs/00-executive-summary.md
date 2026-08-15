# 00 — Executive Summary

Plain-English version. No prior technical knowledge assumed.

---

## 1. What I found when I looked at your environment

I inspected the repository and the machine before recommending anything. Findings:

| Thing | State |
| --- | --- |
| Repository `FCorona01/Reconnect` | **Completely empty.** Zero commits, zero files. |
| Existing code, database, designs | **None.** We are starting from absolute zero. |
| Existing accounts (Supabase, Vercel, Stripe, email) | **None connected.** No credentials exist in this environment. |
| Build tooling available to me | Node 22, pnpm, Docker, PostgreSQL 16 client, Python 3.11 |
| Internet access from my environment | Working (npm and GitHub reachable) |

**Translation:** nothing exists yet, which is good news. There is no legacy mess to
work around, and every decision below is still free to make.

One flag: **the repository is named "Reconnect", not "RepConnect".** That is a
one-character difference that will follow us into URLs, package names, and Git
history forever. It is trivially fixable now and annoying later. See the questions
at the bottom.

---

## 2. What RepConnect actually is, technically

Strip away the marketing and RepConnect is four things:

1. **A structured directory of sales reps** with rich, filterable attributes
   (industry, territory, customer type, sales model, compensation preference).
2. **A structured directory of sales opportunities** with the same attribute
   vocabulary, so the two sides can be matched on a shared language.
3. **A workflow engine** that moves a relationship through defined states:
   *discovered → applied/invited → in conversation → accepted → engaged → reviewed.*
4. **A trust layer** — verification, reviews, moderation, reporting — that makes
   strangers willing to transact.

The technically interesting part is **not** the CRUD screens. It is:

- **A shared taxonomy.** Both sides must describe the world using the same words,
  or matching is impossible. This is the single highest-leverage design decision
  in the entire product, and it is a database design problem, not a UI problem.
- **Territory modelling.** "California" must match "Los Angeles Metro". "Nationwide"
  must match everything. This needs a hierarchy, not a text field.
- **Authorization.** A marketplace is a system where users are actively motivated
  to see data they should not see. A business wants to see a competitor's applicants.
  This is the thing most likely to end the company if we get it wrong.
- **Disintermediation resistance.** Both sides are incentivised to meet on
  RepConnect and then transact off it. Every marketplace faces this. It shapes
  the messaging design and the business model.

---

## 3. The recommended stack, in one paragraph

**One application** written in TypeScript using **Next.js** (which handles both the
web pages users see and the server logic behind them), deployed on **Vercel**,
storing everything in **PostgreSQL hosted by Supabase** (which also provides login
and file storage). Search runs inside PostgreSQL itself. Email through **Resend**.
Payments through **Stripe**. Error tracking through **Sentry**. Product analytics
through **PostHog**.

That is **six external accounts total**, and only **two are needed to start**.

Why one application instead of separate frontend and backend: you are one
non-technical founder. Every additional moving part is a thing that can break at
3am and a thing you cannot debug alone. A single codebase with server and client
in one place is dramatically cheaper to operate and is used by companies far
larger than RepConnect will be for years.

Full reasoning, including what I rejected and why: [`01-architecture.md`](01-architecture.md).

---

## 4. The security model, in plain English

You listed seven attacks you want prevented. Here is the short version of how:

| Your concern | The defence |
| --- | --- |
| Seeing another user's information | Every database read goes through a function that requires "who is asking" as a mandatory argument. Code that forgets to pass it does not compile. |
| Seeing another business's applicants | Applicant queries are scoped by organisation membership at the database level, enforced twice — once in application code, once by the database itself. |
| Modifying someone else's opportunity | Ownership is verified on the server before any write. The browser is never trusted. |
| Normal users reaching admin functions | Admin role can only be granted by direct database access. There is no code path that lets a user grant it to themselves. |
| Changing an ID in the URL to see private records | Public IDs are random UUIDs (unguessable) *and* ownership is still checked. Both, not either. |
| Insecure file access | No file is ever public. Every download is a short-lived signed link issued only after an authorization check. |
| Authentication bypasses | Sessions live in cookies JavaScript cannot read, verified on the server on every request. |

The critical architectural choice: **the browser never talks to the database
directly.** Many Supabase tutorials let it. We will not. Full detail in
[`03-security.md`](03-security.md).

---

## 5. How it makes money

Recommended sequence:

1. **Phase 1 — free.** A marketplace with no supply and no demand cannot charge
   for anything. Charging early is the most common way marketplaces die.
2. **Phase 2 — businesses pay, reps stay free.** Subscription tiers gated on
   number of active opportunities and access to rep search. Reps are the scarce
   side; never tax the scarce side.
3. **Phase 3 — optional.** Featured listings, verified badges, placement fees.

**Deliberate recommendation: do not take a percentage of commissions, at least
not for a long time.** The moment money flows *through* RepConnect between two
parties, you are potentially a money transmitter, you owe tax reporting on
payouts, and you need identity verification on every rep. That is a compliance
project larger than the entire rest of the product. Stripe subscriptions charged
to businesses avoid all of it.

Full reasoning: [`05-monetization.md`](05-monetization.md).

---

## 6. What I need from you, and when

I have ordered these so you never create an account before it is genuinely needed.

| # | Action | When | Cost |
| --- | --- | --- | --- |
| 1 | Create a Supabase account and one project | **Now** | Free |
| 2 | Create a Vercel account, connect it to GitHub | When we first deploy (~week 2) | Free |
| 3 | Buy the domain | Before beta users (~week 5) | ~$12/yr |
| 4 | Create a Resend account, add DNS records I give you | With the domain | Free tier |
| 5 | Create a Sentry account | Before real users | Free tier |
| 6 | Create a PostHog account | Before real users | Free tier |
| 7 | Create a Stripe account, complete business verification | Only when we charge | Free until you charge |

**Everything else I configure myself** — database schema, migrations, security
rules, storage buckets, CI, tests, deployment config, email templates.

Exact click-by-click instructions for each: [`04-services.md`](04-services.md).

---

## 7. Build order

Nine phases. Each has a definition of done, and we do not move on until it is met.

| Phase | What gets built | Roughly |
| --- | --- | --- |
| 0 | Foundations: project, database, CI, deploy pipeline | Week 1 |
| 1 | Identity: signup, login, roles, sessions, admin bootstrap | Week 2 |
| 2 | Taxonomy + profiles: the shared vocabulary, rep and business profiles | Weeks 3–4 |
| 3 | Opportunities: post, edit, browse, filter, search | Weeks 5–6 |
| 4 | The transaction: applications, saves, invitations, status workflow | Weeks 7–8 |
| 5 | Messaging: context-scoped conversations, realtime | Week 9 |
| 6 | Trust: verification, reviews, reports, moderation, admin console | Weeks 10–12 |
| 7 | Intelligence: matching engine, recommendations, notifications, email | Weeks 13–14 |
| 8 | Launch readiness: monitoring, SEO, performance, accessibility, load test | Week 15 |
| 9 | Monetization: Stripe, subscriptions, entitlements | When justified |

Timeline assumes focused, continuous work. Detail and exit criteria for each:
[`06-roadmap.md`](06-roadmap.md).

---

## 8. Decisions made

| Question | Answer | Consequence |
| --- | --- | --- |
| Repository name | Rename `Reconnect` → `RepConnect` | You do this in GitHub Settings; the old URL auto-redirects |
| Domain | Not owned yet | I flag it at week 3; Cloudflare Registrar, ~$12/yr |
| Existing relationships on either side | **None yet** | Triggered a dedicated cold-start strategy — see below |

**The cold start is now the biggest risk to this project, and it is not a technical
one.** Starting with neither supply nor demand means the product must be useful to
each side *even when the other side is empty*, or the first cohort of users leaves
and does not come back. That has direct architectural consequences, which are now
written into Phases 2–4.

The three that matter most:

1. **Single-player mode.** A rep's public profile must be a shareable professional
   credential worth having even with zero businesses on the platform. A business's
   opportunity page must be shareable to their own network. Both sides then bring
   their own traffic, which seeds the marketplace from outside.
2. **No screen ever shows an empty marketplace.** Zero-result searches return
   adjacent matches plus an email alert signup. Captured intent is what lets you
   re-engage users once supply arrives.
3. **Go absurdly narrow.** One industry, one metro area. A hundred hand-recruited
   reps in a single vertical produce a working market; ten thousand scattered
   signups do not.

Full strategy, sequencing, and the metrics that prove it is working:
[`07-cold-start.md`](07-cold-start.md).

**One decision still open, needed within ~3 weeks (not today):** which industry and
which metro area is the beachhead? Phases 0 and 1 are vertical-agnostic
infrastructure, so this does not block starting.

---

## 9. The one action to take right now

**Create a Supabase account and one project.** That is it. Nothing else.

Step-by-step instructions are in [`04-services.md`](04-services.md) under
"Service 1". It takes about five minutes and costs nothing.

Once you paste me the project URL and keys, I begin Phase 0 immediately.
