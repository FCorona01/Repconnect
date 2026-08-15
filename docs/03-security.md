# 03 — Security, Authorization and Privacy

Covers items 15, 16, and 6 of the brief.

You named seven attacks. Each gets a section below with the concrete mechanism —
not a principle, a mechanism.

---

## The governing idea

A marketplace is a system in which **users are actively motivated to see data they
should not see.** A business genuinely wants to know who applied to a competitor's
opportunity. A rep genuinely wants to see what other reps are being offered. This
is not a hypothetical threat model; it is the ordinary commercial incentive of every
participant.

So security here is not a checklist applied at the end. It is the shape of the
codebase.

**Three walls, all independently sufficient, all always on:**

| Wall | Enforces | Fails how |
| --- | --- | --- |
| 1. Route gate (middleware + layout) | Coarse access — is this person allowed in this section at all | Redirect |
| 2. Repository layer | Fine-grained ownership, in the query itself | Returns nothing / throws |
| 3. PostgreSQL Row Level Security | The same rules, at the database | Returns zero rows |

For data to leak, the same mistake must be made in all three places
simultaneously. That is the property we are buying.

---

## Threat 1 — Unauthorized access to another user's information

**Mechanism: authorization is a compile-time requirement, not a runtime habit.**

Every database access goes through a repository function whose first parameter is
mandatory:

```ts
// There is no overload without an actor. This does not compile:
//   getRepProfile(profileId)
async function getRepProfile(actor: Actor, profileId: string): Promise<RepProfile | null>
```

Inside, the check is part of the query — not a preceding `if`:

```ts
// WRONG — two round trips, and a race between them
const profile = await db.select()...where(eq(repProfiles.id, id));
if (profile.userId !== actor.userId) throw new Forbidden();

// RIGHT — one round trip, no window
const [profile] = await db.select().from(repProfiles)
  .where(and(
    eq(repProfiles.id, id),
    visibilityPredicateFor(actor),   // the rule, in SQL
  ));
```

Checking-then-reading has a window between the two queries. Checking *in* the read
does not. It also means the unsafe version is not the shorter version, which is how
you get people to write the safe one.

**Field-level filtering, additionally.** Authorization is not only about rows. A
rep's `email` and `min_base_required` are not visible to a business browsing the
directory — only after the rep applies. So repositories return **role-specific
projections**, not raw rows:

- `RepProfilePublicView` — no email, no phone, no compensation floor
- `RepProfileApplicantView` — adds contact details, for a business the rep applied to
- `RepProfileOwnerView` — everything
- `RepProfileAdminView` — everything plus moderation metadata

Different TypeScript types, so a public page physically cannot render a private
field. The type system does the enforcement.

---

## Threat 2 — Unauthorized access to another business's applicants

The highest-value target in the system, and the one that would most damage trust.

**Mechanism: applicant queries are scoped through organisation membership, and
membership is derived from the session — never from a parameter.**

```ts
async function listApplicants(actor: Actor, opportunityId: string) {
  if (actor.kind !== 'member') throw new Forbidden();

  return db.select(applicantProjection)
    .from(applications)
    .innerJoin(opportunities, eq(applications.opportunityId, opportunities.id))
    // this join is the check — an opportunity belonging to another org
    // simply produces no rows
    .innerJoin(organizationMembers, and(
      eq(organizationMembers.organizationId, opportunities.organizationId),
      eq(organizationMembers.userId, actor.userId),
      isNotNull(organizationMembers.acceptedAt),
    ))
    .where(eq(applications.opportunityId, opportunityId));
}
```

`actor.orgId` comes from the verified session, not from the URL, not from a form
field, not from a header.

Backed by RLS, so even a direct database connection obeys it:

```sql
CREATE POLICY applications_org_read ON applications FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM opportunities o
    JOIN organization_members m ON m.organization_id = o.organization_id
    WHERE o.id = applications.opportunity_id
      AND m.user_id = current_app_user_id()
      AND m.accepted_at IS NOT NULL
  )
  OR rep_profile_id IN (
    SELECT id FROM rep_profiles WHERE user_id = current_app_user_id()
  )
);
```

And backed by tests — the authorization matrix in
[`01-architecture.md`](01-architecture.md) §16 asserts this specific case explicitly.

---

## Threat 3 — Unauthorized modification of opportunities

**Mechanism: writes are ownership-scoped `UPDATE`s, and the row count is the check.**

```ts
const result = await db.update(opportunities)
  .set(validated)
  .where(and(
    eq(opportunities.id, id),
    inArray(opportunities.organizationId, orgIdsWhereUserCanEdit(actor)),
  ))
  .returning({ id: opportunities.id });

if (result.length === 0) throw new NotFound();   // not Forbidden — see below
```

Two details that matter:

- **Zero rows updated is the failure signal.** There is no separate permission check
  to forget, and no race window.
- **We return "not found", not "forbidden".** Telling an attacker "that exists but
  you can't touch it" confirms the record's existence and leaks information. Same
  response for "does not exist" and "not yours".

Additionally: `org_role` must be `owner`, `admin`, or `recruiter` — a `viewer`
cannot edit. Status transitions go through a state machine (a `filled` opportunity
cannot silently return to `draft`). Every edit writes an audit row with before/after
values.

---

## Threat 4 — Normal users accessing admin functions

**Mechanism: there is no code path that grants admin, and admin queries live in a
separate module.**

1. `platform_role` is set **only** by a database migration or by an existing
   superadmin. There is no signup option, no invite flow, no self-serve upgrade, no
   "promote user" endpoint reachable by a member. The privilege escalation path does
   not exist to be exploited.
2. The `(admin)/` layout gate runs before any admin page renders, and additionally
   requires an MFA-satisfied session.
3. Admin repository functions live in `lib/repositories/admin/*` and accept only
   `{ kind: 'admin' }`. A user-facing page importing one is a type error.
4. A CI lint rule fails the build if anything under `app/(rep)` or `app/(business)`
   imports from the admin module. Structural, not procedural.
5. RLS admin policies check the role claim independently.
6. Every admin action is audited. Impersonation is visually unmistakable,
   time-limited, read-only by default, and audited at start and end.

---

## Threat 5 — Manipulating IDs to access private records (IDOR)

**Mechanism: two independent defences, because either alone is insufficient.**

**Unguessable identifiers.** UUIDv7 primary keys everywhere. Sequential integers
would let anyone walk `/opportunities/1`, `/opportunities/2` and enumerate the
entire platform — and would leak your business volume to competitors as a bonus.

**But obscurity is not authorization.** IDs leak — in shared links, in browser
history, in referrer headers, in support tickets. So every access is *still*
ownership-checked as in Threats 1–3. The random ID means an attacker cannot find
a target; the ownership check means it does not matter if they do.

Also:

- Server Actions never accept an actor identity as an argument. Any input named
  `userId`, `orgId`, or `repProfileId` that refers to *the caller* is a design bug,
  caught in review.
- Zod schemas use `.strict()` — unknown fields are rejected, closing mass-assignment
  (submitting `platform_role: "admin"` in a profile update form).
- Field allowlists on every update. We enumerate what may change; we never spread
  the request body into an update.

---

## Threat 6 — Insecure file access

Detailed in [`01-architecture.md`](01-architecture.md) §7. The core rules:

- **No public buckets.** Every download is a signed URL with a short expiry, issued
  by our server only after an authorization check on the `files` row.
- Signed URLs are minted per request, not stored, not cached, not embedded in
  server-rendered HTML that might be cached by a CDN.
- Verification documents are readable by admins only — never by the counterparty,
  and deleted after the decision. Retaining government ID indefinitely is pure
  liability.
- Upload validation: size cap, extension **and** magic-byte content-type check,
  server-generated filename (user-supplied names are a path-traversal vector),
  EXIF stripped from images.
- Served `Content-Disposition: attachment` so an uploaded HTML or SVG file cannot
  execute inside our origin.
- Storage paths are random UUIDs, so directory structure reveals nothing and cannot
  be walked.

---

## Threat 7 — Authentication bypasses

- Sessions in `httpOnly`, `Secure`, `SameSite=Lax` cookies. JavaScript cannot read
  the token, so an XSS bug does not become account takeover.
- **The session is verified against Supabase on every server request.** We never
  trust a decoded token payload alone. A token body is user-supplied data until
  something authoritative validates the signature and expiry.
- Email verification required before any write. Blocks throwaway-account abuse and
  protects your sending reputation.
- MFA available to all, mandatory for admins.
- Rate limiting on auth endpoints (Supabase Auth provides this; Vercel firewall
  rules add a second layer) — brute force and credential stuffing.
- Password reset tokens: single-use, short expiry, and reset **revokes all existing
  sessions**. Otherwise an attacker who already has a session keeps it after the
  victim "fixes" their account — a very common oversight.
- Email change requires confirmation at **both** the old and new address.
- Sign-out revokes server-side, not just clearing a cookie.
- Suspension is checked on every request, so a suspended user's existing session
  dies immediately rather than lasting until token expiry.

---

## Cross-cutting protections

| Concern | Measure |
| --- | --- |
| XSS | React escapes by default; `dangerouslySetInnerHTML` is lint-banned. Any rich text is sanitised server-side with an allowlist. Strict CSP with per-request nonces. |
| SQL injection | Drizzle parameterises everything. Raw SQL requires an explicit tagged template and is reviewed. |
| CSRF | Next.js Server Actions verify Origin; `SameSite=Lax` cookies; state-changing operations are never `GET`. |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'`. |
| Transport | HSTS with preload. TLS only, enforced at the edge. |
| Dependencies | Dependabot, `pnpm audit` in CI, lockfile committed, builds fail on high-severity advisories. |
| Secrets | Never in the repo. Pre-commit scanner plus GitHub secret scanning. Rotation documented. |
| Abuse / spam | Rate limits per user and per IP on applications, invitations, messages, and reports. Signup velocity limits. Reputation gates on bulk actions. |
| Enumeration | Login, signup, and password reset return identical responses and timing whether or not the email exists. |
| Logging | Structured logs with a correlation ID per request. Personal data, tokens, and file contents are never logged. |

---

## Privacy (item 16) — the operational specifics

Architectural stance is in [`01-architecture.md`](01-architecture.md) §21. What that
means concretely to build:

**Deletion is anonymisation, and this is the correct answer, not a compromise.**
When a user deletes their account:

- `users` row retained with identity severed: email replaced with a non-reversible
  hash, name → "Deleted user", all profile content purged, `deleted_at` set.
- `rep_profiles` and all attribute rows hard-deleted.
- Messages retained but attributed to the anonymous user — the counterparty's
  conversation history is *their* data and cannot be unilaterally destroyed.
- Reviews retained, anonymised — otherwise deleting an account becomes a way to
  erase negative feedback, and the reputation system is worthless.
- Files hard-deleted from storage.
- Audit logs retained (a legal-basis exception, and their entire purpose).

This is what "right to erasure" actually means in a system with counterparties. It
needs to be explained in the privacy policy in exactly these terms.

**Export** produces a complete JSON archive via a background job, delivered as a
signed, expiring link.

**Retention** is defined per data type up front, because retroactive retention
policy is not really a policy:

| Data | Retained |
| --- | --- |
| Verification documents | Until decision + 30 days, then deleted |
| Messages | Life of account |
| Audit logs | 7 years |
| Email events | 90 days |
| Deleted accounts | Anonymised immediately, purged after 30 days |

**Subprocessors** — Supabase, Vercel, Resend, Stripe, Sentry, PostHog. Listed in the
privacy policy from day one.

---

## Before real users touch this

A gate, not a wish list. Phase 8 does not complete until all of these pass:

- [ ] Authorization test matrix green, 100% of protected resources covered
- [ ] RLS enabled and deny-by-default verified on every table by an automated test
- [ ] A penetration pass against the OWASP Top 10
- [ ] Security headers verified (CSP, HSTS, frame-ancestors, referrer policy)
- [ ] No secrets in Git history — scanned, not assumed
- [ ] Rate limits verified on auth, applications, messaging, invitations
- [ ] File upload rejects renamed executables and oversized files
- [ ] Password reset revokes all sessions — tested
- [ ] Suspension terminates active sessions immediately — tested
- [ ] Backup restore rehearsed end-to-end, at least once, for real
- [ ] Incident response runbook written: who to contact, how to revoke, how to notify
