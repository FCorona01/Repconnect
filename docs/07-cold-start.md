# 07 — Cold Start Strategy

Added after the founder confirmed: **no existing relationships on either side yet.**

This is the honest, difficult starting position — and it is worth planning for now,
because it changes what we build in Phases 2–4, not just how we market later.

---

## The problem, stated plainly

A marketplace is worthless to both sides until it has both sides.

- A sales rep who signs up and sees 3 opportunities leaves and never returns.
- A business that posts an opportunity and receives 0 applications concludes the
  platform is dead and never posts again.

Worse, **you only get one first impression per user.** A rep who visits an empty
RepConnect in month one is unlikely to come back in month six when it is full. Early
users are not a renewable resource, and spending them on an empty product is the
most common way this fails.

This is not a marketing problem to solve after launch. It has direct consequences
for the product architecture, described below.

---

## The strategy: go absurdly narrow

The instinct is to launch broadly — every industry, every territory — because a
bigger market sounds better. **This is backwards.** Spread across 20 industries and
50 territories, 100 reps and 40 opportunities produce almost no overlapping matches.
Concentrated into one industry in one metro, the same numbers produce a functioning
market.

**Pick one industry × one territory and win it completely before expanding.**

Criteria for choosing the beachhead:

| Criterion | Why |
| --- | --- |
| High commission-only / fractional norms already | You are not also fighting to change how the industry hires |
| Fragmented buyer side — many small businesses | Big companies have internal recruiters and long procurement |
| Reps who identify with the vertical | "MedTech rep" is an identity; "salesperson" is not — identity drives word of mouth |
| You can personally reach 30 businesses | The first 30 will not come from ads |
| Deal cycles short enough to see outcomes | You need proof of placement within months, not years |

Candidate verticals worth evaluating: medical devices, SaaS for SMBs, building
products, industrial equipment, insurance/benefits, food service distribution. Each
has an established independent-rep culture.

**Decide this before Phase 2**, because the taxonomy seed data and the first SEO
pages should be deep in that vertical rather than shallow across all of them.

---

## Sequencing: seed supply, then sell demand

For a sales marketplace specifically, **reps are easier to aggregate first**, for
three reasons:

1. They are individually findable — LinkedIn, industry associations, trade groups.
2. Signing up is free and low-risk for them.
3. A rep profile is useful to a rep **even with zero businesses on the platform**
   (see "single-player mode" below).

But reps churn fast if there is nothing to browse. So the actual sequence is:

**Step 1 — Manually source 20–40 opportunities before public launch.**
Approach businesses in the beachhead vertical directly. Offer free posting,
personally write the listing for them, and be explicit that you are building the
market. Some will say yes purely because it costs them nothing. These listings exist
so the first reps see a populated marketplace.

**Step 2 — Recruit 100–200 reps into that same vertical and territory.**
Direct outreach. Not ads. A hundred hand-recruited reps in one vertical is worth
more than ten thousand scattered signups.

**Step 3 — Do the matching by hand.**
For the first several months, personally read every profile and every opportunity
and make introductions yourself. This is not a failure of the software. It is how
you learn what actually predicts a good match — which is the input the matching
engine in Phase 7 needs, and which cannot be guessed in advance.

**Step 4 — Automate what you have been doing manually.**
By this point the matching weights are informed by real outcomes rather than
intuition.

---

## What this changes in the product

Three architectural consequences. These get built into Phases 2–4 rather than added
later.

### 1. Single-player mode — the product must be useful with zero counterparties

This is the most important adaptation, and it is what makes a cold start survivable.

**For reps, even with no businesses on the platform:**
- A polished, shareable public profile page they can send to any prospective client
  — a portable professional credential that stands alone
- A clean URL (`repconnect.com/r/their-name`) worth putting on LinkedIn
- Verified badges and review history that accumulate as a career asset

**For businesses, even with no reps browsing:**
- A shareable opportunity page they can post to their own network and LinkedIn
- Applications from *their* traffic flow into RepConnect's pipeline tools, so they
  get an applicant tracker for free

Both sides get value on day one, and both are *incentivised to bring their own
traffic* — which seeds the marketplace from the outside. This means the public
profile and public opportunity pages need real design investment in Phases 2 and 3.
They are not just SEO surfaces; they are the acquisition mechanism.

### 2. Never show an empty marketplace

Empty states in Phases 2–4 must be built assuming they will be seen constantly at
the start. Concretely:

- No search result ever returns a bare "0 results". It returns the nearest adjacent
  matches, plus an email alert signup for the exact criteria.
- Rep dashboards with no matches show the beachhead vertical's newest listings, not
  a blank panel.
- "Be notified when opportunities match" is a first-class feature from Phase 3, not
  an afterthought. Captured intent is the asset that lets you re-engage a user once
  supply arrives — it is the fix for the one-first-impression problem.

### 3. Admin tooling matters earlier than planned

Since you will be manually creating listings, manually matching, and manually
onboarding, the admin console needs to support **acting on behalf of users** sooner
than Phase 6. I will pull a minimal version forward into Phase 4:

- Create an organisation and an opportunity as an admin
- Manually invite a rep to an opportunity
- Mark a listing as founder-sourced, so the metrics stay honest

That last point matters. **Keep a hard distinction in the data between organic
activity and founder-generated activity.** Otherwise, six months in, you cannot tell
whether the marketplace works or whether you are the marketplace. That is the single
most important number you have, and it is very easy to lose by accident.

---

## Metrics that actually tell you it is working

Ignore signups. Signups are a vanity number during a cold start.

| Metric | Target before expanding beyond the beachhead |
| --- | --- |
| % of opportunities receiving ≥1 application within 7 days | > 70% |
| % of opportunities receiving ≥3 quality applications | > 40% |
| Businesses posting a **second** opportunity | > 30% |
| Reps returning within 30 days | > 25% |
| Applications resulting in a confirmed engagement | > 5% |
| **Organic (non-founder-sourced) listings** | Rising month over month |

**The one that matters most is repeat posting.** A business that posts a second
opportunity has been given real value. Nothing else is proof.

Only expand to a second vertical when the first one clears these thresholds. A
second market started too early does not double growth — it halves focus and neither
market reaches liquidity.

---

## What this does not change

The architecture in [`01-architecture.md`](01-architecture.md) and the phase order in
[`06-roadmap.md`](06-roadmap.md) stand. A cold start is a distribution problem, not a
technology problem, and building something less solid would not help — it would just
mean the product fails the first cohort you cannot get back.

The adjustments are additive:

| Phase | Addition |
| --- | --- |
| 2 | Public rep profile page treated as a shareable product surface, not just a page |
| 3 | Public opportunity page shareable; saved-search email alerts as a core feature |
| 3 | Taxonomy seeded deep in the beachhead vertical, shallow elsewhere |
| 4 | Minimal admin "act on behalf" tooling pulled forward from Phase 6 |
| 4 | `source` flag distinguishing founder-sourced from organic, everywhere |
| All | Empty states designed for a marketplace that is genuinely empty |

---

## The decision needed before Phase 2

**Which industry and which metro area is the beachhead?**

Not needed today — Phases 0 and 1 are infrastructure and identity, and are
vertical-agnostic. But it is needed within about three weeks, and it is worth
thinking about now, because it is the decision this entire strategy rests on.
