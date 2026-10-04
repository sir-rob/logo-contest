# Build Plan — Media Moguls (North 7) Logo Design Contest

**Companion to:** `01-SPEC.md` v0.2
**Date:** 2026-09-13

---

## Shape of the work

Nineteen units across four milestones. The first three items are the critical
path — once the shared contracts exist, the API and the frontend can be built in
parallel against the same typed interface, which is where most of the speed
comes from.

```
A. Foundation        1 → 2 → 3          (sequential, blocking everything)
                          │
        ┌─────────────────┴─────────────────┐
B. API  4 5 6 7 8 9  (parallel)     C. Web  10 → 11 12 13 14 15 16 (parallel after 10)
        └─────────────────┬─────────────────┘
D. Ship             17 → 18 → 19
```

---

## Milestone A — Foundation *(blocking)*

**1. Monorepo scaffold and toolchain**
npm workspaces: `packages/shared`, `apps/api`, `apps/web`, `infra/`. TypeScript
strict everywhere, ESLint + Prettier, Vitest. One `make dev` that brings the
whole thing up.
*Done when:* `npm run build` and `npm test` pass green on an empty skeleton.

**2. Shared contracts package**
Every zod schema, TS type, enum and constant that both sides use — phases,
submission, ballot, result rounds, API request/response shapes, error codes.
This is the seam that lets B and C proceed independently, so it gets written
carefully and first.
*Done when:* API and web both import from `@contest/shared` and typecheck.

**3. Local dev environment**
Firebase emulator suite (Auth, Firestore, Storage), a seed script that generates
N fake users, entries and ballots, and a fake-clock switch so any phase can be
exercised without editing dates.
*Done when:* `make dev` gives a working local app with 20 seeded entries, and
the seed can produce a ballot set with a guaranteed tie for testing.

---

## Milestone B — Logic and API *(parallel)*

**4. IRV counting engine**
Pure, dependency-free TypeScript. Rounds, transfers, exhausted ballots, majority
detection, and the full deterministic tie-break chain. Exhaustive unit tests
including the nasty cases: all-way ties, every ballot exhausting, a single
candidate, two candidates tied at the end, partial ballots, self-votes.
*Done when:* the test suite covers every branch and a fixed seed reproduces
identical output across runs. **This is the item where correctness matters most
— it decides the actual winner.**

**5. API: auth, domain gate, roles, audit log**
Firebase ID token verification on every request, `ALLOWED_DOMAIN` enforcement at
the boundary, admin custom claims, first-admin bootstrap, promote/demote with
last-admin protection, and the append-only audit log.

**6. API: submissions and image pipeline**
Upload/replace/withdraw with a one-per-person transaction, format and dimension
validation, **EXIF/XMP stripping**, thumbnail and display renders via sharp,
private-bucket writes under UUID paths, content hashing for duplicate detection,
alias assignment at submission close.

**7. API: ballots**
Get/save my ballot, validation (no duplicates, contiguous ranks, ≤5, entries
must exist and be active), phase gating, owner-only read. No list endpoint
exists — by design.

**8. API: contest config, phases and admin operations**
Create/update contest and dates, derived-vs-forced phase logic, disqualify,
turnout, the audited moderation view, config toggles.

**9. API: results, dashboard and export**
Compute and persist result snapshots, publish gate, the live IRV projection for
the public dashboard, phase-appropriate dashboard stats, anonymized CSV export.

---

## Milestone C — Design and frontend

**10. Design system** *(blocks 11–16)*
Tokens for the near-monochrome palette, type scale, 8px spacing grid, Tailwind
theme, and the base primitives — button, field, dialog, toast, empty state,
countdown. Both accent candidates (bronze, deep teal) rendered so you can pick
from something real rather than a description.
*Done when:* a component gallery page shows every primitive in both accents.

**11. Web: app shell, auth, routing** — magic-link sign-in (enter email → click
link in inbox), the cross-device "re-enter your email" completion path, the
rejected-domain screen, expired/reused link handling with one-click resend,
phase-aware navigation, persistent sessions, responsive frame.

**12. Web: gallery and upload** — the calm uniform grid, drag-and-drop upload
with preview and crop hint, replace/withdraw, "this is yours" marker, the
don't-put-your-name-in-it warning, locked state after the deadline.

**13. Web: ballot builder** — two-column drag-to-rank with `dnd-kit`, full
keyboard path, autosave with a clear saved indicator, edit-until-deadline, and
an honest empty state.

**14. Web: dashboard and live standings** — turnout, countdown, your own status,
and the public live IRV projection.

**15. Web: results and elimination flow** — the round-by-round transfer
visualization, winner presentation, exhausted-ballot honesty, reduced-motion
support. *The signature screen.*

**16. Web: admin console** — timeline and dates, phase control, toggles, admin
promotion, moderation view, tie-break resolution UI, compute/publish, export,
audit log.

---

## Milestone D — Ship

**17. Anonymity and integration test suite**
Not general testing — a specific adversarial suite that asserts the privacy
guarantees hold: no member-facing response contains `ownerUid` or another
person's ballot, Firestore and Storage rules reject all direct client access,
signed URLs expire, stored images carry no EXIF, and a non-admin token is
refused on every `/admin/**` route. Plus end-to-end flows for the happy paths.
*Done when:* a deliberately introduced leak makes the suite fail.

**18. Infrastructure as code**
Terraform for project services, Firestore, bucket and lifecycle rules, Cloud Run,
Artifact Registry, IAM, Hosting, plus a one-command bootstrap and deploy script.

**19. Deploy to Argolis** *(I'll drive this one with you)*
New project, the **Domain Restricted Sharing org-policy exception** cleared
first, Firebase Auth configured, first admin bootstrapped, smoke test, then a
real end-to-end rehearsal with a couple of test accounts before you invite the
team.

---

## Risks

| Risk | Mitigation |
|---|---|
| DRS org policy blocks the deploy | Cleared as step one of item 19, before anything is built in the cloud |
| An anonymity leak ships | Item 17 exists specifically to catch it; API-only architecture keeps the blast radius to one layer |
| IRV gets a subtle detail wrong | Pure isolated engine, exhaustive tests, persisted auditable snapshots, reproducible seed |
| Ties are common at 10–25 voters | Deterministic chain plus a real admin override UI, treated as a first-class path |
| Sandbox has no network | Local build works offline against emulators; network grants requested only at deploy |

---

## What I need from you along the way

- **Now:** approval of this plan.
- **At item 10:** pick the accent — bronze or deep teal.
- **Before item 19:** the sign-in domain, and whether you want a custom URL.
