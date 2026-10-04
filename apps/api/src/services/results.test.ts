/**
 * Unit tests for the PURE parts of the results service.
 *
 * The IRV engine is stubbed with a fabricated `IrvResult` rather than invoked,
 * so nothing here depends on how the engine is implemented — but the fixture
 * is typed with the engine's own exported `IrvResult`, so any drift in that
 * contract surfaces as a type error in this file rather than as a runtime
 * surprise in production.
 */

import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ResultsSchema,
  StandingEntrySchema,
  type PublicSubmissionDto,
  type ResultSnapshot,
  type Round,
  type TieBreak,
} from '@contest/shared';
import { adminTieBreakKey, type IrvResult } from '../irv/index.js';
import {
  PROJECTION_MAX_AGE_MS,
  assertPublishable,
  finalTieBreakForWinner,
  isProjectionFresh,
  snapshotFromIrv,
  standingsFromSnapshot,
  toResultSnapshotDto,
  winnerDecidedByTieBreak,
} from './results.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRound(over: Partial<Round> & Pick<Round, 'round' | 'tallies'>): Round {
  const summed = Object.values(over.tallies).reduce((sum, n) => sum + n, 0);
  return {
    round: over.round,
    tallies: over.tallies,
    activeBallots: over.activeBallots ?? summed,
    exhaustedBallots: over.exhaustedBallots ?? 0,
    eliminated: over.eliminated ?? null,
    transfer: over.transfer ?? null,
    tieBreak: over.tieBreak ?? null,
    winner: over.winner ?? null,
  };
}

const COMPUTED_AT = new Date('2026-04-01T12:00:00.000Z');

/** A plausible three-candidate contest: `c` is eliminated, `a` beats `b`. */
function makeIrvResult(over: Partial<IrvResult> = {}): IrvResult {
  return {
    winnerSubmissionId: 'sub-a',
    rounds: [
      makeRound({
        round: 1,
        tallies: { 'sub-a': 6, 'sub-b': 5, 'sub-c': 4 },
        activeBallots: 15,
        eliminated: 'sub-c',
        transfer: { from: 'sub-c', to: { 'sub-a': 1, 'sub-b': 0 }, exhausted: 3 },
      }),
      makeRound({
        round: 2,
        tallies: { 'sub-a': 7, 'sub-b': 5 },
        activeBallots: 12,
        exhaustedBallots: 3,
        winner: 'sub-a',
      }),
    ],
    totalBallots: 15,
    exhaustedFinal: 3,
    eliminationOrder: ['sub-c', 'sub-b', 'sub-a'],
    seededTieBreaks: [],
    winnerDecidedByTieBreak: false,
    ...over,
  };
}

function makeSnapshot(over: Partial<ResultSnapshot> = {}): ResultSnapshot {
  return {
    ...snapshotFromIrv(makeIrvResult(), {
      contestId: 'north7',
      tieBreakSeed: 'seed-123',
      computedAt: COMPUTED_AT,
      computedBy: 'admin-uid-1',
      published: false,
      isProjection: false,
    }),
    ...over,
  };
}

function makeEntry(id: string, alias: string): PublicSubmissionDto {
  return {
    id,
    alias,
    thumbUrl: `https://cdn.example.com/${id}/thumb.webp`,
    displayUrl: `https://cdn.example.com/${id}/display.webp`,
    width: 1600,
    height: 1200,
    isMine: false,
  };
}

const ENTRIES = [makeEntry('sub-a', 'Entry 01'), makeEntry('sub-b', 'Entry 02'), makeEntry('sub-c', 'Entry 03')];

const seededTie: TieBreak = {
  tiedCandidates: ['sub-a', 'sub-b'],
  reason: 'seeded_shuffle',
  eliminated: 'sub-b',
  decidedByUid: null,
};

/** The same contest, but the winner only emerged from a coin flip. */
function makeTiedSnapshot(reason: TieBreak['reason'] = 'seeded_shuffle'): ResultSnapshot {
  return makeSnapshot({
    rounds: [
      makeRound({
        round: 1,
        tallies: { 'sub-a': 5, 'sub-b': 5, 'sub-c': 5 },
        activeBallots: 15,
        eliminated: 'sub-c',
      }),
      makeRound({
        round: 2,
        tallies: { 'sub-a': 6, 'sub-b': 6 },
        activeBallots: 12,
        exhaustedBallots: 3,
        eliminated: 'sub-b',
        tieBreak: { ...seededTie, reason, decidedByUid: reason === 'admin_override' ? 'admin-uid-1' : null },
      }),
      makeRound({ round: 3, tallies: { 'sub-a': 10 }, activeBallots: 10, exhaustedBallots: 5, winner: 'sub-a' }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

describe('snapshotFromIrv', () => {
  it('carries every engine field onto the snapshot', () => {
    const irv = makeIrvResult();
    const snapshot = snapshotFromIrv(irv, {
      contestId: 'north7',
      tieBreakSeed: 'seed-123',
      computedAt: COMPUTED_AT,
      computedBy: 'admin-uid-1',
      published: false,
      isProjection: false,
    });

    expect(snapshot).toMatchObject({
      contestId: 'north7',
      winnerSubmissionId: 'sub-a',
      totalBallots: 15,
      exhaustedFinal: 3,
      eliminationOrder: ['sub-c', 'sub-b', 'sub-a'],
      tieBreakSeed: 'seed-123',
      published: false,
      isProjection: false,
    });
    expect(snapshot.rounds).toEqual(irv.rounds);
    expect(snapshot.computedAt).toEqual(COMPUTED_AT);
  });

  it('records the tie-break seed from the contest, so a recount reproduces it', () => {
    const a = snapshotFromIrv(makeIrvResult(), {
      contestId: 'north7',
      tieBreakSeed: 'seed-123',
      computedAt: COMPUTED_AT,
      computedBy: 'x',
      published: false,
      isProjection: true,
    });
    expect(a.tieBreakSeed).toBe('seed-123');
    expect(a.isProjection).toBe(true);
  });

  it('stores WHO computed it — that is an audit fact', () => {
    expect(makeSnapshot().computedBy).toBe('admin-uid-1');
  });
});

describe('toResultSnapshotDto', () => {
  it('drops computedBy — an admin identity is not part of the public record', () => {
    const stored = makeSnapshot();
    expect(stored).toHaveProperty('computedBy');

    const dto = toResultSnapshotDto(stored);
    expect(dto).not.toHaveProperty('computedBy');
    expect(JSON.stringify(dto)).not.toContain('admin-uid-1');
  });

  it('serialises computedAt as an ISO string', () => {
    expect(toResultSnapshotDto(makeSnapshot()).computedAt).toBe('2026-04-01T12:00:00.000Z');
  });

  it('produces something ResultsSchema accepts, and the schema strips computedBy too', () => {
    const parsed = ResultsSchema.parse({
      snapshot: toResultSnapshotDto(makeSnapshot()),
      entries: ENTRIES,
      winner: ENTRIES[0],
      winnerCredit: null,
    });
    expect(parsed.snapshot).not.toHaveProperty('computedBy');
    expect(parsed.winnerCredit).toBeNull();
  });

  it('leaves the stored snapshot untouched', () => {
    const stored = makeSnapshot();
    toResultSnapshotDto(stored);
    expect(stored.computedBy).toBe('admin-uid-1');
  });
});

// ---------------------------------------------------------------------------
// Tie-break detection
// ---------------------------------------------------------------------------

describe('finalTieBreakForWinner / winnerDecidedByTieBreak', () => {
  it('finds nothing when the ballots decided it outright', () => {
    expect(finalTieBreakForWinner(makeSnapshot())).toBeNull();
    expect(winnerDecidedByTieBreak(makeSnapshot())).toBe(false);
  });

  it('finds the tie-break that separated the winner from the runner-up', () => {
    const tb = finalTieBreakForWinner(makeTiedSnapshot());
    expect(tb?.tiedCandidates).toEqual(['sub-a', 'sub-b']);
    expect(winnerDecidedByTieBreak(makeTiedSnapshot())).toBe(true);
  });

  it('ignores a tie-break the winner was not part of', () => {
    const snapshot = makeSnapshot({
      rounds: [
        makeRound({
          round: 1,
          tallies: { 'sub-a': 6, 'sub-b': 4, 'sub-c': 4 },
          eliminated: 'sub-c',
          tieBreak: { tiedCandidates: ['sub-b', 'sub-c'], reason: 'seeded_shuffle', eliminated: 'sub-c', decidedByUid: null },
        }),
        makeRound({ round: 2, tallies: { 'sub-a': 8, 'sub-b': 5 }, winner: 'sub-a' }),
      ],
    });
    expect(finalTieBreakForWinner(snapshot)).toBeNull();
    expect(winnerDecidedByTieBreak(snapshot)).toBe(false);
  });

  it('treats an admin override as already decided by a human', () => {
    expect(winnerDecidedByTieBreak(makeTiedSnapshot('admin_override'))).toBe(false);
  });

  it('finds nothing when there is no winner at all', () => {
    expect(finalTieBreakForWinner(makeSnapshot({ winnerSubmissionId: null }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The publish gate
// ---------------------------------------------------------------------------

describe('assertPublishable — the anonymity floor', () => {
  it('allows a clean result at or above the floor', () => {
    expect(() => assertPublishable(makeSnapshot(), { minBallotsToPublish: 5, adminTieBreaks: {} })).not.toThrow();
  });

  it('refuses below the floor, because transfers would identify individuals', () => {
    const snapshot = makeSnapshot({ totalBallots: 3 });
    try {
      assertPublishable(snapshot, { minBallotsToPublish: 5, adminTieBreaks: {} });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('RESULTS_TOO_FEW_BALLOTS');
    }
  });

  it('treats exactly the floor as enough', () => {
    expect(() =>
      assertPublishable(makeSnapshot({ totalBallots: 5 }), { minBallotsToPublish: 5, adminTieBreaks: {} }),
    ).not.toThrow();
  });

  it('falls back to the shared default when the contest does not say', () => {
    expect(() => assertPublishable(makeSnapshot({ totalBallots: 4 }), { adminTieBreaks: {} })).toThrow(ApiError);
    expect(() => assertPublishable(makeSnapshot({ totalBallots: 5 }), { adminTieBreaks: {} })).not.toThrow();
  });

  it('checks the floor before the tie, so the more fundamental refusal wins', () => {
    try {
      assertPublishable(makeTiedSnapshot(), { minBallotsToPublish: 50, adminTieBreaks: {} });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('RESULTS_TOO_FEW_BALLOTS');
    }
  });
});

describe('assertPublishable — the unresolved tie', () => {
  it('refuses a coin-flip winner the admin has not accepted', () => {
    try {
      assertPublishable(makeTiedSnapshot(), { minBallotsToPublish: 5, adminTieBreaks: {} });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('RESULTS_UNRESOLVED_TIE');
    }
  });

  it('is cleared by an override recorded for exactly that tied set', () => {
    const key = adminTieBreakKey(['sub-a', 'sub-b']);
    expect(() =>
      assertPublishable(makeTiedSnapshot(), {
        minBallotsToPublish: 5,
        adminTieBreaks: { [key]: 'sub-b' },
      }),
    ).not.toThrow();
  });

  it('is keyed on the tied set regardless of the order it was recorded in', () => {
    const key = adminTieBreakKey(['sub-b', 'sub-a']);
    expect(() =>
      assertPublishable(makeTiedSnapshot(), { minBallotsToPublish: 5, adminTieBreaks: { [key]: 'sub-b' } }),
    ).not.toThrow();
  });

  it('is NOT cleared by an override for a different tie', () => {
    const key = adminTieBreakKey(['sub-b', 'sub-c']);
    expect(() =>
      assertPublishable(makeTiedSnapshot(), { minBallotsToPublish: 5, adminTieBreaks: { [key]: 'sub-c' } }),
    ).toThrow(ApiError);
  });

  it('needs no override once the tie-break is itself an admin decision', () => {
    expect(() =>
      assertPublishable(makeTiedSnapshot('admin_override'), { minBallotsToPublish: 5, adminTieBreaks: {} }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

describe('standingsFromSnapshot', () => {
  const standings = standingsFromSnapshot(makeSnapshot(), ENTRIES);
  const byId = new Map(standings.map((s) => [s.submissionId, s]));

  it('produces one row per candidate, each valid against the schema', () => {
    expect(standings).toHaveLength(3);
    for (const row of standings) expect(() => StandingEntrySchema.parse(row)).not.toThrow();
  });

  it('takes votes from the FINAL round', () => {
    expect(byId.get('sub-a')?.votes).toBe(7);
    expect(byId.get('sub-b')?.votes).toBe(5);
    // Eliminated in round 1, so it holds nothing at the end.
    expect(byId.get('sub-c')?.votes).toBe(0);
  });

  it('computes share over active (non-exhausted) ballots', () => {
    expect(byId.get('sub-a')?.share).toBeCloseTo(7 / 12, 10);
    expect(byId.get('sub-b')?.share).toBeCloseTo(5 / 12, 10);
    expect(byId.get('sub-c')?.share).toBe(0);
  });

  it('shares sum to ~1 across the surviving candidates', () => {
    const total = standings.reduce((sum, row) => sum + row.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('does not divide by the exhausted ballots — the denominator is 12, not 15', () => {
    expect(byId.get('sub-a')?.share).not.toBeCloseTo(7 / 15, 4);
  });

  it('marks eliminations with the round they happened in', () => {
    expect(byId.get('sub-c')).toMatchObject({ eliminated: true, eliminatedRound: 1 });
    expect(byId.get('sub-a')).toMatchObject({ eliminated: false, eliminatedRound: null });
    expect(byId.get('sub-b')).toMatchObject({ eliminated: false, eliminatedRound: null });
  });

  it('orders by votes, leader first', () => {
    expect(standings.map((s) => s.submissionId)).toEqual(['sub-a', 'sub-b', 'sub-c']);
  });

  it('breaks equal-vote rows by how long the candidate survived', () => {
    const tied = standingsFromSnapshot(
      makeSnapshot({
        rounds: [makeRound({ round: 1, tallies: { 'sub-a': 5, 'sub-b': 5 }, activeBallots: 10 })],
        eliminationOrder: ['sub-b', 'sub-a'],
      }),
      [ENTRIES[1] as PublicSubmissionDto, ENTRIES[0] as PublicSubmissionDto],
    );
    expect(tied.map((s) => s.submissionId)).toEqual(['sub-a', 'sub-b']);
  });

  it('carries the alias and thumbnail so the client needs no join', () => {
    expect(byId.get('sub-a')).toMatchObject({
      alias: 'Entry 01',
      thumbUrl: 'https://cdn.example.com/sub-a/thumb.webp',
    });
  });

  it('yields zero shares rather than NaN when nothing has been counted', () => {
    const empty = standingsFromSnapshot(
      makeSnapshot({ rounds: [], totalBallots: 0, eliminationOrder: [] }),
      ENTRIES,
    );
    expect(empty.every((row) => row.votes === 0 && row.share === 0)).toBe(true);
  });

  it('falls back to the sum of tallies if a round reports no active ballots', () => {
    const rows = standingsFromSnapshot(
      makeSnapshot({ rounds: [makeRound({ round: 1, tallies: { 'sub-a': 3, 'sub-b': 1 }, activeBallots: 0 })] }),
      ENTRIES,
    );
    expect(rows.find((r) => r.submissionId === 'sub-a')?.share).toBeCloseTo(0.75, 10);
  });
});

// ---------------------------------------------------------------------------
// Projection freshness cache
// ---------------------------------------------------------------------------

describe('isProjectionFresh', () => {
  const at = new Date('2026-04-01T12:00:30.000Z');

  it('treats a missing projection as stale — there is nothing to reuse', () => {
    expect(isProjectionFresh(null, at)).toBe(false);
    expect(isProjectionFresh(undefined, at)).toBe(false);
  });

  it('reuses a projection computed a moment ago', () => {
    const snapshot = makeSnapshot({ computedAt: new Date(at.getTime() - 5_000), isProjection: true });
    expect(isProjectionFresh(snapshot, at)).toBe(true);
  });

  it('recomputes once the projection is older than the window', () => {
    const snapshot = makeSnapshot({ computedAt: new Date(at.getTime() - 20_000), isProjection: true });
    expect(isProjectionFresh(snapshot, at)).toBe(false);
  });

  it('uses a 15s window by default', () => {
    expect(PROJECTION_MAX_AGE_MS).toBe(15_000);
    const justInside = makeSnapshot({ computedAt: new Date(at.getTime() - (PROJECTION_MAX_AGE_MS - 1)) });
    const justOutside = makeSnapshot({ computedAt: new Date(at.getTime() - PROJECTION_MAX_AGE_MS) });
    expect(isProjectionFresh(justInside, at)).toBe(true);
    expect(isProjectionFresh(justOutside, at)).toBe(false);
  });

  it('accepts a caller-supplied window', () => {
    const snapshot = makeSnapshot({ computedAt: new Date(at.getTime() - 20_000) });
    expect(isProjectionFresh(snapshot, at, 60_000)).toBe(true);
  });

  it('does not spin forever on a clock skewed into the future', () => {
    const snapshot = makeSnapshot({ computedAt: new Date(at.getTime() + 5_000) });
    expect(isProjectionFresh(snapshot, at)).toBe(true);
  });
});
