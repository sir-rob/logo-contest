# Media Moguls (North 7) Logo Design Contest — Product & Technical Spec

**Status:** v0.2 — decisions resolved, ready to plan
**Owner:** Saurabh Malhotra
**Date:** 2026-09-13
**Target environment:** Google Cloud (Argolis) — new dedicated project

---

## 1. Purpose

A small, private web app that lets a team run a fair, anonymous logo contest to
choose the artwork for a team shirt.

Three things it must do well:

1. **Collect** — every participant uploads exactly one logo.
2. **Decide** — every participant ranks their top 5, and an instant-runoff
   (ranked choice) count produces a single winner.
3. **Reassure** — participants can always see and edit their own submission and
   their own ballot, while nobody can see who submitted or voted for what.

Scale is small and known: roughly 20–200 people, one contest at a time (the data
model supports multiple contests so the app is reusable next year).

---

## 2. Roles

| Role | Who | Can do |
|---|---|---|
| **Member** | Any signed-in, allowlisted participant | Upload/replace one logo, cast/edit one ballot, browse the anonymous gallery, view the dashboard |
| **Admin** | Saurabh + anyone he promotes | Everything a member can, plus: manage the contest timeline, open/close phases, promote/demote admins, disqualify submissions, run and publish results, break ties, export data |

- The first admin is **bootstrapped from a config value** (your account) at deploy
  time — no chicken-and-egg problem.
- Admins are stored as a role on the user record **and** mirrored into a Firebase
  Auth custom claim, so the server can authorize without an extra DB read.
- Admins can promote or demote other admins. **An admin cannot demote themselves
  if they are the last remaining admin** (prevents lockout).
- Every admin action is written to an audit log.

---

## 3. Contest lifecycle

The contest moves through phases. The admin sets dates; the app derives the
current phase from the clock, and the admin can also force a phase manually
(useful for "let's just close it now" or "reopen for 10 more minutes").

```
SETUP  →  SUBMISSIONS_OPEN  →  VOTING_OPEN  →  CLOSED  →  RESULTS_PUBLISHED
```

| Phase | Members can | Notes |
|---|---|---|
| `SETUP` | Nothing but see a "coming soon" page | Admin configures dates, rules, branding |
| `SUBMISSIONS_OPEN` | Upload / replace / withdraw their own logo | Gallery visible (anonymous). No voting yet |
| `VOTING_OPEN` | Cast and edit their ballot | **Submissions locked** — this is the key date you control |
| `CLOSED` | Read-only | Voting over, results computed but not necessarily shown |
| `RESULTS_PUBLISHED` | See full results + round-by-round elimination | Admin flips this deliberately |

Admin-editable dates: `submissionsOpenAt`, `submissionsCloseAt`,
`votingOpensAt`, `votingClosesAt`. Everything is stored in UTC and rendered in
the viewer's local timezone with an explicit label (e.g. "closes Fri Oct 3,
5:00 PM EDT"). A live countdown appears on the home page during any open window.

**Recommended default:** submission window and voting window are *sequential*,
not overlapping — otherwise early voters never see late entries, which is
unfair. An admin toggle allows overlap if you want it.

---

## 4. Submissions

- **Exactly one active submission per person per contest.** Uploading again
  replaces the previous one (the old file is retained internally for audit, not
  shown).
- Editable/replaceable at any time until `submissionsCloseAt`. After that the
  UI hides the upload control and the API rejects writes.
- Optional short **title** (≤ 60 chars) and **description** (≤ 240 chars). The
  UI warns: *don't put your name in it* — and the server rejects a title that
  matches the uploader's own display name or email local-part.
- Each entry gets a stable anonymous alias: **"Entry 07"** style, assigned by
  shuffled order at the close of submissions so numbering doesn't leak upload
  time.

**File rules**
- Accepted: PNG, JPEG, WebP. **SVG is rejected** (it's executable markup — an
  XSS vector in a browser gallery).
- Max 10 MB, min 512×512 px, max 6000×6000 px.
- On upload the server **strips all EXIF/XMP metadata** (camera, GPS, author
  fields are a real de-anonymization leak) and generates a 640px thumbnail and a
  1600px display render.
- Stored under a random UUID path in a **private** bucket — never a filename
  derived from the person. No public object ACLs; images are served through the
  API via short-lived signed URLs.
- A perceptual/content hash is recorded so admins get a "possible duplicate"
  flag if two people upload the same image.

---

## 5. Voting — ranked choice

### Ballot rules
- One ballot per person per contest.
- Rank **up to 5** distinct entries, position 1 = most preferred.
- A **partial ballot is valid** — ranking only 2 entries is allowed and counted.
  (Forcing 5 when someone only likes 2 produces noise.)
- No duplicates, no gaps (the UI enforces a contiguous 1..N ordering).
- Editable without limit until `votingClosesAt`; the last saved state counts.
- If fewer than 5 entries exist, the cap is the number of entries.
- **Self-voting: allowed, at any position including rank 1.** (Decided.) Self-votes
  largely cancel out across a group this size, and the rule is easy to explain.
  Retained as an admin toggle in case you want to tighten it before voting opens.

### Counting — Instant-Runoff Voting (IRV)
Each round:
1. Every non-exhausted ballot contributes **one** vote, to its highest-ranked
   candidate that has not yet been eliminated.
2. If a candidate holds **more than 50%** of the active (non-exhausted) votes,
   they win and counting stops.
3. Otherwise the candidate with the **fewest** votes is eliminated, and their
   ballots transfer to each voter's next surviving preference.
4. A ballot whose every ranked choice has been eliminated becomes **exhausted**
   and leaves the active denominator.
5. Repeat until a majority winner emerges or one candidate remains.

**Tie-breaking on elimination**, applied in order and fully deterministic:
1. Fewest votes in the previous round (backward tie-break).
2. Fewest total appearances anywhere on any ballot.
3. Fewest first-place votes overall.
4. A seeded shuffle — the seed is stored on the contest record, so any recount
   reproduces the identical result and can be independently verified.
5. Admin override: the UI surfaces an unbreakable tie and lets an admin choose,
   which is recorded in the audit log with the admin's name.

The full round-by-round tally is persisted as a **result snapshot** (rounds,
per-candidate counts, transfers, exhausted count, tie-break reasons) so results
are auditable and reproducible rather than recomputed on every page load.

---

## 6. Anonymity model

This is the requirement most likely to be violated by accident, so it's an
explicit architectural constraint, not a UI behavior.

**Hard guarantees**
- No member-facing API response ever contains `ownerUid` on a submission or any
  ballot belonging to another person.
- Ballots are **never attributable to a person in any UI, including admin.** The
  admin dashboard shows *who has voted* (turnout, for chasing stragglers) but
  never *what they voted*.
- The Firestore database and Cloud Storage bucket are **locked to the server
  identity only** — security rules deny all direct client access. The browser
  talks exclusively to the API. This means an anonymity bug has to be an API bug;
  it can't be a "someone opened devtools and queried the DB" bug.
- Uploaded images are stripped of metadata and stored under opaque UUIDs.
- Aggregate counts are suppressed below a threshold where they'd be identifying
  (e.g. results are not publishable with fewer than 5 ballots cast).

**Admin visibility — decided:**
- Admins **can** see uploader identity, because practical moderation requires it
  (removing something inappropriate, confirming one-entry-per-person, crediting
  the winner on the actual shirt). This is shown only in a dedicated moderation
  view, never in the normal gallery, and opening it is audit-logged.
- Admins **cannot** see ballot contents — no view, no export, no exception. Only
  aggregate tallies exist in the API surface.

**What the winner's reveal looks like:** when results are published, only the
*winning* entry's author is revealed (they're getting credit on the shirt), and
only if that author opted in at upload time via a checkbox. Everyone else stays
anonymous forever.

---

## 7. Dashboard

One page, three states, same visual language.

**During submissions** — participation, not standings:
- Entries so far, participants who've submitted vs. allowlisted, countdown to
  close, your own status ("You've submitted ✓ / You haven't submitted yet").

**During voting** — turnout and live standings, visible to everyone *(decided)*:
- Ballots cast vs. eligible, countdown, your own ballot status.
- **Live standings are public throughout voting.** Note the known trade-off: a
  visible frontrunner pulls late voters toward it. Kept behind an admin toggle
  (`showLiveStandings`) so you can switch it off mid-contest if the race starts
  looking like a bandwagon.
- Live standings show the **current IRV projection** — the full round-by-round
  count run against ballots cast so far — not just raw first-choice totals, so
  the number on screen means the same thing as the final result.

**After publication** — the full picture:
- Winner, presented properly (large, framed, with its alias and optional title).
- **Round-by-round elimination visual** — a flow/step chart showing each round's
  tallies, who was eliminated, and where their votes transferred. This is the
  fun part and the thing that makes ranked choice feel legitimate.
- Final standings table, exhausted-ballot count, total turnout.
- CSV export (admin only): anonymized ballots (ballot ID, ranked alias list) so
  a skeptic can recount independently without learning who anyone is.

---

## 8. Architecture

```
                  Firebase Hosting (CDN, TLS, custom domain)
                                │
                   ┌────────────┴────────────┐
                   │   static React bundle   │
                   └────────────┬────────────┘
                                │  /api/**  (Hosting rewrite)
                                ▼
                      Cloud Run — API service
                    (Node 20 + TypeScript + Fastify)
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
      Firestore            Cloud Storage        Firebase Auth
   (Native mode)        (private bucket)      (email magic link,
    locked rules         locked rules          admin claims)
```

**Stack choices and why**

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind + shadcn/ui | Fast, no server rendering needed, and shadcn gives us unstyled-but-accessible primitives we can theme into something genuinely minimal rather than bootstrap-y |
| Ranking UI | `dnd-kit` | Accessible drag-and-drop with full keyboard support — a drag-only ballot is an accessibility failure |
| API | Cloud Run, Node 20, Fastify, zod validation | Scales to zero (near-zero cost), one deployable, no cold-start pain at this scale |
| Identity | Firebase Auth, **email magic link only** | No passwords, and critically no OAuth — corp `@google.com` accounts are restricted from authorizing third-party OAuth apps, which an Argolis-owned client would be. A magic link only proves mailbox control, so that restriction never applies. ID token verified server-side on every request; `admin` custom claim |
| Data | Firestore Native | Document model fits this perfectly; transactions for one-submission-per-user and ballot writes |
| Images | Cloud Storage, private, signed URLs | Keeps images out of public indexing; sharp for EXIF strip + resize |
| Hosting | Firebase Hosting | Free CDN + TLS, and it sidesteps the Argolis org-policy friction around public Cloud Run (see §11) |
| IaC | Terraform + a `make bootstrap` script | Project is reproducible; you can tear it down and rebuild next year |

**Why not Firestore direct from the browser?** It's the obvious Firebase
pattern, but making anonymity depend on hand-written security rules is fragile.
An API-only design means there is exactly one place where "can this person see
this field" is decided.

---

## 9. Data model (Firestore)

```
users/{uid}
  email, displayName, photoURL, role: 'admin'|'member',
  createdAt, lastSeenAt

allowlist/{emailOrDomain}
  type: 'email'|'domain', value, addedBy, addedAt

contests/{contestId}
  title, description, phase, phaseOverride,
  submissionsOpenAt, submissionsCloseAt, votingOpensAt, votingClosesAt,
  maxRanks: 5, allowSelfVote, selfVoteMinPosition,
  showLiveStandings, minBallotsToPublish,
  tieBreakSeed, resultsPublishedAt, createdBy, createdAt

submissions/{submissionId}
  contestId, ownerUid (server-only), alias ('Entry 07'),
  title?, description?, creditOptIn,
  originalPath, displayPath, thumbPath, width, height, bytes, contentHash,
  status: 'active'|'withdrawn'|'disqualified',
  disqualifiedReason?, createdAt, updatedAt

ballots/{contestId}_{uid}
  contestId, voterUid, ranking: [submissionId, ...] (≤5),
  createdAt, updatedAt
  ── readable only by its owner; never returned in any list endpoint

results/{contestId}
  computedAt, computedBy, winnerSubmissionId,
  totalBallots, exhaustedFinal,
  rounds: [ { round, tallies: {subId: n}, eliminated, transfers, tieBreak? } ]
  published: bool

auditLogs/{autoId}
  actorUid, actorEmail, action, targetType, targetId, metadata, at
```

Indexes: `submissions(contestId, status)`, `ballots(contestId)`,
`auditLogs(at desc)`.

---

## 10. API surface (sketch)

All routes require a valid Firebase ID token; `/admin/**` additionally requires
the admin claim. Every mutating route is idempotent-safe and validated with zod.

```
GET    /api/me                        profile, role, my submission, my ballot
GET    /api/contest                   public contest config + derived phase
GET    /api/submissions               anonymous gallery (alias, image URLs only)
POST   /api/submissions               upload/replace my entry  [submissions open]
DELETE /api/submissions/mine          withdraw my entry        [submissions open]
GET    /api/ballot                    my ballot
PUT    /api/ballot                    save my ranking          [voting open]
GET    /api/dashboard                 phase-appropriate stats
GET    /api/results                   published results only

POST   /api/admin/contest             create / update contest + dates
POST   /api/admin/phase               force a phase transition
GET    /api/admin/turnout             who has submitted / voted (not what)
GET    /api/admin/submissions         gallery WITH uploader identity (audited)
POST   /api/admin/submissions/:id/disqualify
POST   /api/admin/users/:uid/role     promote / demote admin
POST   /api/admin/allowlist           add / remove entries
POST   /api/admin/results/compute     run IRV, store snapshot
POST   /api/admin/results/publish     make results visible to all
GET    /api/admin/export              anonymized ballots CSV
GET    /api/admin/audit               audit log
```

---

## 11. Deployment (Argolis)

New dedicated project, e.g. `n7-logo-contest`.

**APIs to enable:** `run`, `firestore`, `firebase`, `firebasehosting`,
`identitytoolkit`, `storage`, `artifactregistry`, `cloudbuild`, `iam`,
`secretmanager`.

**Known Argolis friction — flagged early because it bites everyone:**
- `constraints/iam.allowedPolicyMemberDomains` (Domain Restricted Sharing) blocks
  granting `allUsers`, which is what public Cloud Run and Firebase Hosting
  rewrites need. We'll need an org-policy exception scoped **to this one
  project**. You have org admin on your Argolis org, so this is a
  two-minute change — but it must happen before the first deploy.
- `constraints/storage.publicAccessPrevention` should stay **enforced** — we
  want the bucket private anyway. No exception needed.
- Argolis projects have a billing/quota ceiling; this app's steady-state cost is
  effectively zero (Cloud Run scales to zero, Firestore and Storage are within
  free tier at this scale).

**Access control — decided: single domain, magic-link sign-in.** Access is
restricted to one email domain, set as a deploy-time config value
(`ALLOWED_DOMAINS`, comma-separated, currently `google.com`).

The flow is: enter your email → receive a one-time sign-in link → click it →
you're in. No password, no OAuth, no account to create. The domain is checked
**before a link is ever sent**, so an off-domain address simply gets a clean
rejection and no email. The gate is re-checked on every authenticated API
request, not just at sign-in.

Possession of a `@google.com` mailbox *is* the membership test, which is exactly
the property we want and nothing more than we need.

The domain is a single environment variable, so switching it later is a config
change and a redeploy, not a code change. The exact domain still needs
confirming before deploy (see §12).

**Environments:** one project is enough. We'll run locally against the Firebase
emulator suite for development, so no cloud spend or pollution during the build.

---

## 12. Decisions

Resolved 2026-09-13:

| # | Question | Decision |
|---|---|---|
| 1 | Who can sign in | **Single Google Workspace domain**, set via `ALLOWED_DOMAIN`. No per-person allowlist |
| 2 | Admins see uploader identity | **Yes** — separate moderation view only, every access audit-logged. Ballots sealed from everyone |
| 3 | Live standings during voting | **Public throughout**, showing the live IRV projection. Admin toggle retained |
| 4 | Self-voting | **Allowed at any rank**, including rank 1 |
| 5 | Contest name | **Media Moguls (North 7) Logo Design Contest**; team name "Media Moguls (North 7)" |
| 6 | Participant count | **10–25** → `minBallotsToPublish = 5` |

**Consequences of #6 worth noting.** At 10–25 people the contest is small enough
that a few specifics change:

- Ties are *likely*, not theoretical. With ~15 ballots, several entries will sit
  on one or two first-choice votes in early rounds. The deterministic tie-break
  chain in §5 does real work here, and the admin override UI is not a rare
  edge case — build it properly.
- Ballots may exhaust quickly. With 20 entries and only 5 ranks each, later
  rounds can have a large exhausted pile. The results view must show the
  exhausted count prominently so the winner's "majority" is honestly framed as a
  majority of *continuing* ballots.
- Turnout matters more than tallies. One person forgetting to vote is 5% of the
  electorate, so the nudge-the-stragglers turnout view is high value.

| 7 | `ALLOWED_DOMAIN` | **`google.com`** — corp accounts, not the Argolis `altostrat.com` the project lives in |
| 8 | App URL | Default Firebase Hosting `n7-logo-contest.web.app`; no custom domain |

| 9 | Sign-in method | **Email magic link only.** No Google sign-in, no OAuth, no passwords |

**`ALLOWED_DOMAINS` is a comma-separated list**, not a single string, even though
only one value is configured today — so admitting a second domain later stays a
config change rather than a code change.

**Why magic link instead of Google sign-in (decision 9).** The original design
used Google sign-in, which would have been the obvious choice. It doesn't work
here: the app is hosted in Argolis, corp `@google.com` accounts are restricted
from authorizing third-party OAuth applications, and an Argolis-owned OAuth
client is exactly that from corp's perspective. Consent would likely be refused
and *nobody* could sign in.

A magic link sidesteps this because no OAuth is involved. We never request access
to anyone's Google account, no scopes, no tokens, no profile data. We send mail
to an address and see whether the person can click what arrives. Possession of
the mailbox is the entire claim being verified — which is precisely the
membership test we want, and strictly less access than the OAuth flow asked for.

Secondary benefits: no Google profile means no avatar and no verified real name
to store, so the app holds less identifying data about participants than it
otherwise would. That aligns with the anonymity goal rather than fighting it.

The trade-off moves the risk from *authorization* to *deliverability* — see
§14a.

### Still open (not blocking the build)

1. **Winner's author revealed** at the end — opt-in checkbox at upload, winner
   only? *Recommend yes.* Building it opt-in either way; this only decides the
   default state of the checkbox.
2. **Magic-link deliverability to corp inboxes** — must be tested early. See
   §14a and the runbook.

---

## 14a. Magic-link risks and mitigations

| Risk | Mitigation |
|---|---|
| **Corp mail filters treat "click to sign in" from an unfamiliar domain as phishing** — the main risk, and it replaces the OAuth risk rather than eliminating risk altogether | Test deliverability to a real `@google.com` inbox early in the build. Tell the team the mail is coming and what it looks like. Fallback: email a 6-digit code instead of a link and mint the session with `createCustomToken` |
| Link opened on a different device than requested (phone vs laptop) fails confusingly | Detect the missing local email hint and prompt for the address to complete sign-in. The most common way email-link auth ships broken |
| App becomes a way to spam a colleague's inbox | Per-email (3/15 min) and per-IP (10/hr) rate limits before any send |
| Forwarded link lets someone else sign in as you | Links are single-use and short-lived; treat mailbox access as equivalent to account access, which is the standard assumption for email-based auth |
| Session friction across a multi-visit contest | Persistent sessions — sign in roughly once per device, not once per visit |

---

## 13. Design direction

The brief is *clean, neat, minimalist, sophisticated*. Concretely:

**Palette** — near-monochrome. Warm off-white paper (`#FAFAF8`), deep ink
(`#141414`), a soft graphite scale for structure, and exactly **one** restrained
accent used sparingly for state and action (a muted bronze / deep teal — I'll
mock both). Color never carries meaning alone.

**Type** — a high-contrast serif for display (Instrument Serif or Fraunces) set
against a neutral grotesque for UI text (Inter). Large, confident headings;
generous line height; no more than two weights in play at once.

**Space and structure** — an 8px grid, wide margins, and the discipline to leave
areas empty. Hairline 1px dividers instead of cards-on-cards. Shadows are
near-absent; elevation is communicated with spacing and a single subtle border.

**Components**
- *Gallery*: a calm, even grid of entries in identical neutral frames — every
  logo presented the same way so presentation never advantages an entry.
- *Ballot*: a two-column workspace — entries on the left, five numbered slots on
  the right. Drag to place, or use keyboard/number keys. Empty slots are shown
  as quiet dashed outlines, not errors.
- *Results*: the round-by-round elimination as a horizontal flow — thin bands of
  vote transfer between rounds, eliminated entries fading out. Restrained
  motion, ~200ms easing, and it respects `prefers-reduced-motion`.

**Accessibility** is part of "clean": WCAG AA contrast, full keyboard path
through upload and ballot, visible focus rings, and real labels on everything.

---

## 14. Out of scope (v1)

Comments or discussion on entries; multiple simultaneous public contests;
email/chat notifications (a nudge-to-vote email is an easy v1.1); mobile native
apps (the web UI is responsive); AI-generated logo creation inside the app;
public/unauthenticated viewing.
