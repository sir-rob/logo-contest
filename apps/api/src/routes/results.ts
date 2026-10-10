/**
 * Dashboard, results and admin export routes.
 *
 * The parent scope applies the `/api` prefix, so the paths registered here are
 * relative to it.
 *
 * Every response on this file's member-facing routes is built from a DTO in
 * `@contest/shared/api.ts` and `.parse()`d before it is sent. That is not
 * belt-and-braces: `/dashboard` and `/results` are the two routes where a
 * tally and an identity come closest to each other, and parsing is what stops
 * a field added to an entity later from silently riding out to members.
 */

import type { FastifyInstance } from 'fastify';
import {
  ApiError,
  COLLECTIONS,
  DashboardSchema,
  ResolveTieSchema,
  ballotDocId,
  type ContestPhase,
  type DashboardDto,
  type ResultsDto,
  type StandingEntryDto,
} from '@contest/shared';
import { getConfig, now } from '../config.js';
import { getDb } from '../firebase.js';
import { usersCol } from '../db/collections.js';
import { toIso } from '../db/converters.js';
import { principalOf } from '../plugins/auth.js';
import { assertCanViewResults, loadRequestContest, phaseOf } from '../services/contest.js';
import { toPublicDtos } from '../services/submission-dto.js';
import { writeAudit } from '../services/audit.js';
import { ballotsToCsv } from '../services/csv.js';
import {
  applyTieBreakOverride,
  buildResultsDto,
  computeSnapshot,
  getLiveProjection,
  loadAllSubmissions,
  loadCandidateSubmissions,
  loadCountableBallots,
  loadFinalSnapshot,
  publishResults,
  standingsFromSnapshot,
  unpublishResults,
} from '../services/results.js';

/** Standings only make sense once there is something to count. */
const STANDINGS_PHASES: readonly ContestPhase[] = ['VOTING_OPEN', 'CLOSED', 'RESULTS_PUBLISHED'];

/**
 * Count the ballots cast for a contest.
 *
 * An aggregation query, so no ballot body is transferred at all — the server
 * learns the number and nothing else.
 */
async function countBallotsCast(contestId: string): Promise<number> {
  const agg = await getDb().collection(COLLECTIONS.ballots).where('contestId', '==', contestId).count().get();
  return agg.data().count;
}

/**
 * Has the caller voted?
 *
 * Only existence is read. The document is fetched through a converter-less
 * handle and `.data()` is never called, so this route never holds a ranking —
 * not even the caller's own, which it has no reason to see.
 */
async function hasVoted(contestId: string, uid: string): Promise<boolean> {
  const snap = await getDb().collection(COLLECTIONS.ballots).doc(ballotDocId(contestId, uid)).get();
  return snap.exists;
}

export async function registerResultsRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /dashboard
  // -------------------------------------------------------------------------
  app.get('/dashboard', { preHandler: app.requireAuth }, async (request): Promise<DashboardDto> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);
    const phase = phaseOf(contest, config);

    const [candidates, allUsersSnap, ballotsCast, iHaveVoted] = await Promise.all([
      loadCandidateSubmissions(contest.id),
      usersCol().get(),
      countBallotsCast(contest.id),
      hasVoted(contest.id, principal.uid),
    ]);

    const registeredUsersCount = allUsersSnap.docs.filter((doc) =>
      doc.data().registeredContestIds?.includes(contest.id),
    ).length;
    const eligibleVoters = registeredUsersCount > 0 ? registeredUsersCount : allUsersSnap.size;
    const iHaveSubmitted = candidates.some((c) => c.ownerUid === principal.uid);

    // ---------------------------------------------------------------------
    // Standings.
    //
    // Three independent gates, each of which returns NULL rather than a
    // partial tally. A truncated or rounded tally is still a tally; the only
    // safe suppression is to send nothing and say why.
    // ---------------------------------------------------------------------
    let standings: StandingEntryDto[] | null = null;
    let standingsHiddenReason: string | null = null;

    if (!contest.showLiveStandings) {
      standingsHiddenReason = 'Live standings are turned off for this contest.';
    } else if (!STANDINGS_PHASES.includes(phase)) {
      standingsHiddenReason = 'Standings appear once voting opens.';
    } else if (ballotsCast < contest.minBallotsToPublish) {
      // Same anonymity floor as the publish gate, applied to the LIVE view for
      // the same reason: an IRV projection over three ballots lets a reader
      // reconstruct an individual's ranking from the transfers. The floor
      // cannot only guard the final publication or the live page becomes the
      // side channel around it.
      standingsHiddenReason = `Standings appear once at least ${contest.minBallotsToPublish} ballots have been cast.`;
    } else {
      // The live IRV projection, not raw first-choice totals, so the number on
      // screen means the same thing as the final result will.
      const projection = await getLiveProjection(contest.id, config);
      const entries = await toPublicDtos(candidates, principal.uid);
      standings = standingsFromSnapshot(projection, entries);
    }

    // The deadline that matters right now, so the client renders one countdown.
    const closesAt =
      phase === 'SUBMISSIONS_OPEN'
        ? toIso(contest.submissionsCloseAt)
        : phase === 'VOTING_OPEN'
          ? toIso(contest.votingClosesAt)
          : null;

    return DashboardSchema.parse({
      phase,
      // Turnout here is AGGREGATE ONLY. Per-person turnout exists, but it is
      // an admin read model on another route; a member-facing response must
      // never carry who has or has not voted.
      eligibleVoters,
      submissionCount: candidates.length,
      ballotsCast,
      iHaveSubmitted,
      iHaveVoted,
      closesAt,
      serverNow: now(config).toISOString(),
      standings,
      standingsHiddenReason,
    } satisfies DashboardDto);
  });

  // -------------------------------------------------------------------------
  // GET /results
  // -------------------------------------------------------------------------
  app.get('/results', { preHandler: app.requireAuth }, async (request): Promise<ResultsDto> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);

    // PHASE_RESULTS_NOT_PUBLISHED. Members see results when they are
    // published, not when they are computed.
    assertCanViewResults(phaseOf(contest, config));

    const snapshot = await loadFinalSnapshot(contest.id);
    if (!snapshot) throw new ApiError('RESULTS_NOT_COMPUTED');

    return buildResultsDto(snapshot, principal.uid);
  });

  // -------------------------------------------------------------------------
  // POST /admin/results/compute
  // -------------------------------------------------------------------------
  app.post('/admin/results/compute', { preHandler: app.requireAdmin }, async (request): Promise<ResultsDto> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);

    // Computing does NOT publish: an admin looks first, members see it only
    // after an explicit, separately audited publish.
    const { snapshot, irv } = await computeSnapshot(
      contest.id,
      { computedBy: principal.uid, isProjection: false },
      config,
    );

    await writeAudit(
      {
        contestId: contest.id,
        actorUid: principal.uid,
        actorEmail: principal.email,
        action: 'results.compute',
        targetType: 'contest',
        targetId: contest.id,
        metadata: {
          totalBallots: irv.totalBallots,
          winnerSubmissionId: irv.winnerSubmissionId,
          winnerDecidedByTieBreak: irv.winnerDecidedByTieBreak,
        },
      },
      request.log,
    );

    return buildResultsDto(snapshot, principal.uid);
  });

  // -------------------------------------------------------------------------
  // POST /admin/results/publish
  // -------------------------------------------------------------------------
  app.post('/admin/results/publish', { preHandler: app.requireAdmin }, async (request): Promise<{ ok: true }> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);

    await publishResults(contest.id, { uid: principal.uid, email: principal.email }, config);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // POST /admin/results/unpublish
  // -------------------------------------------------------------------------
  app.post('/admin/results/unpublish', { preHandler: app.requireAdmin }, async (request): Promise<{ ok: true }> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);

    await unpublishResults(contest.id, { uid: principal.uid, email: principal.email }, config);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // POST /admin/results/resolve-tie
  // -------------------------------------------------------------------------
  app.post('/admin/results/resolve-tie', { preHandler: app.requireAdmin }, async (request): Promise<ResultsDto> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);

    const parsed = ResolveTieSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Provide the tied entries and which one to eliminate.',
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.') || 'body', issue.message]),
        ),
      );
    }

    // Records the override, then re-runs the count with it applied so the
    // admin sees the consequence of the decision immediately.
    const { snapshot } = await applyTieBreakOverride(
      contest.id,
      parsed.data.tiedCandidates,
      parsed.data.eliminate,
      { uid: principal.uid, email: principal.email },
      config,
    );

    await writeAudit(
      {
        contestId: contest.id,
        actorUid: principal.uid,
        actorEmail: principal.email,
        action: 'results.tiebreak_override',
        targetType: 'contest',
        targetId: contest.id,
        metadata: {
          tiedCandidates: parsed.data.tiedCandidates,
          eliminate: parsed.data.eliminate,
        },
      },
      request.log,
    );

    return buildResultsDto(snapshot, principal.uid);
  });

  // -------------------------------------------------------------------------
  // GET /admin/export/ballots.csv
  // -------------------------------------------------------------------------
  app.get('/admin/export/ballots.csv', { preHandler: app.requireAdmin }, async (request, reply): Promise<string> => {
    const principal = principalOf(request);
    const config = getConfig();
    const contest = await loadRequestContest(request, principal, config);

    // `loadCountableBallots` is the anonymised reader: rankings only, ordered
    // by a hash of the ranking. Nothing here ever holds a voter.
    const ballots = await loadCountableBallots(contest.id);

    // Same anonymity floor as the publish gate, for the same reason — a
    // handful of rows of ranked aliases is re-identifiable by anyone who knows
    // who was in the room.
    if (ballots.length < contest.minBallotsToPublish) {
      throw new ApiError(
        'RESULTS_TOO_FEW_BALLOTS',
        `The export needs at least ${contest.minBallotsToPublish} ballots — fewer rows than that can be traced back to individuals.`,
      );
    }

    // Aliases for EVERY submission, not just active ones: a ranking may name a
    // since-disqualified entry, and an independent recount needs to see it to
    // reproduce the result. An alias identifies an entry, never a person.
    const submissions = await loadAllSubmissions(contest.id);
    const aliases = new Map<string, string | null>(submissions.map((s) => [s.id, s.alias]));
    const aliasOf = (id: string): string | null => aliases.get(id) ?? null;

    const csv = ballotsToCsv(
      ballots.map((b) => b.ranking),
      aliasOf,
      // This contest's own cap, which is `MAX_RANKS` (5) unless an admin
      // lowered it — the file should have exactly the columns a ballot could
      // have filled.
      contest.maxRanks,
    );

    await writeAudit(
      {
        contestId: contest.id,
        actorUid: principal.uid,
        actorEmail: principal.email,
        action: 'export.ballots',
        targetType: 'contest',
        targetId: contest.id,
        metadata: { rowCount: ballots.length },
      },
      request.log,
    );

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="ballots-${contest.id}.csv"`)
      .send(csv);
  });
}
