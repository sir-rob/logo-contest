/**
 * ADVERSARIAL SUITE — GUARANTEE A: no uploader identity in member responses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 01-SPEC.md §6, first hard guarantee:
 *
 *   "No member-facing API response ever contains `ownerUid` on a submission
 *    or any ballot belonging to another person."
 *
 * These tests are written to BREAK that, not to confirm it. Every member-facing
 * response is taken as SERIALISED JSON — the bytes Fastify actually wrote — and
 * walked recursively by `assertNoIdentityLeak`. A typed assertion on a DTO
 * would prove only that TypeScript is happy; it would not notice a route that
 * spreads a Firestore entity, a plugin that decorates the payload, or an error
 * body that echoes a lookup.
 *
 * The sweep over `registeredRoutes()` is the part that ages well: a member
 * route added in a year's time is scanned the day it is registered, whether or
 * not anybody thinks to add it to this file.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase.js', async () => (await import('./support/firebase-mock.js')).firebaseModule);

import {
  ENTRY_DEVON,
  ENTRY_MO,
  ENTRY_PRIYA,
  ENTRY_SAM,
  foreignTo,
  ownIdentity,
  seedCast,
  type Cast,
} from './support/cast.js';
import {
  buildTestApp,
  call,
  errorCode,
  registeredRoutes,
  resetTestState,
  seedBallot,
  seedContest,
  seedResultSnapshot,
  setupTestEnv,
  type InjectedResponse,
} from './support/harness.js';
import { assertNoIdentityLeak, collectKeys, IDENTITY_KEY_PATTERN } from './support/identity-leak.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let cast: Cast;

/**
 * The ONLY identity-shaped keys any member-facing route is allowed to emit,
 * and only on `/api/me` — the route that returns the caller to themselves.
 * Every other route is scanned with an empty allowlist.
 */
const ME_KEYS = ['uid', 'email', 'displayName', 'myBallot'];

beforeEach(async () => {
  setupTestEnv();
  resetTestState();
  seedContest();
  cast = seedCast();
  app = await buildTestApp();
});

/** Scan a response body against the caller's own identity allowlist. */
function scan(response: InjectedResponse, where: string, allowedKeys: string[] = []): void {
  assertNoIdentityLeak(response.json, {
    context: `${where} (HTTP ${response.status})`,
    ...ownIdentity(cast.sam),
    keys: allowedKeys,
    foreign: foreignTo(cast.sam, cast),
  });
}

// ===========================================================================
// A1 — every member-facing route, on the serialised bytes
// ===========================================================================

describe('A1 — member-facing responses carry no author field', () => {
  it('the gallery names nobody', async () => {
    const res = await call(app, { url: '/api/submissions', token: cast.sam.token });
    expect(res.status).toBe(200);

    // Belt: the literal key names, on the raw JSON text rather than the object.
    for (const banned of ['ownerUid', 'ownerEmail', 'ownerDisplayName', 'uploaderUid', 'createdBy', 'voterUid']) {
      expect(res.raw).not.toContain(banned);
    }
    // Braces: the recursive scan, which also catches names nobody banned.
    scan(res, 'GET /api/submissions');
  });

  it('the gallery returns every active entry — so the scan above had something to find', async () => {
    const res = await call(app, { url: '/api/submissions', token: cast.sam.token });
    const ids = ((res.json as { submissions: { id: string }[] }).submissions ?? []).map((s) => s.id).sort();
    expect(ids).toEqual([ENTRY_SAM, ENTRY_PRIYA, ENTRY_DEVON, ENTRY_MO].sort());
  });

  it('no gallery entry carries ANY key outside the public DTO', async () => {
    const res = await call(app, { url: '/api/submissions', token: cast.sam.token });
    const entries = (res.json as { submissions: Record<string, unknown>[] }).submissions;
    const permitted = new Set(['id', 'alias', 'thumbUrl', 'displayUrl', 'width', 'height', 'isMine', 'title', 'description']);
    for (const entry of entries) {
      for (const key of Object.keys(entry)) {
        expect(permitted.has(key), `unexpected field "${key}" on a public submission`).toBe(true);
      }
    }
  });

  it('/api/me returns the CALLER\u2019s own identity and nobody else\u2019s', async () => {
    seedBallot(cast.sam.uid, [ENTRY_PRIYA, ENTRY_DEVON]);
    const res = await call(app, { url: '/api/me', token: cast.sam.token });
    expect(res.status).toBe(200);

    const body = res.json as { uid: string; email: string; displayName: string };
    expect(body.uid).toBe(cast.sam.uid);
    expect(body.email).toBe(cast.sam.email);

    // `uid`, `email`, `displayName` and the ballot are allowed HERE and only
    // here: this route is by construction unable to address anybody else.
    scan(res, 'GET /api/me', ME_KEYS);
  });

  it('/api/me does not smuggle a second person in via the ballot', async () => {
    seedBallot(cast.sam.uid, [ENTRY_PRIYA, ENTRY_MO]);
    const res = await call(app, { url: '/api/me', token: cast.sam.token });
    const body = res.json as { myBallot: string[] | null };
    // A ranking is submission ids — never uids, never emails.
    expect(body.myBallot).toEqual([ENTRY_PRIYA, ENTRY_MO]);
    scan(res, 'GET /api/me ballot', ME_KEYS);
  });

  it('PATCH /api/me echoes only the caller', async () => {
    const res = await call(app, {
      method: 'PATCH',
      url: '/api/me',
      token: cast.sam.token,
      payload: { displayName: 'Sam Rivera' },
    });
    expect(res.status).toBe(200);
    scan(res, 'PATCH /api/me', ME_KEYS);
  });

  it('/api/dashboard publishes tallies, never voters', async () => {
    for (const [i, voter] of [cast.sam, cast.priya, cast.devon, cast.mo].entries()) {
      seedBallot(voter.uid, i % 2 === 0 ? [ENTRY_PRIYA, ENTRY_SAM] : [ENTRY_SAM, ENTRY_DEVON]);
    }
    const res = await call(app, { url: '/api/dashboard', token: cast.sam.token });
    expect(res.status).toBe(200);
    scan(res, 'GET /api/dashboard');
  });

  it('/api/dashboard standings name entries, not people', async () => {
    seedContest({ minBallotsToPublish: 1, showLiveStandings: true });
    for (const voter of [cast.sam, cast.priya, cast.devon, cast.mo]) {
      seedBallot(voter.uid, [ENTRY_PRIYA, ENTRY_SAM]);
    }
    const res = await call(app, { url: '/api/dashboard', token: cast.sam.token });
    const body = res.json as { standings: unknown[] | null };
    expect(body.standings, 'standings should be visible so the scan is meaningful').not.toBeNull();
    scan(res, 'GET /api/dashboard with standings');
  });

  it('/api/contest carries no people at all', async () => {
    const res = await call(app, { url: '/api/contest', token: cast.sam.token });
    expect(res.status).toBe(200);
    // Not even `createdBy`, which the contest ENTITY carries.
    expect(res.raw).not.toContain('createdBy');
    expect(res.raw).not.toContain('u-founder');
    scan(res, 'GET /api/contest');
  });

  it('/api/results reveals the winner\u2019s entry, not the winner', async () => {
    seedContest({ phase: 'RESULTS_PUBLISHED', minBallotsToPublish: 1 });
    seedResultSnapshot({
      winnerSubmissionId: ENTRY_PRIYA,
      eliminationOrder: [ENTRY_MO, ENTRY_DEVON, ENTRY_SAM, ENTRY_PRIYA],
      published: true,
    });
    const res = await call(app, { url: '/api/results', token: cast.sam.token });
    expect(res.status).toBe(200);

    const body = res.json as { winner: { id: string } | null; winnerCredit: string | null };
    expect(body.winner?.id).toBe(ENTRY_PRIYA);
    // Priya did not opt in, so she is not named. See the credit test below.
    expect(body.winnerCredit).toBeNull();
    scan(res, 'GET /api/results');
  });

  it('/api/results does not leak the admin who computed or broke a tie', async () => {
    seedContest({ phase: 'RESULTS_PUBLISHED', minBallotsToPublish: 1 });
    seedResultSnapshot({
      winnerSubmissionId: ENTRY_PRIYA,
      eliminationOrder: [ENTRY_MO, ENTRY_DEVON, ENTRY_SAM, ENTRY_PRIYA],
      computedBy: cast.mo.uid,
      published: true,
    });
    const res = await call(app, { url: '/api/results', token: cast.sam.token });

    // `computedBy` is stripped by `toResultSnapshotDto`. Assert on the bytes.
    expect(res.raw).not.toContain('computedBy');
    expect(res.raw).not.toContain(cast.mo.uid);

    // `decidedByUid` survives the projection (the schema keeps it) but the
    // counting engine always leaves it null. This pins that: the moment
    // anything starts stamping a real uid there, a member-facing route would
    // start publishing an administrator's Firestore uid.
    const rounds = (res.json as { snapshot: { rounds: { tieBreak: { decidedByUid: string | null } | null }[] } })
      .snapshot.rounds;
    for (const round of rounds) {
      expect(round.tieBreak?.decidedByUid ?? null).toBeNull();
    }
    scan(res, 'GET /api/results (admin identities)');
  });
});

// ===========================================================================
// A2 — the sweep: every member-facing route the router knows about
// ===========================================================================

describe('A2 — recursive sweep over every member-facing route', () => {
  /**
   * Routes whose response may legitimately contain an identity-shaped key,
   * with the exact paths that are permitted. Anything not listed here is
   * scanned with an empty allowlist, so a NEW member route starts out with
   * zero tolerance and has to be justified here on purpose.
   */
  const ALLOWED_KEYS: Record<string, string[]> = {
    'GET /api/me': ME_KEYS,
    'GET /api/ballot': ['ranking'],
  };

  it('sweeps every authenticated GET route outside /api/admin', async () => {
    seedContest({ phase: 'RESULTS_PUBLISHED', minBallotsToPublish: 1 });
    seedResultSnapshot({
      winnerSubmissionId: ENTRY_PRIYA,
      eliminationOrder: [ENTRY_MO, ENTRY_DEVON, ENTRY_SAM, ENTRY_PRIYA],
      published: true,
    });
    for (const voter of [cast.sam, cast.priya, cast.devon, cast.mo]) {
      seedBallot(voter.uid, [ENTRY_PRIYA, ENTRY_SAM]);
    }

    const memberRoutes = registeredRoutes(app).filter(
      (route) =>
        route.method === 'GET' &&
        route.url.startsWith('/api/') &&
        !route.url.startsWith('/api/admin') &&
        !route.url.includes(':'),
    );

    // If this ever drops to a handful, the enumeration broke and the sweep is
    // quietly testing nothing.
    expect(memberRoutes.length).toBeGreaterThanOrEqual(5);

    const swept: string[] = [];
    for (const route of memberRoutes) {
      const res = await call(app, { url: route.url, token: cast.sam.token });
      expect(res.status, `${route.url} should answer a member`).toBeLessThan(400);
      scan(res, `GET ${route.url}`, ALLOWED_KEYS[`GET ${route.url}`] ?? []);
      swept.push(route.url);
    }

    // Named here purely so a regression that stops registering a route is
    // visible as a diff rather than as a silently smaller sweep.
    expect(swept.sort()).toEqual(
      ['/api/ballot', '/api/contest', '/api/dashboard', '/api/me', '/api/results', '/api/submissions'].sort(),
    );
  });

  it('no member-facing payload contains an identity-shaped KEY at all, bar the documented few', async () => {
    const res = await call(app, { url: '/api/submissions', token: cast.sam.token });
    const keys = [...collectKeys(res.json)];
    const suspicious = keys.filter((key) => IDENTITY_KEY_PATTERN.test(key));
    expect(suspicious, `gallery payload keys: ${keys.join(', ')}`).toEqual([]);
  });

  it('error bodies from member routes leak nothing either', async () => {
    // Probe somebody else's entry: the 404 must be indistinguishable from the
    // 404 for an id that does not exist, and must name nobody.
    const theirs = await call(app, {
      method: 'PATCH',
      url: `/api/submissions/${ENTRY_PRIYA}`,
      token: cast.sam.token,
      payload: { title: 'Nice try' },
    });
    const nonexistent = await call(app, {
      method: 'PATCH',
      url: '/api/submissions/does-not-exist-at-all',
      token: cast.sam.token,
      payload: { title: 'Nice try' },
    });

    expect(errorCode(theirs)).toBe(errorCode(nonexistent));
    expect(theirs.status).toBe(nonexistent.status);
    expect(theirs.raw).toBe(nonexistent.raw);
    scan(theirs, 'PATCH /api/submissions/<someone else>');
  });

  it('deleting somebody else\u2019s entry is refused and silent about them', async () => {
    // Run inside the submissions window, so the request reaches the OWNERSHIP
    // check rather than being turned away by the phase gate first. Testing the
    // easy rejection would prove nothing about anonymity.
    seedContest({ phase: 'SUBMISSIONS_OPEN' });
    const theirs = await call(app, {
      method: 'DELETE',
      url: `/api/submissions/${ENTRY_DEVON}`,
      token: cast.sam.token,
    });
    const nonexistent = await call(app, {
      method: 'DELETE',
      url: '/api/submissions/no-such-entry',
      token: cast.sam.token,
    });

    expect(theirs.status).toBe(404);
    expect(errorCode(theirs)).toBe('SUBMISSION_NOT_FOUND');
    // Indistinguishable from "never existed" — otherwise id probing maps the
    // whole gallery to its owners by elimination.
    expect(theirs.raw).toBe(nonexistent.raw);
    scan(theirs, 'DELETE /api/submissions/<someone else>');
  });
});

// ===========================================================================
// A3 — isMine
// ===========================================================================

describe('A3 — isMine identifies the caller only, and nobody else', () => {
  it('is true for exactly one entry — the caller\u2019s', async () => {
    const res = await call(app, { url: '/api/submissions', token: cast.sam.token });
    const entries = (res.json as { submissions: { id: string; isMine: boolean }[] }).submissions;

    const mine = entries.filter((e) => e.isMine);
    expect(mine.map((e) => e.id)).toEqual([ENTRY_SAM]);
    expect(entries.filter((e) => !e.isMine).map((e) => e.id).sort()).toEqual(
      [ENTRY_PRIYA, ENTRY_DEVON, ENTRY_MO].sort(),
    );
  });

  it('moves with the caller rather than being baked into the entry', async () => {
    const asSam = await call(app, { url: '/api/submissions', token: cast.sam.token });
    const asPriya = await call(app, { url: '/api/submissions', token: cast.priya.token });

    const mineFor = (res: InjectedResponse): string[] =>
      (res.json as { submissions: { id: string; isMine: boolean }[] }).submissions
        .filter((e) => e.isMine)
        .map((e) => e.id);

    expect(mineFor(asSam)).toEqual([ENTRY_SAM]);
    expect(mineFor(asPriya)).toEqual([ENTRY_PRIYA]);
  });

  it('an entry with no owner among the viewers is nobody\u2019s', async () => {
    const res = await call(app, { url: '/api/submissions', token: cast.devon.token });
    const entries = (res.json as { submissions: { id: string; isMine: boolean }[] }).submissions;
    expect(entries.find((e) => e.id === ENTRY_PRIYA)?.isMine).toBe(false);
    expect(entries.find((e) => e.id === ENTRY_MO)?.isMine).toBe(false);
  });

  it('cannot be turned into an oracle: no caller sees another caller\u2019s isMine', async () => {
    // The de-anonymisation attack this blocks: if `isMine` were computed from
    // anything other than the CALLER's token — an id in the query string, say —
    // one member could iterate over uids and map every entry to its owner.
    // There is no parameter to iterate over, so the proof is that all four
    // callers see four different singleton answers over the same data.
    const seen = new Map<string, string[]>();
    for (const person of [cast.sam, cast.priya, cast.devon, cast.mo]) {
      const res = await call(app, { url: '/api/submissions', token: person.token });
      seen.set(
        person.uid,
        (res.json as { submissions: { id: string; isMine: boolean }[] }).submissions
          .filter((e) => e.isMine)
          .map((e) => e.id),
      );
    }
    expect([...seen.values()].every((ids) => ids.length === 1)).toBe(true);
    expect(new Set([...seen.values()].map((ids) => ids[0])).size).toBe(4);
  });

  it('the winner is credited by name ONLY on an explicit opt-in', async () => {
    // Spec §6: "only if that author opted in at upload time". The negative
    // case is covered in A1; this is the positive one, and it is the ONLY
    // place in the whole API where a member may learn another member's name.
    setupTestEnv();
    resetTestState();
    seedContest({ phase: 'RESULTS_PUBLISHED', minBallotsToPublish: 1 });
    const localCast = seedCast();
    // Re-seed Priya's entry with the opt-in set.
    const { seedSubmission } = await import('./support/harness.js');
    seedSubmission({ id: ENTRY_PRIYA, ownerUid: localCast.priya.uid, alias: 'Entry 01', creditOptIn: true });
    seedResultSnapshot({
      winnerSubmissionId: ENTRY_PRIYA,
      eliminationOrder: [ENTRY_MO, ENTRY_DEVON, ENTRY_SAM, ENTRY_PRIYA],
      published: true,
    });

    const localApp = await buildTestApp();
    const res = await call(localApp, { url: '/api/results', token: localCast.sam.token });
    expect((res.json as { winnerCredit: string | null }).winnerCredit).toBe('Priya Venkataraman');

    // And even then: a NAME, never an address and never a uid.
    expect(res.raw).not.toContain(localCast.priya.email);
    expect(res.raw).not.toContain(localCast.priya.uid);
    await localApp.close();
  });
});
