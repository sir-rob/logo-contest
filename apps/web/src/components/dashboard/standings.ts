/**
 * Reading the live IRV projection.
 *
 * `DashboardDto.standings` is the output of a full instant-runoff count run
 * against the ballots cast so far — NOT a first-choice tally. Two consequences
 * drive everything in this file:
 *
 *  1. An eliminated entry's `votes` is frozen at the round it went out. Its
 *     ballots have already moved on to someone else, so summing every row
 *     would double-count.
 *  2. A ballot whose ranked choices are all eliminated is *exhausted*: it
 *     stops counting toward anyone. So the denominator for "a majority" is
 *     the ballots still live, not every ballot ever cast.
 *
 * The DTO has no `exhaustedBallots` field, but it is recoverable: in any IRV
 * round each live ballot sits with exactly one continuing candidate, so the
 * continuing candidates' votes sum to the live-ballot count, and whatever is
 * left of `ballotsCast` ran out of choices. We only report that number when
 * the arithmetic is self-consistent — a wrong exhausted count is worse than
 * none, because it is exactly the figure a sceptic will check.
 */

import type { StandingEntryDto } from '@contest/shared';

export interface OrderedStanding {
  entry: StandingEntryDto;
  /** 1-based place among entries still in the count. Null once eliminated. */
  position: number | null;
}

export interface StandingsSummary {
  /** Still counting, best first. */
  continuing: OrderedStanding[];
  /** Knocked out, most recently eliminated first. */
  eliminated: OrderedStanding[];
  /** Ballots still counting toward some entry. Null when not derivable. */
  activeBallots: number | null;
  /** Ballots whose ranked choices all ran out. Null when not derivable. */
  exhaustedBallots: number | null;
  /** Votes needed to win outright: more than half of the live ballots. */
  majorityThreshold: number | null;
  /** Front-runner in the current round, or null before any votes land. */
  leader: StandingEntryDto | null;
  /** True once the front-runner is over the line and the count would stop. */
  leaderHasMajority: boolean;
  /** True when every entry but one has been eliminated. */
  countComplete: boolean;
}

/** Shares must add up before we trust them enough to publish a derived figure. */
const SHARE_TOLERANCE = 0.02;

/**
 * Order the projection for display.
 *
 * Continuing entries rank by current vote count. Eliminated entries are kept
 * in reverse elimination order — surviving to round 4 beats going out in
 * round 2 — and carry no position number, because "3rd" would imply they are
 * still in a race they have already left.
 *
 * Sorting is stable on the server's own order, so entries tied on votes do not
 * swap places every time we poll.
 */
export function summariseStandings(
  standings: readonly StandingEntryDto[],
  ballotsCast: number,
): StandingsSummary {
  const indexed = standings.map((entry, index) => ({ entry, index }));

  const continuingRaw = indexed
    .filter((row) => !row.entry.eliminated)
    .sort((a, b) => b.entry.votes - a.entry.votes || a.index - b.index);

  const eliminatedRaw = indexed
    .filter((row) => row.entry.eliminated)
    .sort(
      (a, b) =>
        (b.entry.eliminatedRound ?? 0) - (a.entry.eliminatedRound ?? 0) ||
        b.entry.votes - a.entry.votes ||
        a.index - b.index,
    );

  const continuing: OrderedStanding[] = continuingRaw.map((row, i) => ({
    entry: row.entry,
    position: i + 1,
  }));
  const eliminated: OrderedStanding[] = eliminatedRaw.map((row) => ({
    entry: row.entry,
    position: null,
  }));

  const continuingVotes = continuing.reduce((sum, row) => sum + row.entry.votes, 0);
  const continuingShare = continuing.reduce((sum, row) => sum + row.entry.share, 0);

  // Only trust the derivation when it hangs together: the live ballots cannot
  // outnumber the ballots cast, and the shares must actually add up to one.
  const arithmeticHolds =
    continuing.length > 0 &&
    ballotsCast > 0 &&
    continuingVotes > 0 &&
    continuingVotes <= ballotsCast &&
    Math.abs(continuingShare - 1) <= SHARE_TOLERANCE;

  const activeBallots = arithmeticHolds ? continuingVotes : null;
  const exhaustedBallots = activeBallots === null ? null : ballotsCast - activeBallots;
  const majorityThreshold = activeBallots === null ? null : Math.floor(activeBallots / 2) + 1;

  const leader = continuing[0]?.entry ?? null;
  const leaderHasMajority =
    leader !== null && majorityThreshold !== null && leader.votes >= majorityThreshold;

  return {
    continuing,
    eliminated,
    activeBallots,
    exhaustedBallots,
    majorityThreshold,
    leader,
    leaderHasMajority,
    countComplete: continuing.length === 1 && eliminated.length > 0,
  };
}

/** "out, round 3" — the round is what makes the dimming mean something. */
export function eliminationLabel(entry: StandingEntryDto): string {
  return entry.eliminatedRound === null ? 'out' : `out, round ${entry.eliminatedRound}`;
}

/** Aliases are optional in the DTO; never fall back to anything identifying. */
export function displayAlias(alias: string | null): string {
  return alias ?? 'Unnamed entry';
}
