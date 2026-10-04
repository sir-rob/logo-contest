# Local development environment

Firebase emulator suite + a seed script. Everything below runs offline once the
emulator JARs have been downloaded once (see *First run* — that step needs the
network).

## Ports

| Service | Port | Notes |
|---|---|---|
| Firestore emulator | 8080 | |
| Auth emulator | 9099 | No mail is sent. See *Magic links* below. |
| Storage emulator | 9199 | Holds `submissions/<contestId>/<uuid>/…` |
| Hosting emulator | 5000 | Serves `apps/web/dist`, i.e. a built bundle |
| Emulator UI | 4000 | http://localhost:4000 |
| **API (Fastify)** | **8787** | **Not 8080.** See below. |
| Web (Vite dev server) | 5173 | |

**Why the API is on 8787.** The API's own default is `PORT=8080`, which is also
the Firestore emulator's port. Whichever starts second fails to bind, and the
symptom — "Firestore connection refused" or a 404 from the API — points at the
wrong thing entirely. The local env files pin the API to 8787 and the web app to
an absolute `VITE_API_BASE_URL=http://localhost:8787/api`.

Project id everywhere locally: `demo-n7-logo-contest`. The `demo-` prefix is
special-cased by the Firebase tooling and can never reach a live backend.

## First run

```bash
npm install                 # needs network
npx firebase --version      # first emulator start downloads JARs — needs network
make env                    # copies .env.local.example -> .env.local
$EDITOR .env.local          # set BOOTSTRAP_ADMIN_EMAIL to an address you will type
cp apps/web/.env.development apps/web/.env.development.local  # only if you need overrides
```

Then, in three terminals (or one `make dev`):

```bash
make emulators              # firebase emulators:start --import/--export-on-exit ./.emulator-data
npm run dev:api             # reads .env.local
npm run dev:web             # reads apps/web/.env.development
make seed                   # fills the emulators
```

`make emulators` imports from and exports to `./.emulator-data` (gitignored), so
a seeded contest survives a restart. Delete that directory for a clean slate.

## Seeding

```bash
make seed                                        # 20 members, voting phase, normal ballots
make seed ARGS="--phase=submissions --users=14"
make seed-tie                                    # guaranteed tie, contest closed
make seed-reset                                  # wipe everything, then reseed
npx tsx scripts/seed.ts --help
```

Direct invocation needs the env loaded first:

```bash
set -a && . ./.env.local && set +a
npx tsx scripts/seed.ts --preset=tie --users=12
```

| Flag | Meaning |
|---|---|
| `--users=N` | Members to create (default 20; the real contest is 10–25). |
| `--phase=setup\|submissions\|voting\|closed\|results` | Writes **real dates** around the real clock so `derivePhase` returns this phase. Default `voting`. |
| `--preset=normal\|tie\|landslide\|exhausting` | Ballot distribution. Default `normal`. |
| `--ballots=N` | How many members actually vote. Default `users - 2`, so turnout is not 100%. |
| `--seed=STRING` | PRNG seed. Default is a fixed constant — the same seed always produces the same contest. |
| `--reset` | Wipe emulator collections, Auth accounts and stored images first. |
| `--reset-only` | Wipe and stop. |

What it writes: Auth accounts (all `@google.com`, `emailVerified: true`, the
first one carrying the `admin: true` custom claim), user documents, one contest
document, one submission per member with **real PNG/WebP renditions** uploaded
to the Storage emulator, and — from the voting phase onwards — one ballot per
voter. It finishes by printing every seeded email address, so you know who you
can sign in as.

Re-running with the same `--seed` overwrites the same document ids and storage
paths rather than piling up duplicates.

### `--reset` is guarded on purpose

The script refuses to start unless `FIRESTORE_EMULATOR_HOST` is set. That
variable is the only thing that makes firebase-admin talk to an emulator instead
of to a real project, so requiring it makes "seed production" structurally
impossible rather than merely discouraged. A seed script that can be pointed at
production is a loaded gun, and `--reset` is the trigger: it deletes `users`,
`contests`, `submissions`, `ballots`, `results` and `auditLogs` wholesale.

### The presets

- **`normal`** — a plausible spread. No first-round majority, several rounds of
  transfers, a clear-ish but non-trivial winner.
- **`landslide`** — one entry takes an outright first-round majority.
- **`exhausting`** — 70% of ballots rank only one or two entries, so a large
  share exhaust before the final round and the active denominator shrinks.
- **`tie`** — **guaranteed** to produce two ties: one mid-count elimination tie
  (two candidates level on the lowest tally, which the deterministic tie-break
  chain has to resolve) and one final-round tie (the last two candidates level
  at exactly 50% each, which only the admin override can break). The ballot
  blocks are computed arithmetically, then verified by an independent count
  inside `seed-data.ts`; if the tie fails to materialise the script throws
  rather than writing a fixture that quietly does not test anything.

The contest's `tieBreakSeed` is a fixed constant, so tie-breaks are reproducible
across re-seeds.

## Magic links in the emulator — the main local friction

Sign-in is magic-link only, and **the Auth emulator never sends mail**. Nothing
arrives in any inbox. The link has to be fetched out of the emulator by hand:

```bash
curl -s "http://localhost:9099/emulator/v1/projects/demo-n7-logo-contest/oobCodes" \
  | jq -r '.oobCodes[-1].oobLink'
```

Open that URL in the browser to complete sign-in. Notes:

- `oobCodes` returns **all** outstanding codes, oldest first; `[-1]` is the one
  you just requested. Filter by address with
  `jq -r '.oobCodes[] | select(.email=="you@google.com") | .oobLink'`.
- The same links are listed in the emulator UI at http://localhost:4000 under
  **Authentication**, and the emulator prints them to its own console log.
- The `continueUrl` inside the link is built from `APP_URL`, so if you changed
  the Vite port, change `APP_URL` in `.env.local` too or the link lands nowhere.
- The address must be on `ALLOWED_DOMAINS` (`google.com`) *and* must exist —
  seed first, then sign in as one of the printed addresses.
- The seeded admin is whatever `BOOTSTRAP_ADMIN_EMAIL` is set to, and the seed
  gives that account the `admin: true` claim directly, so admin screens work on
  the first sign-in without waiting for the bootstrap path to run.

## Moving the clock

Two independent mechanisms:

1. **`--phase=…` (preferred).** Writes real dates positioned around the real
   clock. The app then behaves normally: countdowns tick, windows really are
   open, no special server state.
2. **`FAKE_NOW` + `ALLOW_FAKE_CLOCK=true`** (commented out in
   `.env.local.example`). `now(config)` in the API returns `FAKE_NOW` instead of
   the real time, honoured only when `NODE_ENV !== 'production'`. Use it to view
   *one* seeded fixture from a different moment — e.g. seed `--phase=voting`,
   then set `FAKE_NOW` past `votingClosesAt` to watch the same data go `CLOSED`.
   Only the API's clock moves; the browser still shows real time.

## Gotchas

- **First emulator start needs the network** to download the Firestore/Storage
  emulator JARs. After that it is fully offline.
- **`localhost` vs `127.0.0.1`.** The emulators bind IPv4. On a machine where
  `localhost` resolves to `::1` first, connections are refused for no visible
  reason — swap the emulator hosts in `.env.local` to `127.0.0.1`.
- **Storage emulator variable.** firebase-admin translates
  `FIREBASE_STORAGE_EMULATOR_HOST` into the `STORAGE_EMULATOR_HOST` that
  `@google-cloud/storage` actually reads. Set the `FIREBASE_`-prefixed one, with
  **no** `http://` scheme.
- **The hosting emulator's `/api/**` rewrite targets Cloud Run**, which does not
  exist locally. For local work use the Vite dev server on 5173 and the API on
  8787; the hosting emulator on 5000 is for checking a built bundle's routing
  and headers, not the API.
- **`.gitignore` ignores `.env.*`.** `.env.local.example` and
  `apps/web/.env.development` are meant to be committed, so the repo's
  `.gitignore` needs negations for them (`!.env.local.example`,
  `!apps/web/.env.development`) or they will silently never be added.
- **Seed generator tests.** `npx vitest run scripts` runs them here; the root
  `vitest.config.ts` `include` list does not yet cover `scripts/**`, so add
  `'scripts/**/*.{test,spec}.ts'` there to get them into `npm test`.
