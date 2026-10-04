# STATUS — Media Moguls (North 7) Logo Design Contest

**As of:** 2026-09-13
**Verified:** `npx tsc -b` clean across all three packages · `npx vitest run` → **358 passed / 358, 11 files**

---

## The headline

The **entire backend is built and tested**. The **design system is built**. The
**six member-facing screens are not built** — that is the gap, and it is a real
one: today there is no UI a participant can use to upload a logo or cast a
ballot. The API behind those screens is complete and exercised by tests.

---

## Complete

### Backend — all of it
- **Core seam** — env/domain parsing, emulator-aware firebase-admin, Date↔Timestamp
  converters, single error path, auth middleware, `requireAdmin`, audit writer,
  Fastify assembly.
- **IRV engine** (45 + 15 tests) — rounds, transfers, exhaustion, majority-of-active
  detection, and the full five-step tie-break chain terminating in a seeded shuffle
  that always resolves. Pure and dependency-free. Tests cover all-way ties, total
  exhaustion, single candidate, two tied at the end, partial ballots, self-votes,
  unknown/withdrawn candidates mid-ranking, a conservation invariant across
  generated fixtures, and byte-identical reproduction across runs and across
  shuffled input order.
- **Auth routes** — magic-link gate (domain checked *before* any mail is generated;
  per-email and per-IP rate limits), `/me`, profile update, admin roster,
  promote/demote with in-transaction last-admin protection, custom-claim mirroring
  and refresh-token revocation on demotion. First-admin bootstrap via
  `BOOTSTRAP_ADMIN_EMAIL`.
- **Submissions + image pipeline** — one active entry per person enforced in a
  transaction; magic-byte type sniffing (a renamed SVG is rejected); EXIF/XMP/IPTC
  stripped and asserted absent; thumb 640 / display 1600 WebP with alpha preserved;
  SHA-256 content hash; UUID paths in a private bucket; titles rejected when they
  contain the uploader's name or email local-part.
- **Ballots** — get/save/clear your own, by deterministic document key. **No list
  endpoint exists.** Self-voting allowed at any rank, deliberately.
- **Contest + admin** — date validation, phase override, audited moderation view,
  disqualify/reinstate, turnout, audit log.
- **Results** — compute and persist snapshots, live IRV projection for the
  dashboard, publish gate on `minBallotsToPublish`, tie override, anonymised CSV
  export.
- **Local dev** — emulator wiring and a seed script with `--phase`, `--preset` and a
  `tie` preset that constructs a tie arithmetically and **throws if it fails to
  materialise**.
- **Infrastructure** — Terraform for Firestore, a private bucket (public access
  prevention enforced), Artifact Registry, scale-to-zero Cloud Run on a dedicated
  least-privilege service account, IAM, Hosting; bootstrap/deploy scripts; a
  multi-stage non-root Dockerfile.

### Design system
Near-monochrome palette on warm off-white `#FAFAF8` with deep ink `#141414`, a
warm-tinted graphite scale, **both bronze and teal accent ramps** swappable live
via a `[data-accent]` attribute. 17 accessible primitives over Radix, self-hosted
type strategy with system fallbacks (no network font fetch), 8px grid, hairline
rules. Accessibility is built in: visible focus rings, real labels, keyboard paths,
`prefers-reduced-motion` respected, 44px icon targets. Browsable at **`/style`**,
with the accent toggle at the top of the page.

---

## Not built

| Item | What's missing |
|---|---|
| **C11** app shell, sign-in, finish-sign-in | The magic-link UI. Auth context and API client are done and ready. |
| **C12** gallery + upload | |
| **C13** ballot builder | The ranked-choice UI. **Must be fully keyboard-operable, not drag-only** — `@dnd-kit` is installed. |
| **C14** dashboard + live standings | |
| **C15** results + elimination flow | |
| **C16** admin console | Timeline, moderation, tie override. |
| **D17** anonymity integration suite | The adversarial suite. Its bar: deliberately introducing a leak must make it fail. |

`App.tsx` deliberately routes **only what exists** rather than importing absent
modules or shipping fake "coming soon" stubs. It carries a comment block listing
each pending page, the file it owns, and the plumbing already available to it.
`RequireAuth` and `RequireAdmin` are written and exported, ready to wrap the routes
as they land.

### Two design-system files were lost
`StyleGuidePage.tsx` was rebuilt by me — smaller than the original but complete and
real. `ui.test.tsx` (~48 KB of component tests, including WCAG contrast assertions
for both accents) **was written but never recovered**; the worker that produced it
was cancelled before publishing. The design system therefore currently ships with
**no component tests**. Everything else from that work was recovered intact.

---

## Decisions you should review

1. **Pick the accent.** Both are built. Open `/style` and toggle. My recommendation
   is **bronze** — it shares the paper's warmth and reads as the page raising its
   voice rather than a brand colour dropped on top. Teal is the safer pick if the
   dashboard needs to be scanned fast, since it carries more contrast against the
   off-white.

2. **⚠️ Magic-link deliverability to `@google.com` inboxes is untested and may not
   work.** Firebase Auth sends sign-in links from its own infrastructure, and corp
   mail filtering may quarantine or drop them. **This is the single biggest
   unvalidated risk in the project** — if the links do not arrive, nobody can sign
   in and the app is unusable. Test it with one real account before inviting the
   team. The likely fallback is a **6-digit code** flow (same Firebase identity, a
   code the user types instead of a link they click); that is a meaningful chunk of
   work and is not built.

3. **The archival original is stored but never served.** Uploads keep the original
   bytes for provenance at `…/original.<ext>`. Only the EXIF-stripped renditions are
   reachable through the API — but "no route serves it" is a routing guarantee, not
   a storage one. Anyone with bucket read access can see unstripped originals. If
   that is not acceptable, stop storing originals; the renditions are what the
   contest actually needs.

4. **Emulators were never actually started.** No network in this environment, so the
   emulator JARs could never download. The wiring is written to spec but has not
   been run end-to-end. Expect to shake out small issues on first `make dev`.

5. **Terraform was never machine-validated.** No `terraform` binary and no network,
   so `terraform validate` never ran. The files were hand-reviewed for dangling
   references only.

6. **Firebase Hosting is managed via the CLI, not Terraform** — see `infra/README.md`.
   A deliberate call: the provider's Hosting support is awkward enough that a
   half-Terraformed resource would be worse than a documented CLI step.

7. **The DRS org-policy exception is manual**, per `03-DEPLOY-RUNBOOK.md`.
   `bootstrap.sh` prompts and verifies rather than attempting to change org policy.

8. **`packages/shared` must be built before anything else typechecks.** Both apps now
   resolve `@contest/shared` through `dist` via project references. `npx tsc -b`
   handles the ordering; a bare `vite dev` on a clean checkout will not. Noted in
   RUNBOOK.md.

---

## Anonymity posture — what actually holds today

Enforced and tested at the unit level:
- `toPublicDto` has no code path that emits `ownerUid`.
- No endpoint returns another person's ballot; ballots are read by deterministic
  key, never by query.
- Turnout projects away the `ranking` field at the Firestore query level.
- The moderation view is the only identity disclosure, and it writes an audit entry
  before returning.
- Images are stripped of EXIF/XMP/IPTC, asserted in tests.
- CSV export contains aliases and sequential ballot ids only, and refuses below the
  anonymity floor.

**Not yet verified end-to-end.** D17 was to be the adversarial suite that proves
these hold against a running server — asserting no member-facing response contains
`ownerUid`, that Firestore/Storage rules deny direct client access, that non-admin
tokens are refused on every `/admin/**` route, and that off-domain tokens are
rejected. Until it exists, the guarantees above rest on unit tests and code review,
not on a suite that fails when someone introduces a leak.
