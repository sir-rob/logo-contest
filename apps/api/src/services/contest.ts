/**
 * Contest loading and phase gating.
 *
 * Every route that cares about "is this allowed right now" comes through here,
 * and this module in turn defers to `derivePhase` from `@contest/shared` — the
 * same function the web app uses. There is exactly one definition of what
 * phase it is, and both sides import it.
 */

import {
  ApiError,
  canSubmit,
  canVote,
  canViewGallery,
  canViewResults,
  derivePhase,
  type Contest,
  type ContestPhase,
  type ContestPublicDto,
} from '@contest/shared';
import { getConfig, now, type AppConfig } from '../config.js';
import { contestDoc } from '../db/collections.js';
import { toIso } from '../db/converters.js';

export async function loadContest(contestId: string): Promise<Contest> {
  const snap = await contestDoc(contestId).get();
  const contest = snap.data();
  if (!contest) throw new ApiError('NOT_FOUND', 'That contest does not exist.');
  return contest;
}

/** The default contest for this deployment — the app runs one at a time. */
export async function loadDefaultContest(config: AppConfig = getConfig()): Promise<Contest> {
  return loadContest(config.defaultContestId);
}

export function phaseOf(contest: Contest, config: AppConfig = getConfig()): ContestPhase {
  return derivePhase(
    {
      submissionsOpenAt: contest.submissionsOpenAt,
      submissionsCloseAt: contest.submissionsCloseAt,
      votingOpensAt: contest.votingOpensAt,
      votingClosesAt: contest.votingClosesAt,
      resultsPublishedAt: contest.resultsPublishedAt,
      phaseOverride: contest.phaseOverride,
    },
    now(config),
  );
}

export async function loadContestWithPhase(
  contestId: string,
  config: AppConfig = getConfig(),
): Promise<{ contest: Contest; phase: ContestPhase }> {
  const contest = await loadContest(contestId);
  return { contest, phase: phaseOf(contest, config) };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export function assertCanSubmit(phase: ContestPhase): void {
  if (!canSubmit(phase)) throw new ApiError('PHASE_SUBMISSIONS_CLOSED');
}

export function assertCanVote(phase: ContestPhase): void {
  if (!canVote(phase)) throw new ApiError('PHASE_VOTING_CLOSED');
}

export function assertCanViewGallery(phase: ContestPhase): void {
  if (!canViewGallery(phase)) throw new ApiError('FORBIDDEN', 'The gallery is not open yet.');
}

export function assertCanViewResults(phase: ContestPhase): void {
  if (!canViewResults(phase)) throw new ApiError('PHASE_RESULTS_NOT_PUBLISHED');
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * The public projection of a contest.
 *
 * `serverNow` is included so a client countdown stays honest even when the
 * user's laptop clock is minutes out — and so the dev fake clock is visible to
 * the UI instead of fighting it.
 */
export function contestToDto(contest: Contest, config: AppConfig = getConfig()): ContestPublicDto {
  return {
    id: contest.id,
    title: contest.title,
    description: contest.description,
    phase: phaseOf(contest, config),
    submissionsOpenAt: toIso(contest.submissionsOpenAt),
    submissionsCloseAt: toIso(contest.submissionsCloseAt),
    votingOpensAt: toIso(contest.votingOpensAt),
    votingClosesAt: toIso(contest.votingClosesAt),
    maxRanks: contest.maxRanks,
    allowSelfVote: contest.allowSelfVote,
    showLiveStandings: contest.showLiveStandings,
    serverNow: now(config).toISOString(),
  };
}
