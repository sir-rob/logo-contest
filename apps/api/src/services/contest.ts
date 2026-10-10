/**
 * Contest loading, multi-contest resolution and phase gating.
 *
 * Every route that cares about "is this allowed right now" comes through here,
 * and this module in turn defers to `derivePhase` from `@contest/shared` — the
 * same function the web app uses. There is exactly one definition of what
 * phase it is, and both sides import it.
 */

import type { FastifyRequest } from 'fastify';
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
import { contestDoc, contestsCol } from '../db/collections.js';
import { toIso } from '../db/converters.js';
import type { AuthedPrincipal } from '../plugins/auth.js';

export async function loadContest(contestId: string): Promise<Contest> {
  const snap = await contestDoc(contestId).get();
  const contest = snap.data();
  if (!contest) throw new ApiError('NOT_FOUND', 'That contest does not exist.');
  return contest;
}

/**
 * Resolve which contest a request is targeting (`?contestId=...` or header
 * `x-contest-id`, falling back to `config.defaultContestId`).
 */
export function resolveContestId(
  request: FastifyRequest,
  config: AppConfig = getConfig(),
): string {
  const query = request.query as Record<string, unknown> | undefined;
  const fromQuery = typeof query?.['contestId'] === 'string' ? query['contestId'].trim() : '';
  if (fromQuery.length > 0) return fromQuery;

  const header = request.headers['x-contest-id'];
  const fromHeader = typeof header === 'string' ? header.trim() : '';
  if (fromHeader.length > 0) return fromHeader;

  return config.defaultContestId;
}

/**
 * Does the caller have access to this contest?
 *
 *   - Administrators can see and manage every contest.
 *   - Members can access any contest they have registered for with its unique
 *     contest code (`user.registeredContestIds`), plus the deployment's
 *     legacy default contest if their user record has no conflicting
 *     restriction when using default fallback routes.
 */
export function canAccessContest(
  principal: AuthedPrincipal,
  contestId: string,
  config: AppConfig = getConfig(),
): boolean {
  if (principal.role === 'admin') return true;
  if (principal.user.registeredContestIds.includes(contestId)) return true;
  // Backward-compatible access for existing/default contest when no other
  // registrations have been explicitly restricted:
  if (contestId === config.defaultContestId && principal.user.registeredContestIds.length === 0) {
    return true;
  }
  return false;
}

export function assertCanAccessContest(
  principal: AuthedPrincipal,
  contestId: string,
  config: AppConfig = getConfig(),
): void {
  if (!canAccessContest(principal, contestId, config)) {
    throw new ApiError('CONTEST_ACCESS_REQUIRED');
  }
}

/**
 * Load the contest targeted by `request` and verify the caller is allowed to
 * access it.
 */
export async function loadRequestContest(
  request: FastifyRequest,
  principal?: AuthedPrincipal,
  config: AppConfig = getConfig(),
): Promise<Contest> {
  const contestId = resolveContestId(request, config);
  if (principal) {
    assertCanAccessContest(principal, contestId, config);
  }
  return loadContest(contestId);
}

/** The default contest for this deployment — fallback when no contestId is specified. */
export async function loadDefaultContest(config: AppConfig = getConfig()): Promise<Contest> {
  return loadContest(config.defaultContestId);
}

/** List all contests in Firestore, newest first. */
export async function listAllContests(): Promise<Contest[]> {
  const snap = await contestsCol().get();
  const contests = snap.docs.map((doc) => doc.data());
  contests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return contests;
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

export async function loadRequestContestWithPhase(
  request: FastifyRequest,
  principal?: AuthedPrincipal,
  config: AppConfig = getConfig(),
): Promise<{ contest: Contest; phase: ContestPhase }> {
  const contest = await loadRequestContest(request, principal, config);
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
    code: contest.code,
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
