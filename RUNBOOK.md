# RUNBOOK — Media Moguls (North 7) Logo Design Contest

Local development, tests, and environment variables.

---

## Prerequisites

- **Node ≥ 20**
- Dependencies are already installed in `node_modules/` (1133 packages, sharp
  working against libvips 8.15.3).
- The Firebase emulators download their JARs on first run, so the **first**
  `make emulators` needs network access. Everything else works offline.

---

## Build order matters

Both apps resolve `@contest/shared` through `packages/shared/dist` via TypeScript
project references. **The shared package must be compiled before anything else
typechecks or runs.**

```bash
npx tsc -b          # builds shared → api → web, in dependency order
```

`tsc -b` is incremental; run it once after a clean checkout and after any change to
`packages/shared`. A bare `vite dev` on a fresh checkout will fail until it has run.

---

## Day-to-day

```bash
npx tsc -b                  # typecheck everything (must be clean)
npx vitest run              # full test suite — currently 358 tests, 11 files
npx vitest                  # watch mode
npx eslint . --ext .ts,.tsx # lint
npx prettier --write "**/*.{ts,tsx,json,md,css}"
```

The same targets exist in the `Makefile` (`make typecheck`, `make test`, `make lint`,
`make format`).

### Running the app locally

```bash
# 1. env — copy and edit
cp .env.local.example .env            # API
# apps/web/.env.development is already wired for the emulators

# 2. emulators (Auth 9099, Firestore 8080, Storage 9199, UI 4000)
make emulators

# 3. seed some data
npx tsx scripts/seed.ts --users=20 --phase=voting

# 4. API and web
npm run dev
```

The API listens on **8787** (not 8080 — the Firestore emulator has that port). Vite
serves on **5173**.

> **Not yet run end-to-end.** There was no network in the build environment, so the
> emulators were never actually started. The wiring is written to spec but expect to
> shake out small issues the first time.

### Signing in locally

The Auth emulator does not send mail. Retrieve the sign-in link from:

```
http://localhost:9099/emulator/v1/projects/demo-n7-logo-contest/oobCodes
```

Take the newest entry's `oobLink` and open it. `scripts/dev-env.md` has more detail.
The seed script prints the seeded addresses, including the bootstrap admin.

### Seeding

```bash
npx tsx scripts/seed.ts --users=20 --phase=voting --preset=normal
npx tsx scripts/seed.ts --preset=tie --users=12     # GUARANTEED tie, for the override UI
npx tsx scripts/seed.ts --preset=landslide          # first-round majority
npx tsx scripts/seed.ts --preset=exhausting         # many ballots exhaust early
npx tsx scripts/seed.ts --reset                     # wipe (emulator only — hard-guarded)
```

`--phase` is one of `setup | submissions | voting | closed | results` and sets real
dates so `derivePhase` lands on that phase against the real clock.

`--seed=<string>` makes a run reproducible; it defaults to a fixed constant, not the
clock.

`--reset` **refuses to run unless `FIRESTORE_EMULATOR_HOST` is set.** A seed script
that can be aimed at production is a loaded gun.

### The fake clock

To exercise a phase without moving dates, set both:

```bash
ALLOW_FAKE_CLOCK=true
FAKE_NOW=2026-10-01T12:00:00.000Z
```

Every phase decision in the API goes through `now()`, which honours this. It is
**ignored when `NODE_ENV=production`** — the escape hatch cannot exist in the deployed
app.

### Browsing the design system

Start the web app and open **`http://localhost:5173/style`**. It needs no sign-in.
The bronze ↔ teal toggle is at the top; everything below retints live. This is where
the accent decision gets made.

---

## Environment variables

### API

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` disables the fake clock and forbids emulator hosts |
| `PORT` | `8080` | Use `8787` locally; Cloud Run injects its own |
| `HOST` | `0.0.0.0` | |
| `LOG_LEVEL` | `info` | |
| `GCLOUD_PROJECT` / `FIREBASE_PROJECT_ID` | — | Required in production |
| `STORAGE_BUCKET` | `<project>.appspot.com` | Required in production. Private, never public |
| **`ALLOWED_DOMAINS`** | `google.com` | **Comma-separated.** Full-domain match — `notgoogle.com` and `google.com.evil.com` are rejected. Subdomains are NOT implied. Startup fails if empty |
| `BOOTSTRAP_ADMIN_EMAIL` | — | First admin, promoted on first sign-in. Only ever matched against an address that already passed the domain gate |
| `APP_URL` | `http://localhost:5173` | Where the magic link lands; must be an authorised Firebase Auth domain |
| `CORS_ORIGINS` | `APP_URL` | Comma-separated |
| `DEFAULT_CONTEST_ID` | `north7` | |
| `FIRESTORE_EMULATOR_HOST` | — | Presence switches firebase-admin to local mode |
| `FIREBASE_AUTH_EMULATOR_HOST` | — | |
| `FIREBASE_STORAGE_EMULATOR_HOST` | — | |
| `ALLOW_FAKE_CLOCK` / `FAKE_NOW` | off | Dev/test only |

There are **no secrets to manage.** The API uses Application Default Credentials and
signs URLs via `iam.serviceAccountTokenCreator` on its own service account — no key
file is ever downloaded.

### Web (Vite — all `VITE_`-prefixed, all public by nature)

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_USE_EMULATORS`, `VITE_AUTH_EMULATOR_URL`,
`VITE_API_BASE_URL`, `VITE_APP_URL`.

Only Firebase **Auth** is initialised in the browser. Firestore and Storage are
deliberately not — every read and write goes through the API, so "can this person see
this field" is decided in exactly one place instead of emerging from hand-written
security rules.

---

## Deploying

See `03-DEPLOY-RUNBOOK.md` (authoritative) and `infra/README.md`.

```bash
./scripts/bootstrap.sh    # first time on a new Argolis project
./scripts/deploy.sh       # build → push → terraform apply → firebase deploy
./scripts/deploy.sh --dry-run
```

Order of operations:
1. **Clear the Domain Restricted Sharing org-policy exception — a human does this
   manually.** `bootstrap.sh` prompts and verifies; it does not attempt to change org
   policy.
2. `bootstrap.sh` — prerequisites, API enablement, `terraform init` / `plan`. It never
   applies without explicit confirmation.
3. `deploy.sh` — images are tagged with the git short SHA, never `latest`, so a
   rollback has an immutable reference. Fails on a dirty working tree unless
   `--allow-dirty`.

Firebase Hosting is deployed via the CLI rather than Terraform — a deliberate call,
explained in `infra/README.md`.

> Terraform has **not** been machine-validated (`terraform validate` never ran — no
> binary, no network). Review the plan carefully on first apply.

---

## Gotchas

- **`npm install` will fail** in the sandboxed environment — there is no network and
  everything is already installed. Never run it.
- **Port 8080 collides** between the Firestore emulator and the API default. The
  local env files put the API on 8787.
- **Rebuild `packages/shared`** (`npx tsc -b`) after editing any contract, or the apps
  will typecheck against a stale `dist`.
- **Magic-link delivery to `@google.com` is unverified** — see STATUS.md, decision 2.
  Test with one real account before inviting the team.
