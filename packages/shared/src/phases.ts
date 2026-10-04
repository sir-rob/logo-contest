import { z } from 'zod';

/**
 * Contest lifecycle.
 *
 * The phase is DERIVED from the clock, unless an admin has forced one. Both the
 * API and the web app import `derivePhase` so they can never disagree about
 * what phase it is — a mismatch there would show a user an upload button the
 * server then rejects.
 */
export const CONTEST_PHASES = [
  'SETUP',
  'SUBMISSIONS_OPEN',
  'VOTING_OPEN',
  'CLOSED',
  'RESULTS_PUBLISHED',
] as const;

export const ContestPhaseSchema = z.enum(CONTEST_PHASES);
export type ContestPhase = z.infer<typeof ContestPhaseSchema>;

export interface PhaseWindows {
  submissionsOpenAt: Date | null;
  submissionsCloseAt: Date | null;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
  /** Set when an admin publishes results; forces RESULTS_PUBLISHED. */
  resultsPublishedAt?: Date | null;
  /** Admin escape hatch. When set, it wins outright. */
  phaseOverride?: ContestPhase | null;
}

/**
 * Single source of truth for "what phase are we in".
 *
 * Order matters: an explicit override beats everything, publication beats the
 * clock, and the windows are evaluated newest-first so a contest with missing
 * or overlapping dates degrades to the most conservative answer rather than
 * throwing.
 */
export function derivePhase(w: PhaseWindows, now: Date = new Date()): ContestPhase {
  if (w.phaseOverride) return w.phaseOverride;
  if (w.resultsPublishedAt && now >= w.resultsPublishedAt) return 'RESULTS_PUBLISHED';

  const t = now.getTime();
  const votingClose = w.votingClosesAt?.getTime();
  const votingOpen = w.votingOpensAt?.getTime();
  const subClose = w.submissionsCloseAt?.getTime();
  const subOpen = w.submissionsOpenAt?.getTime();

  if (votingClose !== undefined && t >= votingClose) return 'CLOSED';
  if (votingOpen !== undefined && t >= votingOpen) return 'VOTING_OPEN';
  if (subClose !== undefined && t >= subClose) {
    // Submissions are over but voting has not started: a deliberate gap.
    return votingOpen !== undefined ? 'SETUP' : 'CLOSED';
  }
  if (subOpen !== undefined && t >= subOpen) return 'SUBMISSIONS_OPEN';
  return 'SETUP';
}

/** Can entries be created, replaced or withdrawn right now? */
export const canSubmit = (phase: ContestPhase): boolean => phase === 'SUBMISSIONS_OPEN';

/** Can ballots be cast or edited right now? */
export const canVote = (phase: ContestPhase): boolean => phase === 'VOTING_OPEN';

/** Is the anonymous gallery visible? Hidden during SETUP so nothing leaks early. */
export const canViewGallery = (phase: ContestPhase): boolean => phase !== 'SETUP';

/** Are final, published results visible to members? */
export const canViewResults = (phase: ContestPhase): boolean => phase === 'RESULTS_PUBLISHED';

export const PHASE_LABELS: Record<ContestPhase, string> = {
  SETUP: 'Coming soon',
  SUBMISSIONS_OPEN: 'Accepting entries',
  VOTING_OPEN: 'Voting open',
  CLOSED: 'Voting closed',
  RESULTS_PUBLISHED: 'Results',
};
