# MANIFEST — Media Moguls (North 7) Logo Design Contest

Every file in the repo, grouped. Pre-existing scaffold and contracts are marked
`[foundation]`; everything else was produced in this build.

---

## Shared contracts — `packages/shared/src/` `[foundation]`

| File | Purpose |
|---|---|
| `index.ts` | Barrel; both apps import `@contest/shared` only |
| `constants.ts` | MAX_RANKS, upload/image limits, rate limits, `COLLECTIONS`, `ballotDocId()`, `formatAlias()` |
| `phases.ts` | `ContestPhase`, `derivePhase()` — single source of truth for both sides |
| `entities.ts` | Firestore shapes; `Submission.ownerUid` and all of `Ballot` are server-only |
| `results.ts` | IRV `Round`/`Transfer`/`TieBreak`/`ResultSnapshot`, `CountableBallot`, `CountOptions` |
| `errors.ts` | `ERROR_CODES`, `ApiError`, HTTP status + default message maps |
| `api.ts` | **The anonymity boundary** — every member-facing DTO |

---

## API core seam — `apps/api/src/`

| File | Purpose |
|---|---|
| `config.ts` | Env parsing; `parseAllowedDomains`, `isEmailDomainAllowed` (full-domain match), dev-only fake clock |
| `firebase.ts` | firebase-admin init, emulator-aware; `getDb`/`getAdminAuth`/`getBucket` |
| `db/converters.ts` | Date↔Timestamp converters, zod-validated on read |
| `db/collections.ts` | Typed collection handles — the only way to touch Firestore |
| `plugins/error-handler.ts` | Sole error path; everything becomes a well-formed `ApiErrorBody` |
| `plugins/auth.ts` | Token verify → `email_verified` → domain gate → user load; `requireAuth`/`requireAdmin`; first-admin bootstrap |
| `services/audit.ts` | Audit writer + DTO projection |
| `services/storage.ts` | Private bucket, UUID paths, short-lived signed URLs |
| `services/contest.ts` | Contest load, phase derivation, phase gates, `contestToDto` |
| `services/submission-dto.ts` | **Anonymity choke point** — `toPublicDto` cannot emit `ownerUid` |
| `app.ts` / `server.ts` / `routes/index.ts` | Fastify assembly, graceful shutdown, route registration under `/api` |

## API features — `apps/api/src/`

| File | Purpose |
|---|---|
| `irv/count.ts` | Instant-runoff engine — rounds, transfers, exhaustion, full tie-break chain |
| `irv/rng.ts` | Seeded deterministic PRNG + canonical shuffle |
| `irv/index.ts` | `countIrv`, `adminTieBreakKey`, `seededShuffle`, `makeRng` |
| `routes/auth.ts` | `POST /auth/magic-link` (domain gate + dual rate limit), `GET|PATCH /me`, `GET /admin/users`, `POST /admin/users/:uid/role` (last-admin protection, claim mirror, token revoke) |
| `routes/submissions.ts` | Gallery, upload/replace (one-per-person transaction), metadata edit, withdraw |
| `services/images.ts` | sharp pipeline — magic-byte sniffing, EXIF/XMP/IPTC strip, thumb 640 / display 1600 WebP |
| `services/aliases.ts` | Seeded-shuffle alias assignment at submissions close |
| `routes/ballots.ts` | `GET|PUT|DELETE /ballot` — own ballot only, by deterministic key. **No list endpoint exists** |
| `routes/contest.ts` | `GET /contest` |
| `routes/admin.ts` | Dates (`validateContestDates`), phase override, audited moderation view, disqualify/reinstate, turnout, audit log |
| `routes/results.ts` | `GET /dashboard`, `GET /results`, `POST /admin/results/{compute,publish,unpublish,resolve-tie}`, `GET /admin/export/ballots.csv` |
| `services/results.ts` | Count orchestration, snapshot persistence, live projection, publish gate |
| `services/csv.ts` | Anonymised ballot CSV serialiser |

## API tests

`irv/count.test.ts` (45) · `irv/rng.test.ts` (15) · `routes/auth.test.ts` (27) ·
`routes/ballots.test.ts` (19) · `routes/submissions.test.ts` (55) ·
`routes/admin.test.ts` (28) · `services/images.test.ts` (31) ·
`services/aliases.test.ts` (22) · `services/results.test.ts` (39) ·
`services/csv.test.ts` (26)

---

## Web core seam — `apps/web/src/`

| File | Purpose |
|---|---|
| `lib/api.ts` | Typed client; every response parsed against an `api.ts` DTO; `ApiClientError` carries the machine `ErrorCode` |
| `lib/firebase.ts` | Firebase Auth only (no client Firestore/Storage by design); magic-link send/complete |
| `lib/query-client.ts` | React Query defaults, query keys, live-poll interval |
| `lib/utils.ts` | `cn`, `clamp`, `formatPercent`, `plural` |
| `auth/AuthProvider.tsx` | Magic-link auth context; distinguishes loading / signed-out / signed-in / **rejected** (valid mailbox, inadmissible domain) |
| `main.tsx` | Provider composition |
| `App.tsx` | Route table — **currently routes only what exists**; see STATUS.md |
| `vite-env.d.ts` | Typed `import.meta.env` |

## Design system — `apps/web/`

| File | Purpose |
|---|---|
| `tailwind.config.ts` | Semantic colour mapping, 8px grid, type scale |
| `src/styles/tokens.css` | Graphite scale + **both** bronze and teal accent ramps behind `[data-accent]` |
| `src/styles/index.css` | Base layer, focus rings, skip link, `prefers-reduced-motion` neutraliser |
| `src/components/theme/ThemeProvider.tsx` | Accent state, persisted, flash-free at first paint |
| `src/components/theme/AccentSwitcher.tsx` | Radiogroup bronze↔teal toggle with roving tabindex |
| `src/components/layout/FullPageSpinner.tsx` | Route-level loading state |
| `src/components/ui/*.tsx` | 17 primitives: button, input, textarea, label, card, badge, dialog, dropdown-menu, switch, tabs, tooltip, skeleton, alert, empty-state, progress-bar, countdown, phase-pill |
| `src/components/ui/index.ts` | Barrel — the design system's public surface |
| `src/pages/StyleGuidePage.tsx` | Component gallery at `/style` with the accent decision at the top |
| `src/pages/NotFoundPage.tsx` | 404 |

---

## Local dev — `scripts/`

| File | Purpose |
|---|---|
| `seed.ts` | CLI: `--users --phase --preset --ballots --reset --seed`; creates Auth users, contest, real sharp-generated logos, ballots |
| `seed-data.ts` | Pure generators + `assertTieGuaranteed` |
| `seed-data.test.ts` | 51 tests incl. one per phase and the guaranteed-tie assertion |
| `dev-env.md` | Operator notes, incl. retrieving magic links from the Auth emulator |
| `verify-exif-strip.ts` | Byte-level check that stored renditions carry no metadata |
| `.env.local.example`, `apps/web/.env.development` | Emulator-wired env |

## Infrastructure — `infra/`, root

`versions.tf` · `variables.tf` · `main.tf` · `apis.tf` · `firestore.tf` ·
`storage.tf` (private, PAP enforced, lifecycle) · `artifact-registry.tf` ·
`cloud-run.tf` (scale-to-zero, dedicated SA, probes) · `iam.tf` (least
privilege, self `tokenCreator` for signed URLs) · `hosting.tf` · `outputs.tf` ·
`terraform.tfvars.example` · `README.md`

`scripts/bootstrap.sh` (prompts for the manual DRS org-policy exception) ·
`scripts/deploy.sh` (git-SHA image tags, `--dry-run`) ·
`apps/api/Dockerfile` (multi-stage, node:20-slim, non-root) · `.dockerignore`

Root `[foundation]`: `package.json`, `tsconfig*.json`, `.eslintrc.cjs`,
`.prettierrc`, `vitest.config.ts`, `Makefile`, `firebase.json`, `.firebaserc`,
`firestore.rules`, `storage.rules`, `firestore.indexes.json`, `.env.example`
