/**
 * Contest state and the one place the web app asks "what phase is it?".
 *
 * Two rules hold this together:
 *
 *  1. The phase is ALWAYS `derivePhase()` from `@contest/shared`. The API
 *     imports the same function. Re-implementing the ladder here is how a UI
 *     ends up offering an upload button the server then rejects.
 *
 *  2. The clock is the SERVER'S. `ContestPublicDto.serverNow` is captured once
 *     per fetch and every subsequent tick is derived from the offset between
 *     it and the browser clock. A laptop that is four minutes fast must not see
 *     voting open four minutes early.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  canSubmit,
  canViewGallery,
  canViewResults,
  canVote,
  derivePhase,
  PHASE_LABELS,
  type ContestPhase,
  type ContestPublicDto,
  type PhaseWindows,
} from '@contest/shared';
import { api } from './api';
import { queryKeys } from './query-client';

const toDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

/** The four admin-editable dates, as `derivePhase` wants them. */
export function contestWindows(contest: ContestPublicDto): PhaseWindows {
  return {
    submissionsOpenAt: toDate(contest.submissionsOpenAt),
    submissionsCloseAt: toDate(contest.submissionsCloseAt),
    votingOpensAt: toDate(contest.votingOpensAt),
    votingClosesAt: toDate(contest.votingClosesAt),
  };
}

/**
 * The phase at an arbitrary moment, reconciled with what the server said.
 *
 * `ContestPublicDto` carries the four windows but NOT `resultsPublishedAt` or
 * `phaseOverride` — an admin forcing a phase, or publishing results, is not
 * reconstructible from the dates alone. So: run `derivePhase` against the
 * windows at the instant the DTO was minted and compare it with the server's
 * own `phase`. If they disagree, the server applied something we cannot see,
 * and we hand that back to `derivePhase` as an override rather than guessing at
 * it ourselves. Either way `derivePhase` remains the only thing deciding.
 */
export function phaseAt(contest: ContestPublicDto, now: Date): ContestPhase {
  const windows = contestWindows(contest);
  const atMint = derivePhase(windows, new Date(contest.serverNow));

  if (atMint !== contest.phase) {
    return derivePhase({ ...windows, phaseOverride: contest.phase }, now);
  }
  return derivePhase(windows, now);
}

/** What the member may do right now. Mirrors the server's own guards exactly. */
export interface PhaseGates {
  submit: boolean;
  vote: boolean;
  gallery: boolean;
  results: boolean;
}

export const gatesFor = (phase: ContestPhase): PhaseGates => ({
  submit: canSubmit(phase),
  vote: canVote(phase),
  gallery: canViewGallery(phase),
  results: canViewResults(phase),
});

export interface Milestone {
  /** Plain-English name for the moment, e.g. "Entries close". */
  label: string;
  at: Date;
}

/**
 * The next dated milestone in the contest, or null once they have all passed.
 * The list is in chronological order, so the first one still in the future is
 * the answer.
 */
export function nextMilestone(contest: ContestPublicDto, now: Date): Milestone | null {
  const ordered: ReadonlyArray<readonly [Date | null, string]> = [
    [toDate(contest.submissionsOpenAt), 'Entries open'],
    [toDate(contest.submissionsCloseAt), 'Entries close'],
    [toDate(contest.votingOpensAt), 'Voting opens'],
    [toDate(contest.votingClosesAt), 'Voting closes'],
  ];

  for (const [at, label] of ordered) {
    if (at && at.getTime() > now.getTime()) return { label, at };
  }
  return null;
}

/**
 * A clock anchored to the server.
 *
 * Ticks once a second so a countdown stays honest, but every value is
 * `serverNow + elapsed-since-we-received-it`, never the raw browser clock.
 */
export function useServerClock(serverNowIso: string | null | undefined): Date {
  const [tick, setTick] = useState(() => Date.now());
  const [anchor, setAnchor] = useState<{ server: number; local: number } | null>(null);

  useEffect(() => {
    if (!serverNowIso) return;
    const server = Date.parse(serverNowIso);
    if (Number.isNaN(server)) return;
    setAnchor({ server, local: Date.now() });
  }, [serverNowIso]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return useMemo(
    () => (anchor ? new Date(anchor.server + (tick - anchor.local)) : new Date(tick)),
    [anchor, tick],
  );
}

export function useContestQuery(enabled = true): UseQueryResult<ContestPublicDto, Error> {
  return useQuery({
    queryKey: queryKeys.contest,
    queryFn: () => api.contest(),
    enabled,
    // The phase changes at known instants, so a short window is plenty; the
    // ticking clock below does the second-by-second work.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export interface ContestState {
  contest: ContestPublicDto | null;
  /** Null only while the contest has not loaded. */
  phase: ContestPhase | null;
  phaseLabel: string | null;
  gates: PhaseGates;
  /** Server-anchored current time. Safe to hand to `Countdown`. */
  now: Date;
  next: Milestone | null;
  isLoading: boolean;
  error: Error | null;
}

/** Everything a screen needs to know about where the contest is up to. */
export function useContest(enabled = true): ContestState {
  const query = useContestQuery(enabled);
  const contest = query.data ?? null;
  const now = useServerClock(contest?.serverNow);

  const phase = contest ? phaseAt(contest, now) : null;

  return {
    contest,
    phase,
    phaseLabel: phase ? PHASE_LABELS[phase] : null,
    // Closed by default: an unknown phase must never unlock an action.
    gates: phase ? gatesFor(phase) : { submit: false, vote: false, gallery: false, results: false },
    now,
    next: contest ? nextMilestone(contest, now) : null,
    isLoading: query.isPending,
    error: query.error ?? null,
  };
}
