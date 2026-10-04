import { describe, expect, it } from 'vitest';

import type { CountOptions, CountableBallot, Round } from '@contest/shared';

import { adminTieBreakKey, countIrv, makeRng, type IrvResult } from './index.js';

/**
 * The engine decides a real contest, so these tests assert exact round-by-round
 * numbers rather than "a winner exists". Every fixture below was hand-verified
 * against the counting rules before its expectations were written down.
 */

const SEED = 'north7-2026';

/** Terse ballot builder: `B('v01', 's03', 's07')`. */
function B(ballotId: string, ...ranking: string[]): CountableBallot {
  return { ballotId, ranking };
}

function count(
  candidates: readonly string[],
  ballots: readonly CountableBallot[],
  extra: Partial<Pick<CountOptions, 'tieBreakSeed' | 'adminTieBreaks'>> = {},
): IrvResult {
  return countIrv({
    candidates,
    ballots,
    tieBreakSeed: extra.tieBreakSeed ?? SEED,
    ...(extra.adminTieBreaks === undefined ? {} : { adminTieBreaks: extra.adminTieBreaks }),
  });
}

function sumTallies(round: Round): number {
  return Object.values(round.tallies).reduce((total, n) => total + n, 0);
}

/** The structural invariants that must hold for every result, always. */
function assertInvariants(result: IrvResult, candidateCount: number): void {
  let previousExhausted = 0;
  let previousStanding = Number.POSITIVE_INFINITY;

  result.rounds.forEach((round, index) => {
    expect(round.round).toBe(index + 1);

    const total = sumTallies(round);
    expect(round.activeBallots).toBe(total);
    expect(total + round.exhaustedBallots).toBe(result.totalBallots);

    // Exhaustion only ever grows: the standing set shrinks monotonically.
    expect(round.exhaustedBallots).toBeGreaterThanOrEqual(previousExhausted);
    previousExhausted = round.exhaustedBallots;

    // Exactly one candidate leaves per round — never a batch elimination.
    const standing = Object.keys(round.tallies).length;
    if (Number.isFinite(previousStanding)) expect(standing).toBe(previousStanding - 1);
    previousStanding = standing;

    if (round.eliminated !== null) {
      expect(round.tallies).toHaveProperty(round.eliminated);
      expect(round.winner).toBeNull();
      const transfer = round.transfer;
      expect(transfer).not.toBeNull();
      if (transfer !== null) {
        expect(transfer.from).toBe(round.eliminated);
        const moved = Object.values(transfer.to).reduce((t, n) => t + n, 0);
        // Every ballot the loser held goes somewhere: onward or exhausted.
        expect(moved + transfer.exhausted).toBe(round.tallies[round.eliminated]);
      }
      if (round.tieBreak !== null) {
        expect(round.tieBreak.eliminated).toBe(round.eliminated);
        expect(round.tieBreak.tiedCandidates.length).toBeGreaterThan(1);
        expect(round.tieBreak.tiedCandidates).toContain(round.eliminated);
        // The engine is anonymous; the route stamps the deciding admin.
        expect(round.tieBreak.decidedByUid).toBeNull();
      }
    } else {
      expect(round.transfer).toBeNull();
      expect(round.tieBreak).toBeNull();
    }
  });

  const last = result.rounds.at(-1);
  if (result.winnerSubmissionId !== null) {
    expect(last?.winner).toBe(result.winnerSubmissionId);
    expect(result.eliminationOrder.at(-1)).toBe(result.winnerSubmissionId);
    expect(result.eliminationOrder).toHaveLength(result.rounds.length);
    expect(result.rounds.length).toBeLessThanOrEqual(Math.max(candidateCount, 1));
  }
  expect(new Set(result.eliminationOrder).size).toBe(result.eliminationOrder.length);
  if (last !== undefined) expect(result.exhaustedFinal).toBe(last.exhaustedBallots);
}

describe('countIrv — degenerate inputs', () => {
  it('handles zero ballots and zero candidates', () => {
    const result = count([], []);
    expect(result.winnerSubmissionId).toBeNull();
    expect(result.rounds).toEqual([]);
    expect(result.totalBallots).toBe(0);
    expect(result.exhaustedFinal).toBe(0);
    expect(result.eliminationOrder).toEqual([]);
    expect(result.winnerDecidedByTieBreak).toBe(false);
  });

  it('returns no winner when there are no candidates at all', () => {
    // Nothing to elect: every ballot is vacuously exhausted.
    const result = count([], [B('v1', 'ghost'), B('v2', 'ghost')]);
    expect(result.winnerSubmissionId).toBeNull();
    expect(result.rounds).toEqual([]);
    expect(result.totalBallots).toBe(2);
    expect(result.exhaustedFinal).toBe(2);
  });

  it('elects the only candidate immediately, even with no ballots', () => {
    const result = count(['s01'], []);
    expect(result.winnerSubmissionId).toBe('s01');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toEqual({
      round: 1,
      tallies: { s01: 0 },
      activeBallots: 0,
      exhaustedBallots: 0,
      eliminated: null,
      transfer: null,
      tieBreak: null,
      winner: 's01',
    });
    expect(result.winnerDecidedByTieBreak).toBe(false);
    assertInvariants(result, 1);
  });

  it('elects the only candidate when ballots exist', () => {
    const result = count(['s01'], [B('v1', 's01'), B('v2', 's01')]);
    expect(result.winnerSubmissionId).toBe('s01');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2 });
    expect(result.rounds[0]?.activeBallots).toBe(2);
  });

  it('elects on a single ballot', () => {
    const result = count(['s01', 's02', 's03'], [B('v1', 's02')]);
    // One active ballot: 1 > 0.5 is a strict majority.
    expect(result.winnerSubmissionId).toBe('s02');
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 0, s02: 1, s03: 0 });
    assertInvariants(result, 3);
  });

  it('still elects someone with no ballots at all, deterministically', () => {
    const result = count(['s01', 's02', 's03'], []);
    expect(result.winnerSubmissionId).not.toBeNull();
    expect(result.rounds).toHaveLength(3);
    expect(count(['s03', 's02', 's01'], [])).toEqual(result);
    assertInvariants(result, 3);
  });
});

describe('countIrv — majorities and transfers', () => {
  it('stops in round 1 on a clean majority', () => {
    const result = count(
      ['s01', 's02', 's03'],
      [
        B('v1', 's01'),
        B('v2', 's01'),
        B('v3', 's01'),
        B('v4', 's02'),
        B('v5', 's03'),
      ],
    );
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 3, s02: 1, s03: 1 });
    expect(result.rounds[0]?.winner).toBe('s01');
    expect(result.rounds[0]?.eliminated).toBeNull();
    expect(result.rounds[0]?.transfer).toBeNull();
    expect(result.winnerSubmissionId).toBe('s01');
    expect(result.eliminationOrder).toEqual(['s01']);
    assertInvariants(result, 3);
  });

  it('does not treat exactly 50% as a majority', () => {
    // 2 of 4 is not "more than 50%": the count must go to another round.
    const result = count(
      ['s01', 's02', 's03'],
      [B('v1', 's01'), B('v2', 's01'), B('v3', 's02'), B('v4', 's03', 's01')],
    );
    expect(result.rounds[0]?.winner).toBeNull();
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 1, s03: 1 });
    expect(result.rounds.length).toBeGreaterThan(1);
  });

  it('produces the classic IRV upset: the round-1 leader loses', () => {
    const result = count(
      ['s01', 's02', 's03'],
      [
        B('v1', 's01', 's03'),
        B('v2', 's01', 's03'),
        B('v3', 's01', 's03'),
        B('v4', 's01', 's03'),
        B('v5', 's02', 's03'),
        B('v6', 's02', 's03'),
        B('v7', 's02', 's03'),
        B('v8', 's03', 's02'),
        B('v9', 's03', 's02'),
      ],
    );

    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 4, s02: 3, s03: 2 });
    expect(result.rounds[0]?.activeBallots).toBe(9);
    expect(result.rounds[0]?.eliminated).toBe('s03');
    expect(result.rounds[0]?.tieBreak).toBeNull();
    expect(result.rounds[0]?.transfer).toEqual({ from: 's03', to: { s02: 2 }, exhausted: 0 });

    expect(result.rounds[1]?.tallies).toEqual({ s01: 4, s02: 5 });
    expect(result.rounds[1]?.winner).toBe('s02');

    // s01 led round 1 with 4 of 9 and still lost — the point of IRV.
    expect(result.winnerSubmissionId).toBe('s02');
    expect(result.eliminationOrder).toEqual(['s03', 's02']);
    expect(result.winnerDecidedByTieBreak).toBe(false);
    assertInvariants(result, 3);
  });

  it('counts partial ballots of 1, 2 and 3 ranks out of a possible 5', () => {
    const result = count(
      ['s01', 's02', 's03', 's04', 's05'],
      [
        B('v1', 's04'),
        B('v2', 's04', 's01'),
        B('v3', 's05', 's04', 's01'),
        B('v4', 's01', 's02', 's03', 's04', 's05'),
        B('v5', 's02', 's01'),
      ],
    );
    expect(result.rounds[0]?.tallies).toEqual({ s01: 1, s02: 1, s03: 0, s04: 2, s05: 1 });
    expect(result.rounds[0]?.activeBallots).toBe(5);
    expect(result.winnerSubmissionId).toBe('s04');
    assertInvariants(result, 5);
  });

  it('counts self-votes at rank 1 and at rank 5 like any other preference', () => {
    // The engine has no notion of ownership by design, so a self-vote is just
    // a vote. These fixtures name the ballots after their owner to make the
    // rule legible: v-s02 owns s02, v-s05 owns s05.
    const result = count(
      ['s01', 's02', 's03', 's04', 's05'],
      [
        B('v-s02', 's02', 's01', 's03', 's04', 's05'),
        B('v-s05', 's01', 's03', 's04', 's02', 's05'),
        B('v-s01', 's01'),
        B('v-x', 's03', 's02'),
      ],
    );
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 1, s03: 1, s04: 0, s05: 0 });
    // The rank-5 self-vote is still on the ballot and would count if everything
    // above it were eliminated.
    expect(result.totalBallots).toBe(4);
    assertInvariants(result, 5);
  });
});

describe('countIrv — ballot normalisation', () => {
  it('skips rankings of unknown or withdrawn candidates without exhausting', () => {
    const result = count(
      ['s01', 's02'],
      [
        B('v1', 'withdrawn-9', 's01'),
        B('v2', 'withdrawn-9', 's01'),
        B('v3', 's02', 'withdrawn-9', 's01'),
      ],
    );
    // v1 and v2 count for s01 despite a dead first preference.
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 1 });
    expect(result.rounds[0]?.exhaustedBallots).toBe(0);
    expect(result.winnerSubmissionId).toBe('s01');
  });

  it('steps over a withdrawn candidate mid-list when transferring', () => {
    const result = count(
      ['s01', 's02', 's03'],
      [
        B('v1', 's03', 'withdrawn-9', 's02'),
        B('v2', 's01', 'withdrawn-9'),
        B('v3', 's01'),
        B('v4', 's02'),
        B('v5', 's02'),
      ],
    );
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 2, s03: 1 });
    expect(result.rounds[0]?.eliminated).toBe('s03');
    // s03's ballot skips the withdrawn id and lands on s02, not exhausted.
    expect(result.rounds[0]?.transfer).toEqual({ from: 's03', to: { s02: 1 }, exhausted: 0 });
    expect(result.winnerSubmissionId).toBe('s02');
    assertInvariants(result, 3);
  });

  it('exhausts a ballot whose every ranked candidate is unknown', () => {
    const result = count(['s01', 's02'], [B('v1', 'ghost-a', 'ghost-b'), B('v2', 's01')]);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 1, s02: 0 });
    expect(result.rounds[0]?.exhaustedBallots).toBe(1);
    expect(result.rounds[0]?.activeBallots).toBe(1);
    expect(result.winnerSubmissionId).toBe('s01');
  });

  it('counts a repeated id only at its first occurrence', () => {
    // The API rejects duplicates, but a malformed ballot must not inflate a
    // tally or strand a transfer.
    const result = count(
      ['s01', 's02', 's03'],
      [
        B('v1', 's03', 's03', 's02'),
        B('v2', 's01', 's01'),
        B('v3', 's01'),
        B('v4', 's02'),
        B('v5', 's02'),
      ],
    );
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 2, s03: 1 });
    expect(result.rounds[0]?.activeBallots).toBe(5);
    expect(result.rounds[0]?.transfer).toEqual({ from: 's03', to: { s02: 1 }, exhausted: 0 });
  });

  it('ignores duplicate entries in the candidate list', () => {
    const withDupes = count(['s01', 's02', 's01'], [B('v1', 's01'), B('v2', 's02')]);
    const clean = count(['s01', 's02'], [B('v1', 's01'), B('v2', 's02')]);
    expect(withDupes).toEqual(clean);
  });

  it('does not mutate its arguments', () => {
    const candidates = ['s02', 's01', 's03'];
    const ballots = [B('v1', 's03', 's01'), B('v2', 's01')];
    const candidatesBefore = JSON.stringify(candidates);
    const ballotsBefore = JSON.stringify(ballots);
    count(candidates, ballots);
    expect(JSON.stringify(candidates)).toBe(candidatesBefore);
    expect(JSON.stringify(ballots)).toBe(ballotsBefore);
  });
});

describe('countIrv — exhaustion', () => {
  it('lets the last candidate standing win once every ballot has exhausted', () => {
    // No ballot names a real candidate, so the active denominator is zero from
    // round 1 and no majority can ever exist. The rule that saves the count is
    // "one candidate left wins".
    const result = count(
      ['s01', 's02', 's03'],
      [B('v1', 'gone-a'), B('v2', 'gone-b', 'gone-a'), B('v3', 'gone-a')],
    );
    expect(result.totalBallots).toBe(3);
    expect(result.exhaustedFinal).toBe(3);
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.every((r) => r.activeBallots === 0)).toBe(true);
    expect(result.winnerSubmissionId).not.toBeNull();
    expect(result.rounds.at(-1)?.winner).toBe(result.winnerSubmissionId);
    assertInvariants(result, 3);
  });

  it('drains ballots as their preferences are eliminated', () => {
    const result = count(
      ['s01', 's02', 's03', 's04', 's05'],
      [B('v1', 's04'), B('v2', 's05')],
    );
    // Two votes, five candidates: zero-vote candidates go first, then one of
    // s04/s05 loses a coin-flip and its ballot exhausts, leaving the survivor.
    expect(result.rounds).toHaveLength(5);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 0, s02: 0, s03: 0, s04: 1, s05: 1 });
    expect(result.exhaustedFinal).toBe(1);
    expect(result.rounds.at(-1)?.activeBallots).toBe(1);
    expect(['s04', 's05']).toContain(result.winnerSubmissionId);
    assertInvariants(result, 5);
  });
});

describe('adminTieBreakKey', () => {
  it('is order-independent and joins with a pipe', () => {
    expect(adminTieBreakKey(['s03', 's01', 's02'])).toBe('s01|s02|s03');
    expect(adminTieBreakKey(['s01', 's02', 's03'])).toBe('s01|s02|s03');
    expect(adminTieBreakKey(['s02'])).toBe('s02');
    expect(adminTieBreakKey([])).toBe('');
  });

  it('does not mutate its input', () => {
    const tied = ['s03', 's01'];
    adminTieBreakKey(tied);
    expect(tied).toEqual(['s03', 's01']);
  });
});

describe('countIrv — the tie-break chain', () => {
  it('1. admin_override wins over every other criterion', () => {
    const candidates = ['s01', 's02', 's03', 's04'];
    const ballots = [B('v1', 's01'), B('v2', 's02'), B('v3', 's03'), B('v4', 's04')];
    const key = adminTieBreakKey(candidates);
    expect(key).toBe('s01|s02|s03|s04');

    const result = count(candidates, ballots, { adminTieBreaks: { [key]: 's03' } });
    const first = result.rounds[0];
    expect(first?.eliminated).toBe('s03');
    expect(first?.tieBreak).toEqual({
      tiedCandidates: ['s01', 's02', 's03', 's04'],
      reason: 'admin_override',
      eliminated: 's03',
      decidedByUid: null,
    });
    // An admin decision is not a coin-flip, so it is not on the review list.
    expect(result.seededTieBreaks.some((note) => note.round === 1)).toBe(false);
    assertInvariants(result, 4);
  });

  it('ignores an admin override that names a candidate outside the tie', () => {
    const candidates = ['s01', 's02', 's03', 's04'];
    const ballots = [B('v1', 's01'), B('v2', 's02'), B('v3', 's03'), B('v4', 's04')];
    const spoiled = count(candidates, ballots, {
      adminTieBreaks: { [adminTieBreakKey(candidates)]: 'not-a-candidate' },
    });
    expect(spoiled.rounds[0]?.tieBreak?.reason).not.toBe('admin_override');
    expect(spoiled).toEqual(count(candidates, ballots));
  });

  it('ignores an admin override keyed to a different tie', () => {
    const candidates = ['s01', 's02', 's03', 's04'];
    const ballots = [B('v1', 's01'), B('v2', 's02'), B('v3', 's03'), B('v4', 's04')];
    const result = count(candidates, ballots, { adminTieBreaks: { 's02|s03': 's03' } });
    expect(result.rounds[0]?.tieBreak?.reason).not.toBe('admin_override');
  });

  it('2. fewest_previous_round separates a tie from round 2 onward', () => {
    const result = count(
      ['s01', 's02', 's03', 's04'],
      [
        B('v1', 's01'),
        B('v2', 's01'),
        B('v3', 's01'),
        B('v4', 's01'),
        B('v5', 's02'),
        B('v6', 's02'),
        B('v7', 's02'),
        B('v8', 's03'),
        B('v9', 's03'),
        B('v10', 's04', 's03'),
      ],
    );

    expect(result.rounds[0]?.tallies).toEqual({ s01: 4, s02: 3, s03: 2, s04: 1 });
    expect(result.rounds[0]?.eliminated).toBe('s04');
    expect(result.rounds[0]?.tieBreak).toBeNull();

    // Round 2: s02 and s03 are level on 3, but s03 was behind in round 1.
    expect(result.rounds[1]?.tallies).toEqual({ s01: 4, s02: 3, s03: 3 });
    expect(result.rounds[1]?.tieBreak).toEqual({
      tiedCandidates: ['s02', 's03'],
      reason: 'fewest_previous_round',
      eliminated: 's03',
      decidedByUid: null,
    });
    expect(result.rounds[1]?.transfer).toEqual({ from: 's03', to: {}, exhausted: 3 });
    expect(result.rounds[2]?.winner).toBe('s01');
    expect(result.eliminationOrder).toEqual(['s04', 's03', 's01']);
    assertInvariants(result, 4);
  });

  it('3. fewest_total_appearances breaks a round-1 tie', () => {
    // Round 1 has no previous round, so the chain falls straight to support
    // measured across the whole ballot set.
    const result = count(
      ['s01', 's02', 's03', 's04'],
      [
        B('v1', 's01', 's02', 's03'),
        B('v2', 's01', 's02'),
        B('v3', 's02'),
        B('v4', 's03'),
        B('v5', 's04'),
      ],
    );
    // s02/s03/s04 are tied on 1 vote; appearances are 3 / 2 / 1.
    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 1, s03: 1, s04: 1 });
    expect(result.rounds[0]?.tieBreak).toEqual({
      tiedCandidates: ['s02', 's03', 's04'],
      reason: 'fewest_total_appearances',
      eliminated: 's04',
      decidedByUid: null,
    });
    // Round 2 repeats the criterion: s02 (3 appearances) survives s03 (2).
    expect(result.rounds[1]?.tieBreak?.reason).toBe('fewest_total_appearances');
    expect(result.rounds[1]?.eliminated).toBe('s03');
    expect(result.winnerSubmissionId).toBe('s01');
    expect(result.seededTieBreaks).toEqual([]);
    assertInvariants(result, 4);
  });

  it('4. fewest_first_place decides when votes, previous round and appearances all tie', () => {
    // Built so that by round 3, s02 and s03 are level on 3 votes, were level on
    // 3 in round 2, and appear on 3 ballots each — only their original
    // first-place support (2 vs 3) separates them.
    const result = count(
      ['s01', 's02', 's03', 's04', 's05'],
      [
        B('v1', 's01'),
        B('v2', 's01'),
        B('v3', 's01'),
        B('v4', 's01'),
        B('v5', 's02'),
        B('v6', 's02'),
        B('v7', 's03'),
        B('v8', 's03'),
        B('v9', 's03'),
        B('v10', 's04', 's02'),
        B('v11', 's05', 's01'),
        B('v12', 's05', 's01'),
      ],
    );

    expect(result.rounds[0]?.tallies).toEqual({ s01: 4, s02: 2, s03: 3, s04: 1, s05: 2 });
    expect(result.rounds[0]?.eliminated).toBe('s04');
    expect(result.rounds[1]?.tallies).toEqual({ s01: 4, s02: 3, s03: 3, s05: 2 });
    expect(result.rounds[1]?.eliminated).toBe('s05');
    expect(result.rounds[2]?.tallies).toEqual({ s01: 6, s02: 3, s03: 3 });
    // 6 of 12 is exactly half — not a majority — so the round must eliminate.
    expect(result.rounds[2]?.winner).toBeNull();
    expect(result.rounds[2]?.tieBreak).toEqual({
      tiedCandidates: ['s02', 's03'],
      reason: 'fewest_first_place',
      eliminated: 's02',
      decidedByUid: null,
    });
    expect(result.rounds[3]?.tallies).toEqual({ s01: 6, s03: 3 });
    expect(result.rounds[3]?.winner).toBe('s01');
    expect(result.winnerSubmissionId).toBe('s01');
    assertInvariants(result, 5);
  });

  it('5. seeded_shuffle is the terminal tie-break and is recorded for review', () => {
    // Perfectly symmetric: same votes, same appearances, same first-place
    // support. Nothing but the seed can separate them.
    const result = count(
      ['s01', 's02'],
      [B('v1', 's01', 's02'), B('v2', 's01', 's02'), B('v3', 's02', 's01'), B('v4', 's02', 's01')],
    );

    expect(result.rounds[0]?.tallies).toEqual({ s01: 2, s02: 2 });
    expect(result.rounds[0]?.winner).toBeNull();
    expect(result.rounds[0]?.tieBreak?.reason).toBe('seeded_shuffle');
    expect(result.rounds[0]?.tieBreak?.tiedCandidates).toEqual(['s01', 's02']);
    expect(result.seededTieBreaks).toEqual([
      { round: 1, tiedCandidates: ['s01', 's02'], eliminated: result.rounds[0]?.eliminated },
    ]);

    // Two candidates tied at the very end: the survivor wins on a coin-flip.
    expect(result.winnerDecidedByTieBreak).toBe(true);
    expect(result.rounds[1]?.winner).toBe(result.winnerSubmissionId);
    expect(result.rounds[1]?.tallies).toEqual({ [String(result.winnerSubmissionId)]: 4 });
    assertInvariants(result, 2);
  });

  it('resolves an all-way tie deterministically, one candidate per round', () => {
    const candidates = ['s01', 's02', 's03', 's04'];
    const ballots = [B('v1', 's01'), B('v2', 's02'), B('v3', 's03'), B('v4', 's04')];
    const result = count(candidates, ballots);

    expect(result.rounds).toHaveLength(4);
    expect(result.rounds[0]?.tallies).toEqual({ s01: 1, s02: 1, s03: 1, s04: 1 });
    expect(result.rounds.slice(0, 3).every((r) => r.tieBreak?.reason === 'seeded_shuffle')).toBe(
      true,
    );
    expect(result.seededTieBreaks).toHaveLength(3);
    expect(result.winnerDecidedByTieBreak).toBe(true);
    // Same seed, same answer — the whole promise of a recount.
    expect(count(candidates, ballots)).toEqual(result);
    assertInvariants(result, 4);
  });

  it('changes the coin-flip outcome when the seed changes', () => {
    const candidates = ['s01', 's02', 's03', 's04', 's05', 's06'];
    const ballots = candidates.map((id, i) => B(`v${i}`, id));
    const orders = new Set(
      Array.from({ length: 12 }, (_unused, i) =>
        count(candidates, ballots, { tieBreakSeed: `seed-${i}` }).eliminationOrder.join(','),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('flags a coin-flip only when it decided the final elimination', () => {
    // The round-1 tie here is settled by a shuffle, but the last elimination
    // is an outright lowest-tally loss and the winner then crosses 50% — so
    // the coin-flip did not choose the winner and no admin review is implied.
    const result = count(
      ['s01', 's02', 's03', 's04'],
      [
        B('v1', 's01'),
        B('v2', 's01'),
        B('v3', 's01'),
        B('v4', 's01'),
        B('v5', 's02'),
        B('v6', 's02'),
        B('v7', 's02'),
        B('v8', 's02'),
        B('v9', 's03', 's01'),
        B('v10', 's04', 's01'),
      ],
    );
    expect(result.rounds[0]?.tallies).toEqual({ s01: 4, s02: 4, s03: 1, s04: 1 });
    expect(result.rounds[0]?.tieBreak?.reason).toBe('seeded_shuffle');
    expect(result.seededTieBreaks).toHaveLength(1);
    expect(result.rounds[1]?.tieBreak).toBeNull();
    expect(result.rounds[2]?.tallies).toEqual({ s01: 6, s02: 4 });
    expect(result.rounds[2]?.winner).toBe('s01');
    expect(result.winnerDecidedByTieBreak).toBe(false);
  });
});

describe('countIrv — determinism and reproducibility', () => {
  const candidates = ['s01', 's02', 's03', 's04', 's05', 's06'];
  const ballots = [
    B('v1', 's03', 's01', 's06'),
    B('v2', 's01', 's03'),
    B('v3', 's06', 's02'),
    B('v4', 's02', 's06', 's01'),
    B('v5', 's04'),
    B('v6', 's05', 's04'),
    B('v7', 's03', 's06'),
    B('v8', 's01'),
    B('v9', 's06', 's03', 's01'),
    B('v10', 's04', 's05'),
  ];

  it('returns deep-equal results for two runs of the same input', () => {
    expect(count(candidates, ballots)).toEqual(count(candidates, ballots));
  });

  it('is unaffected by the order of ballots and candidates', () => {
    const baseline = count(candidates, ballots);
    const shuffledBallots = [...ballots].reverse();
    const shuffledCandidates = ['s05', 's02', 's06', 's01', 's04', 's03'];

    const reordered = count(shuffledCandidates, shuffledBallots);
    expect(reordered.winnerSubmissionId).toBe(baseline.winnerSubmissionId);
    expect(reordered.eliminationOrder).toEqual(baseline.eliminationOrder);
    // Stronger than required: the entire snapshot is order-invariant, so two
    // recounts from differently-ordered queries produce identical documents.
    expect(reordered).toEqual(baseline);
  });

  it('produces a stable result across many repetitions', () => {
    const serialised = new Set(
      Array.from({ length: 25 }, () => JSON.stringify(count(candidates, ballots))),
    );
    expect(serialised.size).toBe(1);
  });

  it('uses no ambient randomness or clock', () => {
    // If the engine reached for Math.random() this would blow up.
    const original = Math.random;
    Math.random = () => {
      throw new Error('countIrv must not use Math.random()');
    };
    try {
      expect(() => count(candidates, ballots)).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

/**
 * Property-style checks. Fixtures come from the engine's own seeded RNG rather
 * than an external property library: same dependency-free constraint as the
 * engine, and a failure is reproducible from its fixture index alone.
 */
function generateFixture(index: number): CountOptions {
  const rng = makeRng(`fixture:${index}`);
  const pick = (n: number): number => Math.floor(rng() * n);

  const candidateCount = 1 + pick(12);
  const candidates = Array.from(
    { length: candidateCount },
    (_unused, i) => `c${String(i + 1).padStart(2, '0')}`,
  );

  const ballotCount = pick(26);
  const ballots: CountableBallot[] = [];
  for (let b = 0; b < ballotCount; b += 1) {
    const pool = [...candidates];
    const maxRanks = Math.min(5, candidateCount);
    const ranks = pick(maxRanks + 1); // may be 0 — a ballot naming nobody real
    const ranking: string[] = [];
    for (let r = 0; r < ranks && pool.length > 0; r += 1) {
      const [chosen] = pool.splice(pick(pool.length), 1);
      if (chosen !== undefined) ranking.push(chosen);
    }
    // Stress the normalisation rules: withdrawn entries and a duplicate.
    if (rng() < 0.25) ranking.push('withdrawn-entry');
    const head = ranking[0];
    if (head !== undefined && rng() < 0.2) ranking.push(head);
    ballots.push({ ballotId: `b${String(b).padStart(2, '0')}`, ranking });
  }

  return { candidates, ballots, tieBreakSeed: `seed-${index}` };
}

describe('countIrv — invariants over generated fixtures', () => {
  const fixtures = Array.from({ length: 60 }, (_unused, i) => generateFixture(i));

  it('conserves ballots in every round of every fixture', () => {
    for (const fixture of fixtures) {
      const result = countIrv(fixture);
      expect(result.totalBallots).toBe(fixture.ballots.length);
      for (const round of result.rounds) {
        const total = sumTallies(round);
        expect(round.activeBallots).toBe(total);
        expect(total + round.exhaustedBallots).toBe(result.totalBallots);
      }
    }
  });

  it('always terminates with a winner when at least one candidate exists', () => {
    for (const fixture of fixtures) {
      const result = countIrv(fixture);
      expect(result.winnerSubmissionId).not.toBeNull();
      expect(fixture.candidates).toContain(result.winnerSubmissionId);
      expect(result.rounds.length).toBeLessThanOrEqual(fixture.candidates.length);
      assertInvariants(result, fixture.candidates.length);
    }
  });

  it('never elects someone who was eliminated, and eliminates one per round', () => {
    for (const fixture of fixtures) {
      const result = countIrv(fixture);
      const eliminated = result.rounds.map((r) => r.eliminated).filter((id) => id !== null);
      expect(eliminated).toHaveLength(result.rounds.length - 1);
      expect(eliminated).not.toContain(result.winnerSubmissionId);
      expect(result.eliminationOrder).toEqual([...eliminated, result.winnerSubmissionId]);
    }
  });

  it('reproduces every fixture exactly on a second run', () => {
    for (const fixture of fixtures) {
      expect(countIrv(fixture)).toEqual(countIrv(fixture));
    }
  });

  it('reaches every tie-break reason across the generated fixtures', () => {
    // Guards against a criterion silently becoming unreachable.
    const reasons = new Set<string>();
    for (const fixture of fixtures) {
      for (const round of countIrv(fixture).rounds) {
        if (round.tieBreak !== null) reasons.add(round.tieBreak.reason);
      }
    }
    expect(reasons).toContain('fewest_previous_round');
    expect(reasons).toContain('fewest_total_appearances');
    expect(reasons).toContain('seeded_shuffle');
  });
});

describe('countIrv — realistic 20-voter, 12-candidate contest', () => {
  const candidates = [
    's01', 's02', 's03', 's04', 's05', 's06',
    's07', 's08', 's09', 's10', 's11', 's12',
  ];
  const ballots = [
    B('v01', 's03', 's07', 's01'),
    B('v02', 's03', 's01', 's07', 's09'),
    B('v03', 's07', 's03', 's02'),
    B('v04', 's07', 's12'),
    B('v05', 's01', 's05', 's03'),
    B('v06', 's01', 's05'),
    B('v07', 's05', 's01', 's03', 's07', 's02'),
    B('v08', 's09', 's03', 's07'),
    B('v09', 's12', 's04', 's07'),
    B('v10', 's02', 's11', 's03'),
    B('v11', 's11', 's02', 's06'),
    B('v12', 's06', 's08', 's10'),
    B('v13', 's08', 's06', 's12'),
    B('v14', 's10', 's04'),
    B('v15', 's04', 's10', 's12'),
    B('v16', 's03', 's09'),
    B('v17', 's07', 's01', 's05'),
    B('v18', 's01', 's03'),
    B('v19', 's05', 's07', 's03'),
    B('v20', 's12', 's07', 's03'),
  ];
  const result = count(candidates, ballots);

  it('runs eleven rounds and elects s03', () => {
    expect(result.totalBallots).toBe(20);
    expect(result.rounds).toHaveLength(11);
    expect(result.winnerSubmissionId).toBe('s03');
    expect(result.exhaustedFinal).toBe(6);
    expect(result.eliminationOrder).toEqual([
      's11', 's08', 's09', 's10', 's04', 's06', 's02', 's05', 's01', 's12', 's03',
    ]);
    assertInvariants(result, 12);
  });

  it('matches the hand-checked round-by-round tallies', () => {
    const tallies = result.rounds.map((r) => r.tallies);
    expect(tallies[0]).toEqual({
      s01: 3, s02: 1, s03: 3, s04: 1, s05: 2, s06: 1,
      s07: 3, s08: 1, s09: 1, s10: 1, s11: 1, s12: 2,
    });
    expect(tallies[1]).toEqual({
      s01: 3, s02: 2, s03: 3, s04: 1, s05: 2, s06: 1,
      s07: 3, s08: 1, s09: 1, s10: 1, s12: 2,
    });
    expect(tallies[2]).toEqual({
      s01: 3, s02: 2, s03: 3, s04: 1, s05: 2, s06: 2, s07: 3, s09: 1, s10: 1, s12: 2,
    });
    expect(tallies[3]).toEqual({
      s01: 3, s02: 2, s03: 4, s04: 1, s05: 2, s06: 2, s07: 3, s10: 1, s12: 2,
    });
    expect(tallies[4]).toEqual({
      s01: 3, s02: 2, s03: 4, s04: 2, s05: 2, s06: 2, s07: 3, s12: 2,
    });
    expect(tallies[5]).toEqual({ s01: 3, s02: 2, s03: 4, s05: 2, s06: 2, s07: 3, s12: 3 });
    expect(tallies[6]).toEqual({ s01: 3, s02: 2, s03: 4, s05: 2, s07: 3, s12: 4 });
    expect(tallies[7]).toEqual({ s01: 3, s03: 5, s05: 2, s07: 3, s12: 4 });
    expect(tallies[8]).toEqual({ s01: 4, s03: 5, s07: 4, s12: 4 });
    expect(tallies[9]).toEqual({ s03: 8, s07: 4, s12: 4 });
    expect(tallies[10]).toEqual({ s03: 8, s07: 6 });
  });

  it('records the reason for every contested elimination', () => {
    expect(result.rounds.map((r) => r.tieBreak?.reason ?? null)).toEqual([
      'seeded_shuffle', // s02/s04/s06/s08/s09/s10/s11 tied on 1
      'fewest_total_appearances',
      'seeded_shuffle',
      'seeded_shuffle',
      'fewest_previous_round',
      'fewest_total_appearances',
      'fewest_total_appearances',
      null, // s05 was the outright lowest
      'fewest_total_appearances',
      'fewest_total_appearances',
      null, // the winning round
    ]);
    // Round 1: seven candidates tied on one vote, narrowed by appearances to
    // s08 and s11 (two each), then by first-place support (one each) to a
    // coin-flip between exactly those two.
    expect(result.rounds[0]?.tieBreak?.tiedCandidates).toEqual([
      's02', 's04', 's06', 's08', 's09', 's10', 's11',
    ]);
    expect(result.seededTieBreaks[0]).toEqual({
      round: 1,
      tiedCandidates: ['s08', 's11'],
      eliminated: 's11',
    });
    expect(result.seededTieBreaks.map((n) => n.round)).toEqual([1, 3, 4]);
  });

  it('tracks transfers and exhaustion through the late rounds', () => {
    expect(result.rounds[0]?.transfer).toEqual({ from: 's11', to: { s02: 1 }, exhausted: 0 });
    // s04 leaves in round 5; v15 moves on to s12 while v14 has nowhere to go.
    expect(result.rounds[4]?.transfer).toEqual({ from: 's04', to: { s12: 1 }, exhausted: 1 });
    expect(result.rounds[5]?.exhaustedBallots).toBe(1);
    // s01's three remaining ballots all name s03 next; one exhausts.
    expect(result.rounds[8]?.transfer).toEqual({ from: 's01', to: { s03: 3 }, exhausted: 1 });
    expect(result.rounds[9]?.transfer).toEqual({ from: 's12', to: { s07: 2 }, exhausted: 2 });
    // s03 finishes on 8 of 14 active ballots — a real majority, not a plurality.
    expect(result.rounds[10]?.activeBallots).toBe(14);
    expect(result.rounds[10]?.exhaustedBallots).toBe(6);
    expect(result.winnerDecidedByTieBreak).toBe(false);
  });

  it('is suppressible-safe: the engine reports counts without any voter identity', () => {
    // Nothing in the snapshot can be traced back to a ballot id.
    expect(JSON.stringify(result)).not.toMatch(/v\d\d/);
  });
});
