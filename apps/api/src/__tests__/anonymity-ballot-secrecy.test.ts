/**
 * ADVERSARIAL SUITE — GUARANTEE B: ballots are sealed from everyone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 01-SPEC.md §6:
 *
 *   "Ballots are never attributable to a person in any UI, including admin.
 *    The admin dashboard shows who has voted (turnout, for chasing
 *    stragglers) but never what they voted."
 *   "Admins cannot see ballot contents — no view, no export, no exception."
 *
 * The attacks below are the ones that actually work against systems like this:
 *
 *   • ask for a ballot by somebody else's id, in every spelling a route might
 *     accept (path parameter, query string, body field, header);
 *   • find a route that returns MORE than one ballot;
 *   • read the ballot back out of a route that was never meant to carry it —
 *     turnout, moderation, audit, the CSV export;
 *   • recover the ranking from the export by correlating row order with the
 *     order ballots were cast.
 *
 * The enumeration test (B5) is the structural one: rather than trusting that
 * nobody added a ballot-listing route, it walks EVERY registered route, calls
 * it as an admin, and fails if any response carries a ranking.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase.js', async () => (await import('./support/firebase-mock.js')).firebaseModule);

import type { FastifyInstance } from 'fastify';
import { ENTRY_DEVON, ENTRY_MO, ENTRY_PRIYA, ENTRY_SAM, foreignTo, ownIdentity, seedCast, type Cast } from './support/cast.js';
import {
  buildTestApp,
  call,
  errorCode,
  registeredRoutes,
  resetTestState,
  seedBallot,
  seedContest,
  setupTestEnv,
} from './support/harness.js';
import { assertNoIdentityLeak, findIdentityLeaks } from './support/identity-leak.js';

let app: FastifyInstance;
let cast: Cast;

/**
 * Distinctive rankings, so a leaked one is unmistakable in any payload.
 *
 * Every one is at least two entries long and no two share an ordered pair, so
 * the sequence is a FINGERPRINT. A single-entry ranking would be useless as
 * one: `["sub-charlie"]` is just a gallery id, which appears legitimately all
 * over the place, and searching for it would produce nothing but noise.
 */
const SAM_RANKING = [ENTRY_PRIYA, ENTRY_DEVON, ENTRY_MO];
const PRIYA_RANKING = [ENTRY_MO, ENTRY_SAM];
const DEVON_RANKING = [ENTRY_SAM, ENTRY_MO, ENTRY_PRIYA, ENTRY_DEVON];
const MO_RANKING = [ENTRY_DEVON, ENTRY_PRIYA];

const ALL_RANKINGS = [SAM_RANKING, PRIYA_RANKING, DEVON_RANKING, MO_RANKING];

/**
 * The JSON spelling of an ordered ranking, without the enclosing brackets:
 * `"sub-bravo","sub-charlie"`. Finding this in a response body means the whole
 * ordered sequence is present — that is a ballot, not a coincidence.
 */
const jsonFingerprint = (ranking: readonly string[]): string => JSON.stringify(ranking).slice(1, -1);

/** The CSV spelling of the same thing. */
const csvFingerprint = (ranking: readonly string[]): string => ranking.join(',');

beforeEach(async () => {
  setupTestEnv();
  resetTestState();
  seedContest();
  cast = seedCast();
  seedBallot(cast.sam.uid, SAM_RANKING);
  seedBallot(cast.priya.uid, PRIYA_RANKING);
  seedBallot(cast.devon.uid, DEVON_RANKING);
  seedBallot(cast.mo.uid, MO_RANKING);
  app = await buildTestApp();
});

// ===========================================================================
// B4 — a member reads their own ballot and nobody else's
// ===========================================================================

describe('B4 — a member can read their own ballot and only their own', () => {
  it('each member gets back exactly what they cast', async () => {
    for (const [person, ranking] of [
      [cast.sam, SAM_RANKING],
      [cast.priya, PRIYA_RANKING],
      [cast.devon, DEVON_RANKING],
      [cast.mo, MO_RANKING],
    ] as const) {
      const res = await call(app, { url: '/api/ballot', token: person.token });
      expect(res.status).toBe(200);
      expect((res.json as { ranking: string[] | null }).ranking).toEqual([...ranking]);
    }
  });

  it('the ballot response contains ONLY a ranking — no voter, no timestamps', async () => {
    const res = await call(app, { url: '/api/ballot', token: cast.sam.token });
    expect(Object.keys(res.json as object)).toEqual(['ranking']);
    expect(res.raw).not.toContain('voterUid');
    expect(res.raw).not.toContain(cast.sam.uid);
  });

  it('there is no parameter, in any position, that names another voter', async () => {
    // Every way an API of this shape usually grows an accidental lookup.
    const attacks: Array<{ label: string; url: string; headers?: Record<string, string> }> = [
      { label: 'query ?uid=', url: `/api/ballot?uid=${cast.priya.uid}` },
      { label: 'query ?voterUid=', url: `/api/ballot?voterUid=${cast.priya.uid}` },
      { label: 'query ?email=', url: `/api/ballot?email=${encodeURIComponent(cast.priya.email)}` },
      { label: 'query ?user=', url: `/api/ballot?user=${cast.priya.uid}` },
      { label: 'query ?ballotId=', url: `/api/ballot?ballotId=north7_${cast.priya.uid}` },
      { label: 'path /ballot/<uid>', url: `/api/ballot/${cast.priya.uid}` },
      { label: 'path /ballots/<uid>', url: `/api/ballots/${cast.priya.uid}` },
      { label: 'path /ballots', url: '/api/ballots' },
      { label: 'header X-Act-As', url: '/api/ballot', headers: { 'x-act-as': cast.priya.uid } },
      { label: 'header X-User-Id', url: '/api/ballot', headers: { 'x-user-id': cast.priya.uid } },
    ];

    for (const attack of attacks) {
      const res = await call(app, {
        url: attack.url,
        token: cast.sam.token,
        ...(attack.headers ? { headers: attack.headers } : {}),
      });
      const ranking = (res.json as { ranking?: unknown } | undefined)?.ranking;
      // Either the route does not exist (404) or it ignored the parameter and
      // answered with the CALLER's own ballot. Never Priya's.
      expect(ranking ?? null, `${attack.label} returned a ranking`).not.toEqual([...PRIYA_RANKING]);
      if (ranking !== undefined && ranking !== null) {
        expect(ranking, `${attack.label} returned a ranking that is not the caller's`).toEqual([...SAM_RANKING]);
      }
      expect(res.raw, `${attack.label} echoed another member's uid`).not.toContain(cast.priya.uid);
    }
  });

  it('a member who has not voted gets null, not somebody else\u2019s ballot', async () => {
    setupTestEnv();
    resetTestState();
    seedContest();
    const fresh = seedCast();
    seedBallot(fresh.priya.uid, PRIYA_RANKING);
    const freshApp = await buildTestApp();

    const res = await call(freshApp, { url: '/api/ballot', token: fresh.sam.token });
    expect(res.status).toBe(200);
    expect((res.json as { ranking: string[] | null }).ranking).toBeNull();
    await freshApp.close();
  });

  it('deleting a ballot deletes the caller\u2019s and leaves everyone else\u2019s standing', async () => {
    const del = await call(app, { method: 'DELETE', url: '/api/ballot', token: cast.sam.token });
    expect(del.status).toBe(204);

    expect((((await call(app, { url: '/api/ballot', token: cast.sam.token })).json) as { ranking: unknown }).ranking).toBeNull();
    expect(
      (((await call(app, { url: '/api/ballot', token: cast.priya.token })).json) as { ranking: unknown }).ranking,
    ).toEqual([...PRIYA_RANKING]);
  });
});

// ===========================================================================
// B5 — no route anywhere exposes a ballot other than the caller's own
// ===========================================================================

describe('B5 — the registered route table contains no ballot-listing route', () => {
  /**
   * Rankings belonging to people other than the caller. Any response
   * containing one of these arrays — in any shape, under any key — is a
   * catastrophic failure of the central guarantee.
   */
  function foreignRankings(callerUid: string): string[][] {
    return (
      [
        [cast.sam.uid, SAM_RANKING],
        [cast.priya.uid, PRIYA_RANKING],
        [cast.devon.uid, DEVON_RANKING],
        [cast.mo.uid, MO_RANKING],
      ] as const
    )
      .filter(([uid]) => uid !== callerUid)
      .map(([, ranking]) => [...ranking]);
  }

  it('every ranking used here is a usable fingerprint', () => {
    // Guards the two tests below: if the rankings were one entry long, or if
    // two of them shared an ordered prefix, "not.toContain(fingerprint)" would
    // be checking almost nothing.
    for (const ranking of ALL_RANKINGS) expect(ranking.length).toBeGreaterThanOrEqual(2);
    const fingerprints = ALL_RANKINGS.map(jsonFingerprint);
    for (const a of fingerprints) {
      expect(fingerprints.filter((b) => b.includes(a))).toHaveLength(1);
    }
  });

  it('no GET route returns another person\u2019s ranking, to a member or to an admin', async () => {
    const routes = registeredRoutes(app).filter((r) => r.method === 'GET' && !r.url.includes(':'));
    expect(routes.length).toBeGreaterThanOrEqual(8);

    for (const caller of [cast.sam, cast.mo]) {
      const forbidden = foreignRankings(caller.uid);
      expect(forbidden).toHaveLength(3);

      for (const route of routes) {
        const res = await call(app, { url: route.url, token: caller.token });
        if (res.status >= 500) throw new Error(`${route.url} returned ${res.status}: ${res.raw}`);

        for (const ranking of forbidden) {
          expect(res.raw, `${route.url} leaked a ranking to ${caller.email}`).not.toContain(jsonFingerprint(ranking));
          expect(res.raw, `${route.url} leaked a ranking to ${caller.email}`).not.toContain(csvFingerprint(ranking));
        }
      }
    }
  });

  it('only the two own-ballot routes carry a ranking key, and only the caller\u2019s', async () => {
    const routes = registeredRoutes(app).filter((r) => r.method === 'GET' && !r.url.includes(':'));
    const withRanking: string[] = [];

    for (const route of routes) {
      const res = await call(app, { url: route.url, token: cast.mo.token });
      const leaks = findIdentityLeaks(res.json, { keys: [] }).filter((leak) => /ranking|ballot/i.test(leak.path));
      if (leaks.length > 0) withRanking.push(route.url);
    }

    // `/api/ballot` returns `{ranking}` and `/api/me` returns `{myBallot}`.
    // BOTH are the caller's own by construction — neither takes a parameter
    // that could name anybody else. Any third entry in this list is a leak.
    expect(withRanking.sort()).toEqual(['/api/ballot', '/api/me']);

    for (const url of withRanking) {
      const res = await call(app, { url, token: cast.mo.token });
      expect(res.raw).toContain(jsonFingerprint(MO_RANKING));
      for (const ranking of [SAM_RANKING, PRIYA_RANKING, DEVON_RANKING]) {
        expect(res.raw).not.toContain(jsonFingerprint(ranking));
      }
    }
  });

  it('there is no /api/admin/ballots, under any of the obvious names', async () => {
    const guesses = [
      '/api/admin/ballots',
      '/api/admin/ballot',
      '/api/ballots',
      '/api/admin/votes',
      '/api/admin/ballots/list',
      `/api/admin/ballots/${cast.priya.uid}`,
      `/api/admin/users/${cast.priya.uid}/ballot`,
      `/api/admin/turnout/${cast.priya.uid}`,
      '/api/admin/export/ballots-identified.csv',
    ];
    for (const url of guesses) {
      const res = await call(app, { url, token: cast.mo.token });
      expect(res.status, `${url} exists`).toBe(404);
    }
  });

  it('the route table itself mentions no ballot path beyond the singular own-ballot one', async () => {
    const ballotRoutes = registeredRoutes(app)
      .filter((r) => /ballot/i.test(r.url))
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(ballotRoutes).toEqual([
      'DELETE /api/ballot',
      'GET /api/admin/export/ballots.csv',
      'GET /api/ballot',
      'HEAD /api/admin/export/ballots.csv',
      'HEAD /api/ballot',
      'PUT /api/ballot',
    ]);
  });
});

// ===========================================================================
// B6 — admin routes: turnout, moderation, audit, export
// ===========================================================================

describe('B6 — no admin route returns a ranking attributable to a person', () => {
  const ADMIN_GETS = [
    '/api/admin/turnout',
    '/api/admin/submissions',
    '/api/admin/audit',
    '/api/admin/users',
    '/api/admin/export/ballots.csv',
  ];

  it('turnout says WHO voted and never WHAT', async () => {
    const res = await call(app, { url: '/api/admin/turnout', token: cast.mo.token });
    expect(res.status).toBe(200);

    const body = res.json as {
      rows: Array<Record<string, unknown>>;
      eligible: number;
      voted: number;
    };

    // WHO: the roster is populated and marks everyone as having voted.
    expect(body.rows.length).toBe(4);
    expect(body.rows.every((row) => row['hasVoted'] === true)).toBe(true);
    expect(body.voted).toBe(4);

    // WHAT: not a trace of it.
    expect(res.raw).not.toContain('ranking');
    for (const row of body.rows) {
      for (const key of Object.keys(row)) {
        expect(/rank|ballot|vote[ds]?for|choice|preference/i.test(key), `turnout row has field "${key}"`).toBe(false);
      }
    }
    for (const ranking of ALL_RANKINGS) {
      expect(res.raw).not.toContain(jsonFingerprint(ranking));
    }
  });

  it('turnout carries no submission id at all — not even the voter\u2019s own entry', async () => {
    // `hasSubmitted` is a boolean by design. An entry ID here would join
    // turnout (which names people) to the gallery (which does not), and that
    // join is the whole de-anonymisation.
    const res = await call(app, { url: '/api/admin/turnout', token: cast.mo.token });
    for (const id of [ENTRY_SAM, ENTRY_PRIYA, ENTRY_DEVON, ENTRY_MO]) {
      expect(res.raw, `turnout contains entry id ${id}`).not.toContain(id);
    }
  });

  it('the moderation view lifts uploader anonymity and nothing more', async () => {
    const res = await call(app, { url: '/api/admin/submissions', token: cast.mo.token });
    expect(res.status).toBe(200);

    // It is SUPPOSED to name uploaders — that is the one audited exception.
    expect(res.raw).toContain(cast.priya.email);
    // It is not supposed to say anything about how anybody voted.
    expect(res.raw).not.toContain('ranking');
    for (const ranking of ALL_RANKINGS) {
      expect(res.raw).not.toContain(jsonFingerprint(ranking));
    }
    const keys = new Set<string>();
    for (const entry of (res.json as { submissions: Record<string, unknown>[] }).submissions) {
      Object.keys(entry).forEach((k) => keys.add(k));
    }
    for (const key of keys) {
      expect(/rank|ballot|vote/i.test(key), `moderation DTO has field "${key}"`).toBe(false);
    }
  });

  it('the audit log records that identities were viewed, without recording a vote', async () => {
    // Viewing moderation writes the compensating audit entry.
    await call(app, { url: '/api/admin/submissions', token: cast.mo.token });
    const res = await call(app, { url: '/api/admin/audit', token: cast.mo.token });
    expect(res.status).toBe(200);

    const rows = (res.json as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows.some((row) => row['action'] === 'moderation.view_identities')).toBe(true);

    expect(res.raw).not.toContain('ranking');
    for (const ranking of ALL_RANKINGS) {
      expect(res.raw).not.toContain(jsonFingerprint(ranking));
    }
  });

  it('audit metadata cannot be used as a ballot smuggling channel', async () => {
    // `writeAudit` strips `ranking` / `ballot` / `ballots` from metadata. Prove
    // it on the wire rather than trusting the helper: disqualify an entry with
    // a reason, then confirm the row carries the reason and nothing ballot-like.
    const disq = await call(app, {
      method: 'POST',
      url: `/api/admin/submissions/${ENTRY_DEVON}/disqualify`,
      token: cast.mo.token,
      payload: { reason: 'Duplicate of another entry.' },
    });
    expect(disq.status).toBe(200);

    const res = await call(app, { url: '/api/admin/audit', token: cast.mo.token });
    const row = (res.json as { rows: Array<Record<string, unknown>> }).rows.find(
      (r) => r['action'] === 'submission.disqualify',
    );
    expect(row).toBeDefined();
    const metadata = row?.['metadata'] as Record<string, unknown>;
    expect(metadata['reason']).toBe('Duplicate of another entry.');
    expect(Object.keys(metadata)).not.toContain('ranking');
    expect(Object.keys(metadata)).not.toContain('ballot');
    // And no uploader identity copied into the log line either.
    expect(row?.['targetId']).toBe(ENTRY_DEVON);
    expect(JSON.stringify(row)).not.toContain(cast.devon.email);
    expect(JSON.stringify(row)).not.toContain(cast.devon.uid);
  });

  it('sweeps every admin GET route for a ranking', async () => {
    // Four ballots are seeded; lower the export's anonymity floor to match so
    // the sweep inspects a real file rather than a refusal.
    seedContest({ minBallotsToPublish: 4 });
    for (const url of ADMIN_GETS) {
      const res = await call(app, { url, token: cast.mo.token });
      expect(res.status, `${url} -> ${res.status}: ${res.raw}`).toBeLessThan(400);
      for (const ranking of ALL_RANKINGS) {
        // The ordered sequence, in CSV spelling and in JSON spelling.
        expect(res.raw, `${url} leaked a ranking (JSON form)`).not.toContain(jsonFingerprint(ranking));
        expect(res.raw, `${url} leaked a ranking (CSV form)`).not.toContain(csvFingerprint(ranking));
      }
    }
  });

  it('an admin cannot read a ballot by any route a member cannot', async () => {
    // The admin's OWN ballot is readable (they are a member too); nobody
    // else's is, and being an admin changes nothing about that.
    const own = await call(app, { url: '/api/ballot', token: cast.mo.token });
    expect((own.json as { ranking: string[] }).ranking).toEqual([...MO_RANKING]);

    const probe = await call(app, { url: `/api/ballot?voterUid=${cast.sam.uid}`, token: cast.mo.token });
    expect((probe.json as { ranking: string[] }).ranking).toEqual([...MO_RANKING]);
  });
});

// ===========================================================================
// B7 — the anonymised CSV export
// ===========================================================================

describe('B7 — the ballot export is anonymous in its content AND its order', () => {
  beforeEach(() => {
    // Four ballots are seeded, and the export refuses to run below the
    // contest's anonymity floor. Lower the floor to 4 so the export actually
    // produces a file to inspect; the floor itself is tested on its own below.
    seedContest({ minBallotsToPublish: 4 });
  });

  it('refuses to export below the anonymity floor', async () => {
    // Spec §6: "Aggregate counts are suppressed below a threshold where
    // they'd be identifying". A handful of rows of ranked aliases is
    // re-identifiable by anybody who knows who was in the room, so the export
    // must decline rather than round or truncate.
    seedContest({ minBallotsToPublish: 50 });
    const res = await call(app, { url: '/api/admin/export/ballots.csv', token: cast.mo.token });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(errorCode(res)).toBe('RESULTS_TOO_FEW_BALLOTS');
    for (const ranking of ALL_RANKINGS) {
      expect(res.raw).not.toContain(jsonFingerprint(ranking));
      expect(res.raw).not.toContain(csvFingerprint(ranking));
    }
  });

  async function exportCsv(): Promise<string> {
    const res = await call(app, { url: '/api/admin/export/ballots.csv', token: cast.mo.token });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    return res.raw;
  }

  it('contains no uid, email or display name', async () => {
    const csv = await exportCsv();
    for (const person of [cast.sam, cast.priya, cast.devon, cast.mo]) {
      expect(csv, `export contains ${person.uid}`).not.toContain(person.uid);
      expect(csv, `export contains ${person.email}`).not.toContain(person.email);
      expect(csv, `export contains ${person.displayName}`).not.toContain(person.displayName);
    }
    // And nothing email-shaped that the named checks above might have missed.
    assertNoIdentityLeak(
      { csv },
      {
        context: 'GET /api/admin/export/ballots.csv',
        keys: ['csv'],
        foreign: foreignTo(cast.mo, cast),
        ...ownIdentity(cast.mo),
      },
    );
  });

  it('parses into rows whose every cell is an alias or an anonymous index', async () => {
    const csv = await exportCsv();
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThan(1);

    const header = (lines[0] ?? '').split(',');
    expect(header[0]).toBe('ballot_id');
    // No identity column, whatever it might be called.
    for (const column of header) {
      expect(/uid|email|name|voter|user/i.test(column), `export column "${column}"`).toBe(false);
    }

    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
      const [ballotId, ...ranks] = cells;
      // B001, B002, ... — a sequential anonymous index, never the Firestore
      // ballot id (which is `<contestId>_<uid>` and would name every voter).
      expect(ballotId).toMatch(/^B\d{3,}$/);
      expect(ballotId).not.toContain('north7');
      for (const rank of ranks) {
        if (rank.length === 0) continue;
        expect(rank, `rank cell "${rank}" is not an alias`).toMatch(/^Entry \d+$/);
      }
    }
  });

  it('row order is a function of the votes, not of who voted when', async () => {
    // The attack: if rows came out in document order (which tracks the uid) or
    // in creation order (which tracks who voted first), an admin who knows
    // when one colleague voted can read that colleague's ballot straight off
    // the file. Casting the same four ballots in a DIFFERENT order must
    // produce a byte-identical export.
    const first = await exportCsv();

    setupTestEnv();
    resetTestState();
    seedContest({ minBallotsToPublish: 4 });
    const shuffled = seedCast();
    const base = Date.UTC(2026, 5, 1, 8, 0, 0);
    const hour = 60 * 60 * 1000;
    // Same ballots, reversed casting order and reversed timestamps.
    seedBallot(shuffled.mo.uid, MO_RANKING, new Date(base));
    seedBallot(shuffled.devon.uid, DEVON_RANKING, new Date(base + hour));
    seedBallot(shuffled.priya.uid, PRIYA_RANKING, new Date(base + 2 * hour));
    seedBallot(shuffled.sam.uid, SAM_RANKING, new Date(base + 3 * hour));
    const shuffledApp = await buildTestApp();
    const second = await call(shuffledApp, {
      url: '/api/admin/export/ballots.csv',
      token: shuffled.mo.token,
    });
    await shuffledApp.close();

    expect(second.raw).toBe(first);
  });

  it('exporting is itself audited, and the audit line carries no ballot', async () => {
    await exportCsv();
    const res = await call(app, { url: '/api/admin/audit', token: cast.mo.token });
    const row = (res.json as { rows: Array<Record<string, unknown>> }).rows.find(
      (r) => r['action'] === 'export.ballots',
    );
    expect(row, 'exporting ballots must be audited').toBeDefined();
    expect(JSON.stringify(row?.['metadata'])).not.toContain(ENTRY_PRIYA);
    expect(errorCode({ status: 200, raw: '', json: row, headers: {} })).toBeNull();
  });
});
