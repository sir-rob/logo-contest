import type {
  CountOptions,
  CountableBallot,
  Round,
  TieBreak,
  TieBreakReason,
  Transfer,
} from '@contest/shared';

import { seededShuffle } from './rng.js';

/**
 * Instant-runoff counting engine.
 *
 * Pure and dependency-free by design: no clock, no randomness beyond the
 * contest's stored seed, no I/O, no mutation of the caller's arrays. Given the
 * same `CountOptions` it returns byte-identical output forever, which is what
 * makes a published result auditable ("recount it yourself and get this").
 */

/** A tie only the seeded coin-flip could settle — the admin-override shortlist. */
export interface SeededTieBreakNote {
  round: number;
  /**
   * The candidates still tied when the shuffle ran, i.e. after every
   * deterministic criterion had been applied and failed to separate them.
   */
  tiedCandidates: string[];
  eliminated: string;
}

export interface IrvResult {
  winnerSubmissionId: string | null;
  rounds: Round[];
  totalBallots: number;
  exhaustedFinal: number;
  /** Candidates in elimination order; LAST entry is the winner. */
  eliminationOrder: string[];
  /** Ties that only the seeded coin-flip settled — candidates for admin override. */
  seededTieBreaks: SeededTieBreakNote[];
  /** True when the final, winner-deciding elimination was settled by seeded shuffle. */
  winnerDecidedByTieBreak: boolean;
}

/**
 * Canonical key for `CountOptions.adminTieBreaks`: tied ids sorted ascending,
 * joined by '|'. WHY canonical: the admin UI and the engine must agree on the
 * key without agreeing on an ordering, and a tie is a set, not a list.
 */
export function adminTieBreakKey(tied: readonly string[]): string {
  return [...tied].sort(compareIds).join('|');
}

/** A list proven non-empty at the type level, so tie-breaking never needs `!`. */
type NonEmptyIds = readonly [string, ...string[]];

/** Locale-independent ascending comparison — submission ids are opaque strings. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

interface PreparedBallot {
  readonly ballotId: string;
  /**
   * The ranking reduced to ids that are actually candidates, first occurrence
   * of each kept. Everything downstream reads this, never the raw ranking.
   */
  readonly ranking: readonly string[];
}

/**
 * Normalises ballots once, up front.
 *
 * Two rules live here rather than in the round loop:
 *  - An id that is not a candidate (withdrawn or disqualified after the ballot
 *    was cast) is SKIPPED, not treated as a stopping point. Dropping it here
 *    means the round loop cannot accidentally exhaust a ballot that still has
 *    a valid later preference.
 *  - A repeated id counts only at its first occurrence. The API rejects
 *    duplicates, but the engine decides a real contest and must not produce a
 *    nonsense tally if a malformed ballot ever reaches it.
 */
function prepareBallots(
  ballots: readonly CountableBallot[],
  candidates: ReadonlySet<string>,
): PreparedBallot[] {
  return ballots.map((ballot) => {
    const seen = new Set<string>();
    const ranking: string[] = [];
    for (const id of ballot.ranking) {
      if (!candidates.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ranking.push(id);
    }
    return { ballotId: ballot.ballotId, ranking };
  });
}

/** The candidate this ballot currently counts for, or null if exhausted. */
function currentPreference(
  ballot: PreparedBallot,
  standing: ReadonlySet<string>,
): string | null {
  for (const id of ballot.ranking) {
    if (standing.has(id)) return id;
  }
  return null;
}

/** Narrows a tied pool to those sharing the minimum score. Never empties it. */
function narrowByMin(
  pool: NonEmptyIds,
  score: (id: string) => number,
): NonEmptyIds {
  const head = pool[0];
  let min = score(head);
  for (const id of pool) {
    const value = score(id);
    if (value < min) min = value;
  }
  const kept = pool.filter((id) => score(id) === min);
  // `?? head` is unreachable (the minimum is attained by construction) but
  // keeps the non-empty guarantee without a non-null assertion.
  return [kept[0] ?? head, ...kept.slice(1)];
}

interface TieContext {
  readonly roundNumber: number;
  /** Null on round 1 — there is no previous round to compare against. */
  readonly previousTallies: ReadonlyMap<string, number> | null;
  readonly appearances: ReadonlyMap<string, number>;
  readonly firstPlace: ReadonlyMap<string, number>;
  readonly adminTieBreaks: Record<string, string>;
  readonly seed: string;
}

interface TieOutcome {
  readonly eliminated: string;
  readonly reason: TieBreakReason;
  /** Set only for `seeded_shuffle`: the pool that reached the coin-flip. */
  readonly shuffledPool: string[] | null;
}

/**
 * The tie-break chain, applied in order. Each step that fails to produce a
 * unique minimum NARROWS the pool to the candidates still tied on that
 * criterion before the next step runs, so later criteria only ever decide
 * between candidates that genuinely could not be separated earlier.
 *
 * The chain is total: `seeded_shuffle` is terminal and always answers, so this
 * function cannot throw and the count cannot stall on an unbreakable tie.
 */
function resolveTie(tied: NonEmptyIds, ctx: TieContext): TieOutcome {
  // 1. admin_override — a human already answered this exact tie.
  const override = ctx.adminTieBreaks[adminTieBreakKey(tied)];
  if (override !== undefined && tied.includes(override)) {
    return { eliminated: override, reason: 'admin_override', shuffledPool: null };
  }

  let pool: NonEmptyIds = tied;

  // 2. fewest_previous_round — skipped on round 1, which has no predecessor.
  const previous = ctx.previousTallies;
  if (previous !== null) {
    const narrowed = narrowByMin(pool, (id) => previous.get(id) ?? 0);
    if (narrowed.length === 1) {
      return {
        eliminated: narrowed[0],
        reason: 'fewest_previous_round',
        shuffledPool: null,
      };
    }
    pool = narrowed;
  }

  // 3. fewest_total_appearances — support measured across every original
  //    ballot at any rank, independent of who is still standing.
  const byAppearances = narrowByMin(pool, (id) => ctx.appearances.get(id) ?? 0);
  if (byAppearances.length === 1) {
    return {
      eliminated: byAppearances[0],
      reason: 'fewest_total_appearances',
      shuffledPool: null,
    };
  }
  pool = byAppearances;

  // 4. fewest_first_place — original rank-1 support, not this round's tally.
  const byFirstPlace = narrowByMin(pool, (id) => ctx.firstPlace.get(id) ?? 0);
  if (byFirstPlace.length === 1) {
    return {
      eliminated: byFirstPlace[0],
      reason: 'fewest_first_place',
      shuffledPool: null,
    };
  }
  pool = byFirstPlace;

  // 5. seeded_shuffle — terminal. Reproducible from the contest's stored seed.
  const shuffled = seededShuffle(pool, ctx.seed);
  return {
    eliminated: shuffled[0] ?? pool[0],
    reason: 'seeded_shuffle',
    shuffledPool: [...pool].sort(compareIds),
  };
}

export function countIrv(options: CountOptions): IrvResult {
  const adminTieBreaks = options.adminTieBreaks ?? {};

  // Canonical candidate order: de-duplicated and sorted ascending. WHY: it
  // makes every downstream iteration (tally key order, minimum search, tied
  // pools, transfer key order) independent of how the caller happened to order
  // its inputs, so a recount from a differently-ordered query is identical.
  const canonical = [...new Set(options.candidates)].sort(compareIds);
  const candidateSet = new Set(canonical);

  const prepared = prepareBallots(options.ballots, candidateSet);
  const totalBallots = prepared.length;

  // Computed once from the original ballots — tie-break criteria 3 and 4 are
  // deliberately about the whole election, not the current round.
  const appearances = new Map<string, number>();
  const firstPlace = new Map<string, number>();
  for (const id of canonical) {
    appearances.set(id, 0);
    firstPlace.set(id, 0);
  }
  for (const ballot of prepared) {
    for (const id of ballot.ranking) {
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
    }
    // The ballot's first *valid* preference is its first place: an unknown id
    // at position 1 was never a choice between real candidates.
    const top = ballot.ranking[0];
    if (top !== undefined) firstPlace.set(top, (firstPlace.get(top) ?? 0) + 1);
  }

  const rounds: Round[] = [];
  const eliminationOrder: string[] = [];
  const seededTieBreaks: SeededTieBreakNote[] = [];

  let standing = canonical;
  let winner: string | null = null;
  let previousTallies: ReadonlyMap<string, number> | null = null;
  // With no candidates at all, every ballot is by definition exhausted.
  let exhaustedFinal = totalBallots;

  while (standing.length > 0) {
    const standingSet = new Set(standing);

    // Rule: tallies are the votes held at the START of this round's count, and
    // include still-standing candidates sitting on zero.
    const tallies = new Map<string, number>();
    for (const id of standing) tallies.set(id, 0);

    let activeBallots = 0;
    for (const ballot of prepared) {
      const choice = currentPreference(ballot, standingSet);
      if (choice === null) continue;
      tallies.set(choice, (tallies.get(choice) ?? 0) + 1);
      activeBallots += 1;
    }
    // Exhaustion is monotonic (the standing set only shrinks), so the cumulative
    // count is just everyone not currently counting for someone.
    const exhaustedBallots = totalBallots - activeBallots;
    exhaustedFinal = exhaustedBallots;

    const round: Round = {
      round: rounds.length + 1,
      tallies: Object.fromEntries(tallies),
      activeBallots,
      exhaustedBallots,
      eliminated: null,
      transfer: null,
      tieBreak: null,
      winner: null,
    };
    rounds.push(round);

    // Majority is of ACTIVE ballots, not of all ballots cast: exhausted ballots
    // leave the denominator, otherwise a low-turnout runoff could never finish.
    // `*2 >` avoids a floating-point comparison against activeBallots / 2.
    const majorityWinner = standing.find((id) => (tallies.get(id) ?? 0) * 2 > activeBallots);
    const lastStanding = standing.length === 1 ? standing[0] : undefined;
    const decided = majorityWinner ?? lastStanding;
    if (decided !== undefined) {
      winner = decided;
      round.winner = decided;
      eliminationOrder.push(decided);
      break;
    }

    // No majority. Eliminate exactly one candidate: the fewest votes, with the
    // tie-break chain deciding when the tally alone does not.
    //
    // Note this also covers the two-candidate dead-even split: with two
    // standing and no strict majority the tallies must be equal, so the tie
    // chain runs and the survivor wins on the next round.
    let minVotes = Number.POSITIVE_INFINITY;
    for (const id of standing) {
      const votes = tallies.get(id) ?? 0;
      if (votes < minVotes) minVotes = votes;
    }
    const tiedList = standing.filter((id) => (tallies.get(id) ?? 0) === minVotes);
    const tiedHead = tiedList[0];
    // Unreachable: `standing` is non-empty, so the minimum is attained.
    if (tiedHead === undefined) break;
    const tied: NonEmptyIds = [tiedHead, ...tiedList.slice(1)];

    let eliminated: string;
    if (tied.length === 1) {
      eliminated = tied[0];
    } else {
      const outcome = resolveTie(tied, {
        roundNumber: round.round,
        previousTallies,
        appearances,
        firstPlace,
        adminTieBreaks,
        seed: options.tieBreakSeed,
      });
      eliminated = outcome.eliminated;

      const tieBreak: TieBreak = {
        // The candidates that were level on votes — the audit story is "these
        // were tied, and here is the rule that separated them".
        tiedCandidates: [...tied],
        reason: outcome.reason,
        eliminated,
        // Always null here: the engine is anonymous and does not know who the
        // admin was. The persisting route stamps the uid.
        decidedByUid: null,
      };
      round.tieBreak = tieBreak;

      if (outcome.shuffledPool !== null) {
        seededTieBreaks.push({
          round: round.round,
          tiedCandidates: outcome.shuffledPool,
          eliminated,
        });
      }
    }

    const nextStanding = standing.filter((id) => id !== eliminated);
    const nextStandingSet = new Set(nextStanding);

    // Transfer: only ballots currently held by the eliminated candidate move.
    const movedTo = new Map<string, number>();
    let transferExhausted = 0;
    for (const ballot of prepared) {
      if (currentPreference(ballot, standingSet) !== eliminated) continue;
      const next = currentPreference(ballot, nextStandingSet);
      if (next === null) {
        transferExhausted += 1;
      } else {
        movedTo.set(next, (movedTo.get(next) ?? 0) + 1);
      }
    }
    // Emitted in canonical order, and only for recipients that actually gained
    // ballots — a zero entry would imply a transfer that did not happen.
    const to: Record<string, number> = {};
    for (const id of nextStanding) {
      const moved = movedTo.get(id);
      if (moved !== undefined && moved > 0) to[id] = moved;
    }
    const transfer: Transfer = { from: eliminated, to, exhausted: transferExhausted };

    round.eliminated = eliminated;
    round.transfer = transfer;
    eliminationOrder.push(eliminated);

    previousTallies = tallies;
    standing = nextStanding;
  }

  // The winner-deciding elimination is the last one performed: counting stops
  // on the round immediately after it. Only a coin-flip counts as "decided by
  // tie-break" — the deterministic criteria are real rules, whereas a shuffle
  // is arbitrary and is exactly what an admin may want to override.
  let winnerDecidedByTieBreak = false;
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const round = rounds[i];
    if (round === undefined || round.eliminated === null) continue;
    winnerDecidedByTieBreak = winner !== null && round.tieBreak?.reason === 'seeded_shuffle';
    break;
  }

  return {
    winnerSubmissionId: winner,
    rounds,
    totalBallots,
    exhaustedFinal,
    eliminationOrder,
    seededTieBreaks,
    winnerDecidedByTieBreak,
  };
}
