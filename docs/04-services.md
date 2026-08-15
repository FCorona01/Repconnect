# 04 — External Services

Six accounts total. **Two are needed now.** Everything else waits until it is
genuinely required.

For each: why we need it, when, what I do, what you do.

---

## Summary

| # | Service | Needed | Cost at our scale | Your effort |
| --- | --- | --- | --- | --- |
| 0 | GitHub | ✅ Already exists | Free | Done |
| 1 | **Supabase** | **NOW** | Free → $25/mo | ~5 min |
| 2 | **Vercel** | Week 2 | Free → $20/mo | ~5 min |
| 3 | Domain registrar | Week 5 | ~$12/yr | ~10 min |
| 4 | Resend (email) | Week 5, with domain | Free → $20/mo | ~10 min |
| 5 | Sentry (errors) | Before beta users | Free | ~3 min |
| 6 | PostHog (analytics) | Before beta users | Free | ~3 min |
| 7 | Stripe (payments) | Only when charging | 2.9% + 30¢ | ~30 min + verification |

**Total to launch a working beta: about $12** (the domain). Everything else has a
free tier that comfortably covers pre-revenue usage.

### Services I considered and rejected, so you do not create these accounts

| Rejected | Why |
| --- | --- |
| Algolia / Elasticsearch | PostgreSQL search handles our first 50,000+ listings. Revisit only at a measured threshold. |
| Auth0 / Clerk | Supabase Auth is included in an account we already need. A second auth bill and a second identity system for no gain. |
| AWS S3 / Cloudinary | Supabase Storage is included and S3-compatible. |
| Redis / Upstash | Rate limiting is covered by Supabase Auth limits and Vercel firewall rules. Add later only if measured. |
| Inngest / Trigger.dev | The PostgreSQL job queue plus Vercel Cron covers our volume with no vendor. |
| Twilio / SMS | Nothing in v1 needs SMS. |
| Stream / Sendbird (chat) | Messaging must be moderatable and application-gated. A vendor fights both. |
| Contentful / a CMS | Marketing pages are in the repo. A CMS is a bill and a sync problem. |
| Google Analytics | PostHog does more and is friendlier under GDPR. |
| Datadog / New Relic | Enormously over-specified for one app. Sentry plus Supabase's dashboard is right. |

---

## 0 — GitHub ✅ Already done

`github.com/FCorona01/Reconnect` exists and I have access.

**One thing to decide:** the repository is named **Reconnect**, not **RepConnect**.
One character. It will appear in URLs, package names, deploy names, and Git history
permanently. Renaming takes thirty seconds today; in six months it breaks links,
CI config, and deploy hooks.

**Your action (optional, 30 seconds):** Repository → Settings → rename to
`RepConnect`. GitHub redirects the old URL automatically, so nothing breaks. Tell me
if you do it.

---

## 1 — Supabase 🔴 NEEDED NOW

### Why

This one account provides four things we would otherwise need four accounts for:

- **PostgreSQL database** — every piece of data in the product
- **Authentication** — signup, login, password reset, email verification, OAuth, MFA
- **File storage** — avatars, logos, resumes, verification documents
- **Realtime** — live message delivery

Managed backups, point-in-time recovery, and connection pooling included. The
alternative is running PostgreSQL yourself, which means you personally own backup
verification and security patching. Not a good trade for a non-technical founder.

### Cost

Free tier: 500MB database, 1GB storage, 50,000 monthly active users. That covers
development and early beta comfortably. Pro is $25/month when we outgrow it — and
we will only outgrow it once there are real users, which is a good problem.

### 👉 Your action — about 5 minutes

1. Go to **https://supabase.com** and click **Start your project**.
2. Sign up **with GitHub** (simplest, and links the accounts).
3. Click **New project**.
4. Fill in:
   - **Name:** `repconnect-production`
   - **Database password:** click Generate, then **save it in a password manager.**
     You cannot retrieve this later — only reset it, which causes downtime.
   - **Region:** ⚠️ **`East US (North Virginia)`** unless most of your users will be
     in Europe. This must match where we deploy the app. Getting it wrong adds
     80–150ms to every database query and is painful to change later. If your
     market is primarily European, choose `Central EU (Frankfurt)` and tell me.
   - **Plan:** Free.
5. Wait ~2 minutes for provisioning.
6. Go to **Project Settings → API** and copy these three values:
   - Project URL (`https://xxxxx.supabase.co`)
   - `anon` / publishable key
   - `service_role` / secret key ⚠️ **this one is a master key to your database**
7. Go to **Project Settings → Database** and copy the **Connection string**
   (Transaction pooler / port 6543 version).

**Send me all four values.** They go into environment variables, never into the
repository, and the `service_role` key never reaches a browser.

> On sharing keys: this is normal — they are configuration, and they can be rotated
> from the dashboard at any time. If you would rather set them yourself, I will give
> you a checklist instead; it is slower but entirely reasonable.

### What I do afterwards

Everything else: schema design, all migrations, Row Level Security policies on every
table, storage buckets and their access rules, auth provider configuration, email
templates, seed data, local development database, backup verification.

---

## 2 — Vercel 🟡 Week 2

### Why

Where the application runs. Built by the team that builds Next.js, so the fit is
exact. Concretely it gives us:

- Automatic deploy on every push
- **A preview URL for every proposed change** — you can click through and review the
  product before it becomes real. For a non-technical founder this is the single
  most useful thing in the whole pipeline.
- One-click rollback
- Global CDN, so pages are fast everywhere
- Cron jobs, which our background work uses

### Cost

Free (Hobby) is fine for development. Pro is $20/month, needed before real traffic
— it lifts function limits and adds the firewall rules we use for rate limiting.

### 👉 Your action — about 5 minutes, when I say

1. Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub**.
2. Authorize Vercel to access the `Reconnect` repository (you can grant access to
   that one repository only — recommended).
3. Tell me it is connected.

Do **not** click "Deploy" or configure anything. I will do the project setup,
environment variables, region pinning, build settings, and cron configuration.

---

## 3 — Domain 🟡 Week 5

### Why

`repconnect.com` rather than `repconnect.vercel.app`. Needed for credibility, and —
more practically — **required for email deliverability.** You cannot send
professional transactional email from a shared subdomain without landing in spam.

### 👉 Your action — about 10 minutes, when I say

1. Check availability at **Cloudflare Registrar** (https://dash.cloudflare.com) or
   **Namecheap**. Cloudflare sells at wholesale cost with no markup and no
   first-year-cheap-then-expensive trick — it is the honest option.
2. Buy it. Expect ~$12/year for a `.com`.
3. **Turn on auto-renew and WHOIS privacy.** A lapsed domain takes the product and
   all email offline instantly, and is sometimes bought by squatters within hours.
4. Give me registrar access **or** be ready to paste DNS records I send you.

Naming notes: `.com` if you can get it. `.io` and `.co` are acceptable. Avoid
hyphens and avoid anything requiring spelling over the phone — your sales-rep users
will be typing it after hearing it.

---

## 4 — Resend (email) 🟡 Week 5

### Why

The product is largely useless without reliable email. Password resets, email
verification, "you have a new applicant", "your application was viewed", invitations,
digests. If these land in spam, the marketplace does not function.

Resend chosen over SendGrid/Mailgun for developer ergonomics and clean deliverability
defaults; over Postmark on price at our stage.

### Cost

Free: 3,000 emails/month, 100/day. Enough for beta. $20/month for 50,000.

### 👉 Your action — about 10 minutes, when I say

1. **https://resend.com** → sign up with GitHub.
2. **Domains → Add Domain** → enter the domain from step 3.
3. Resend shows several DNS records (SPF, DKIM, DMARC). **Send them to me, or add
   them at your registrar** — I will give exact values.
4. Wait for verification (usually minutes, occasionally up to 48 hours).
5. **API Keys → Create** → send me the key.

⚠️ **Start this earlier than feels necessary.** DNS propagation is the one step
nobody can speed up, and email is on the critical path for beta.

### What I do

Design and build every email template, set up the sending subdomains
(`mail.` for transactional, `news.` for marketing — separated so a marketing
mistake cannot break password resets), wire delivery through the job queue with
retries, handle bounce and complaint webhooks, and build one-click unsubscribe.

---

## 5 — Sentry (error tracking) 🟢 Before beta users

### Why

Without it, "the site is broken" is all you ever learn. With it, you get the exact
line of code, the user affected, the browser, and the sequence of actions — usually
before the user reports it.

**Cost:** Free tier (5,000 errors/month) is plenty.

### 👉 Your action — 3 minutes

**https://sentry.io** → sign up with GitHub → create a project → choose **Next.js**
→ send me the DSN string.

---

## 6 — PostHog (product analytics) 🟢 Before beta users

### Why

Tells you *where the product loses people*. For a marketplace this is the difference
between guessing and knowing: how many reps start a profile versus finish it, how
many businesses post a second opportunity, which industries have demand and no
supply.

Replaces four separate tools — analytics, funnels, session replay, feature flags.

**Cost:** Free tier (1M events/month) covers early stage comfortably.

### 👉 Your action — 3 minutes

**https://posthog.com** → sign up → **choose US or EU hosting** (EU if you expect
European users; it simplifies GDPR) → send me the project API key.

---

## 7 — Stripe (payments) ⚪ Only when we charge

### Why

Subscription billing for businesses. See [`05-monetization.md`](05-monetization.md).

**Not needed until Phase 9.** Do not create this account yet — verification involves
real business documents and there is no reason to do it before there is revenue to
collect.

**Cost:** Free until you charge. Then 2.9% + 30¢ per transaction.

### 👉 Your action, when the time comes — about 30 minutes plus verification

1. **https://stripe.com** → sign up.
2. Complete business verification: legal entity name, tax ID/EIN, business address,
   bank account for payouts, and identity documents for the owner.
3. Send me the **test mode** keys first. We build and test entirely against test
   mode; no real money moves until you approve going live.

⚠️ Verification can take a few days. Start it a couple of weeks before you intend to
charge.

**Deliberately not doing: Stripe Connect.** Taking a percentage of commissions
between businesses and reps would mean money flowing *through* RepConnect — which
brings money-transmission questions, tax reporting obligations on payouts, and
identity verification on every rep. That is a compliance project larger than the
rest of the product. Reasoning in [`05-monetization.md`](05-monetization.md).

---

## Environment variables

For reference. **I manage all of this** — none of it goes in the repository.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # server only, never exposed
DATABASE_URL                     # pooled, for the app
DIRECT_DATABASE_URL              # unpooled, for migrations

# App
NEXT_PUBLIC_APP_URL
NODE_ENV

# Email          (Phase 5)
RESEND_API_KEY
EMAIL_FROM_TRANSACTIONAL
RESEND_WEBHOOK_SECRET

# Monitoring     (Phase 8)
NEXT_PUBLIC_SENTRY_DSN
SENTRY_AUTH_TOKEN
NEXT_PUBLIC_POSTHOG_KEY

# Payments       (Phase 9)
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

# Internal
CRON_SECRET
```

**Rules I follow without exception:** secrets never enter Git; a pre-commit scanner
and GitHub secret scanning both enforce it; anything prefixed `NEXT_PUBLIC_` is
visible in the browser and is treated as public by definition; separate values for
preview and production, so a test never touches real data.

---

## Right now

**Do only step 1 — create the Supabase account and project.**

Nothing else. When you send me those four values, Phase 0 begins.
