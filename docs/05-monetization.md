# 05 — Monetization and Payments Architecture

Covers item 17.

---

## The strategic question first

A marketplace can charge in five ways. Only one is right for RepConnect at the
start, and one of them could genuinely sink the company.

| Model | How it works | Verdict |
| --- | --- | --- |
| **Business subscription** | Businesses pay monthly to post and to search reps | ✅ **Recommended** |
| Featured listings | Pay to boost a listing's placement | ✅ Later, additive |
| Rep premium | Reps pay for visibility and more applications | ⚠️ Careful — see below |
| Per-post fee | Pay per opportunity posted | ⚠️ Weak — punishes the behaviour we want |
| **Commission take rate** | RepConnect takes a % of commissions earned | ❌ **Avoid for a long time** |

---

## Why not a commission take rate

It is the intuitively obvious model — align revenue with value delivered — and it is
the one that would cause the most damage right now. Four reasons:

**1. It makes you a money business.** The moment commissions flow *through*
RepConnect, you are potentially a money transmitter. That means state-by-state
licensing questions in the US, identity verification (KYC) on every rep, tax
reporting (1099s) on every payout, and dispute handling for money you are holding.
That is a bigger project than the entire product described in these documents.

**2. It is nearly impossible to enforce.** You would need visibility into what deals
closed and what commission was actually paid — inside the business's CRM, which you
do not have. You are relying on self-reporting from the party who saves money by
under-reporting.

**3. It creates maximum incentive to leave.** A 10% take on ongoing commission is a
permanent tax both parties can escape by exchanging phone numbers once. You would be
funding the introduction and then losing every subsequent dollar — the worst
possible position.

**4. It delays revenue enormously.** Sales cycles are long. A rep placed in January
might not close until June. You would be pre-revenue far longer than the model
suggests.

**Subscriptions charged to businesses avoid every one of these.** Money never flows
between users. No custody, no KYC on reps, no 1099s, no money transmission. Revenue
is predictable and recognised monthly. And Stripe Billing handles it with a fraction
of the engineering.

Revisit take-rate only if RepConnect ever moves into actually administering
commission payments as a product — which is a different, later company decision.

---

## The recommended sequence

### Phase 1 — Free (launch → first liquidity)

**Charge nothing. From anyone.**

A marketplace with no listings and no reps has nothing to sell. Charging before
liquidity is the most common way marketplaces die: you suppress the supply of the
thing that makes the product valuable in order to collect a small amount of money
from people who are not yet getting value.

**Goal of this phase is a number, not revenue:** the point at which a business
posting an opportunity reliably receives quality applications within a week. Until
that is true, there is no product to charge for. Track it as the primary metric
from day one.

### Phase 2 — Business subscriptions (once liquidity exists)

Businesses pay. Reps stay free, permanently.

**Reps are the scarce side.** Every marketplace has one side that is harder to
acquire, and you charge the other one. Good sales reps have options; businesses
struggling to hire them have budget and urgency.

Illustrative structure — final numbers need market validation, but the *shape* is
what matters:

| | Free | Growth | Scale |
| --- | --- | --- | --- |
| Active opportunities | 1 | 5 | Unlimited |
| Applications visible | 10 per opportunity | Unlimited | Unlimited |
| Search the rep directory | ❌ | ✅ | ✅ |
| Invite reps directly | ❌ | 20/month | Unlimited |
| Team seats | 1 | 5 | Unlimited |
| Verified badge | ❌ | ✅ | ✅ |
| Analytics | Basic | Full | Full + export |

The important design property: **the free tier must be genuinely useful.** A business
should be able to post one opportunity, receive applications, and hire someone
without paying. That is what keeps demand-side supply flowing into the marketplace.
They pay when they want *volume* — which is exactly when they are getting value.

The gate that converts best is almost always **rep search plus direct invitation**.
Posting and waiting is passive; searching and reaching out is what an urgent hiring
manager wants, and urgency is what people pay for.

### Phase 3 — Additive revenue (optional)

- **Featured listings** — one-off payment to boost placement. High margin, no
  ongoing obligation, and it works well precisely for the businesses whose roles are
  hardest to fill.
- **Verification badge** — paid, expedited business verification.
- **Rep premium** — ⚠️ possible, but be careful. Charging reps risks reducing supply,
  and it changes the incentive of your ranking algorithm in a way users can smell.
  If done, sell *tools* (application analytics, a portfolio page), never *ranking*.
  Selling ranking position to the scarce side corrodes trust in the match quality,
  which is the whole product.

---

## Payments architecture

Only built in Phase 9. Designed now so the schema does not need reworking.

### Components

| Stripe product | Use |
| --- | --- |
| **Stripe Checkout** | Hosted payment page. Card details never touch our servers — this removes essentially all PCI scope. |
| **Stripe Billing** | Subscriptions, proration, upgrades, downgrades, dunning. |
| **Customer Portal** | Hosted page where businesses update cards, change plan, cancel, download invoices. Removes a whole surface we would otherwise build and maintain. |
| **Webhooks** | The source of truth for subscription state. |
| **Stripe Tax** | Sales tax / VAT calculation. Worth enabling from the start — retroactive tax compliance is genuinely painful. |

### The one rule that matters most

**Webhooks are the source of truth. The browser redirect is not.**

The naive implementation activates a subscription when the user lands back on the
success page. This is wrong in three ways: users close the tab before redirect,
networks drop, and a redirect URL can be forged by anyone who reads it once.

Correct flow:

```
1. Business clicks Upgrade
2. Server creates a Checkout Session (server-side, price ID from our config,
   never from the client — otherwise the client picks its own price)
3. Redirect to Stripe
4. Payment happens on Stripe's infrastructure
5. Stripe → our webhook endpoint: checkout.session.completed
6. Webhook verifies the signature, then writes subscriptions + entitlements
7. The user's redirect back is cosmetic — a "thanks, setting up" screen that
   polls for the entitlement the webhook created
```

Webhook handling requirements:

- **Signature verification** on every event. An unverified webhook endpoint is an
  open door to granting yourself a free subscription.
- **Idempotency.** Stripe retries; events arrive more than once. Each event ID is
  recorded and reprocessing is a no-op.
- **Out-of-order tolerance.** Events do not arrive in causal order. Reconcile
  against the object's current state rather than applying deltas.
- **Always return 200 fast**, then process asynchronously via the job queue.
  A slow webhook gets retried and eventually disabled by Stripe.

### Data model

```
organizations ──1:1── subscriptions ──< entitlements
                            │
                            └── mirrors Stripe, never queried live
```

**Feature gates read `entitlements`, never Stripe's API.** Three reasons: an API
call on every page load is slow, it makes Stripe a hard dependency for the product
to render at all, and it prevents us from granting an entitlement manually — for a
pilot customer, a support gesture, an early-adopter deal — without faking a
subscription.

```ts
// Every gated feature, one shape:
const canInvite = await hasEntitlement(actor.orgId, 'rep_invitations');
if (!canInvite.allowed) return upgradePrompt(canInvite.reason);
```

### Handling failure gracefully

These are the cases that cause support tickets and churn if handled badly:

- **Payment fails** → Stripe's dunning retries over ~2 weeks. We email at each
  attempt. Access degrades to the free tier rather than being cut off — a business
  mid-hire whose card expired must not lose access to their applicants.
- **Downgrade below current usage** — a business on Scale with 12 open opportunities
  downgrades to Growth (limit 5). We do **not** delete seven opportunities. Existing
  ones stay live; new ones are blocked until they are under the limit. Destroying
  customer data over a billing change is how you earn a chargeback and a bad review.
- **Cancellation** → access continues to period end, then reverts to free. Data is
  never deleted on cancellation.
- **Refunds** → handled in the Stripe dashboard by you. No custom tooling needed.

### What we do not build

No custom card forms (PCI scope). No stored card data, ever. No custom invoicing
(Stripe Billing does it). No custom dunning emails (Stripe Billing does it). No
Stripe Connect, no payouts, no escrow, no marketplace payments.

---

## Disintermediation — the business-model risk

Both sides can meet on RepConnect and transact off it. Every marketplace faces this,
and the *business model choice above is itself the primary mitigation*: because we
charge businesses a subscription rather than taxing each transaction, leaving the
platform saves them nothing.

Supporting measures, in order of how much they help versus how much they annoy:

1. **Be genuinely useful after the introduction.** Engagement tracking, review
   history, easy re-hiring, a saved bench of reps you have worked with. Retention
   through value beats retention through friction, and it is the only one that
   scales.
2. **Reputation lives here.** A rep's review history is a portable career asset that
   only exists on RepConnect. That is real gravity.
3. **Light contact masking on the free tier**, lifted on paid. Reasonable, common,
   and it converts. It must be *visible and explained*, not silent — silent masking
   reads as broken software and generates support tickets.
4. Do **not** attempt aggressive off-platform-contact policing. It is unenforceable,
   it makes the product feel hostile, and it punishes exactly the engaged users you
   most want to keep.

---

## Recommended financial targets

Rough, for orientation:

- **Gross margin: 85%+.** Software marketplace economics. Infrastructure at 10,000
  users is a few hundred dollars a month.
- **Free → paid conversion: 3–8%** of active businesses is a normal band.
- **Break-even** at roughly 40–80 paying businesses at $99–199/month, against
  infrastructure plus one salary. That is a genuinely reachable target and a useful
  thing to hold in mind while building.
