/**
 * Ballot routes — `/ballot`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE ADDING A ROUTE TO THIS FILE.
 *
 * BALLOTS ARE SEALED FROM EVERYONE, INCLUDING ADMINS. The only person who may
 * ever see the contents of a ballot is the person who cast it. That is not a
 * UI convention, it is the architectural constraint this whole file exists to
 * enforce (01-SPEC.md §6: "Admins cannot see ballot contents — no view, no
 * export, no exception").
 *
 * Therefore the following DO NOT EXIST here, and must never be added:
 *   • any route that LISTS ballots, or returns more than one ballot's contents;
 *   • any admin or moderation view of a ballot;
 *   • any route that exports identified ballots;
 *   • any route that counts how many people ranked a given entry;
 *   • any parameter — `uid`, `voterUid`, `email`, `ballotId` — that lets the
 *     caller name a ballot other than their own. The caller's identity comes
 *     from the verified token and nowhere else.
 *
 * "It is just a small admin debug endpoint" is exactly how this guarantee gets
 * broken, and the breakage is invisible until someone's vote is read back to
 * them by a colleague. If you need it for debugging, use the emulator.
 *
 * Two things that are legitimately allowed, so they are not confused with the
 * above:
 *   • TURNOUT — WHO has voted, never WHAT they voted — is derived from ballot
 *     EXISTENCE only and lives in the admin routes, not here.
 *   • The counting engine reads whole ballots server-side and reduces them to
 *     anonymous rankings before anything is persisted or returned.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiError,
  MIN_RANKS,
  SaveBallotSchema,
  rankingHasNoDuplicates,
  type Ballot,
} from '@contest/shared';
import { now } from '../config.js';
import { ballotDoc, submissionDoc } from '../db/collections.js';
import { getDb } from '../firebase.js';
import { principalOf } from '../plugins/auth.js';
import { assertCanVote, loadDefaultContest, phaseOf } from '../services/contest.js';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** The only ballot payload this API ever returns: the caller's own ranking. */
export interface MyBallotDto {
  ranking: string[] | null;
}

/**
 * A deliberately permissive parse of the request body.
 *
 * `SaveBallotSchema` is the contract the client validates against, and it
 * already encodes "1..MAX_RANKS distinct ids". If we parsed with it here, every
 * ballot mistake would collapse into one generic VALIDATION_FAILED and the UI
 * could not tell "you ranked the same entry twice" from "you ranked a withdrawn
 * entry". So we check the SHAPE here and the RULES in `validateRanking`, which
 * throws a specific BALLOT_* code. The result is re-checked against
 * `SaveBallotSchema` before it is written, so the stored document still
 * satisfies the published contract.
 */
const BallotBodyShapeSchema = z.object({
  ranking: z.array(z.string().min(1)),
});

// ---------------------------------------------------------------------------
// Validation — pure, no Firestore, so it is testable in isolation
// ---------------------------------------------------------------------------

export interface RankingValidationOptions {
  /** `contest.maxRanks`, which is itself capped at `MAX_RANKS`. */
  maxRanks: number;
  /** Ids of submissions that exist IN THIS CONTEST, whatever their status. */
  knownIds: ReadonlySet<string>;
  /** Subset of `knownIds` whose status is `active`. */
  activeIds: ReadonlySet<string>;
}

/**
 * Structural checks that need nothing from the database.
 *
 * Split out so a route can reject a malformed ballot before spending reads on
 * it. `validateRanking` runs these first regardless, so it remains correct on
 * its own.
 *
 * ORDER MATTERS: an empty array is reported as BALLOT_EMPTY, never as
 * BALLOT_TOO_MANY_RANKS, and a duplicate is reported before we go looking for
 * ids that may not exist.
 */
export function assertRankingShape(ranking: readonly string[], maxRanks: number): void {
  if (ranking.length < MIN_RANKS) {
    throw new ApiError('BALLOT_EMPTY');
  }
  if (ranking.length > maxRanks) {
    throw new ApiError(
      'BALLOT_TOO_MANY_RANKS',
      `You can rank at most ${String(maxRanks)} ${maxRanks === 1 ? 'entry' : 'entries'}.`,
    );
  }
  if (!rankingHasNoDuplicates(ranking)) {
    throw new ApiError('BALLOT_DUPLICATE_RANKS');
  }
}

/**
 * Validate a ranking. Throws the most specific `ApiError` for the first problem
 * found; returns nothing on success.
 *
 * A caller must be able to distinguish "that entry does not exist" from "that
 * entry was withdrawn or disqualified", because the remedies differ: the first
 * means a stale client, the second means the voter has to pick someone else.
 *
 * NOTE ON SELF-VOTING: there is no check here for "this entry belongs to the
 * voter", and that absence is DELIBERATE — see the route below.
 */
export function validateRanking(ranking: readonly string[], opts: RankingValidationOptions): void {
  assertRankingShape(ranking, opts.maxRanks);

  for (const id of ranking) {
    if (!opts.knownIds.has(id)) {
      throw new ApiError('BALLOT_UNKNOWN_SUBMISSION');
    }
  }

  for (const id of ranking) {
    if (!opts.activeIds.has(id)) {
      // Known, but withdrawn or disqualified. A ballot cast before the entry
      // was pulled keeps counting (the counting engine handles that); newly
      // ranking one is refused.
      throw new ApiError('BALLOT_INACTIVE_SUBMISSION');
    }
  }
}

// ---------------------------------------------------------------------------
// Firestore lookups
// ---------------------------------------------------------------------------

/**
 * Resolve the ranked ids to "exists in this contest" and "is active".
 *
 * Reads are by document key, one per DISTINCT id (at most `MAX_RANKS`), never a
 * scan of the submissions collection.
 */
async function loadSubmissionFacts(
  ranking: readonly string[],
  contestId: string,
): Promise<{ knownIds: ReadonlySet<string>; activeIds: ReadonlySet<string> }> {
  const knownIds = new Set<string>();
  const activeIds = new Set<string>();

  const uniqueIds = [...new Set(ranking)];
  const snapshots = await Promise.all(uniqueIds.map((id) => submissionDoc(id).get()));

  for (const snapshot of snapshots) {
    const submission = snapshot.data();
    if (!submission) continue;
    // An id belonging to a different contest is UNKNOWN here rather than
    // inactive — as far as this contest is concerned it does not exist.
    if (submission.contestId !== contestId) continue;
    knownIds.add(snapshot.id);
    if (submission.status === 'active') activeIds.add(snapshot.id);
  }

  return { knownIds, activeIds };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerBallotRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /ballot — the caller's OWN ballot, and only ever their own.
   *
   * Readable in every phase: after voting closes a member can still review what
   * they cast, which is the one form of ballot access secrecy does not preclude.
   */
  app.get(
    '/ballot',
    { preHandler: app.requireAuth },
    async (request: FastifyRequest): Promise<MyBallotDto> => {
      const principal = principalOf(request);
      const contest = await loadDefaultContest();

      // Deliberate: a lookup by the DETERMINISTIC document id, not a
      // `where('voterUid', '==', uid)` query. A key lookup has exactly one
      // possible result and no way to accidentally return someone else's row —
      // a mistyped or accidentally-dropped query filter, by contrast, silently
      // returns the whole collection. There is no query against `ballots`
      // anywhere in this file for that reason.
      const snapshot = await ballotDoc(contest.id, principal.uid).get();
      const ballot = snapshot.data();

      return { ranking: ballot ? [...ballot.ranking] : null };
    },
  );

  /**
   * PUT /ballot — create or replace the caller's ballot. Voting phase only.
   */
  app.put(
    '/ballot',
    { preHandler: app.requireAuth },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const principal = principalOf(request);
      const { ranking } = BallotBodyShapeSchema.parse(request.body);

      const contest = await loadDefaultContest();
      assertCanVote(phaseOf(contest));

      // Cheap checks before spending reads; `validateRanking` repeats them.
      assertRankingShape(ranking, contest.maxRanks);

      const { knownIds, activeIds } = await loadSubmissionFacts(ranking, contest.id);
      validateRanking(ranking, { maxRanks: contest.maxRanks, knownIds, activeIds });

      // SELF-VOTING IS ALLOWED, AT ANY RANK INCLUDING RANK 1. This is a settled
      // product decision (01-SPEC.md §5), not an oversight: self-votes largely
      // cancel out across a group this size and the rule is trivial to explain.
      // Do NOT add a filter that strips the voter's own entry — that would
      // silently alter a ballot the voter believes they cast.

      // Belt and braces: the stored document must satisfy the published
      // contract. Nothing can fail here that the checks above let through.
      const safe = SaveBallotSchema.parse({ ranking });

      const db = getDb();
      const ref = ballotDoc(contest.id, principal.uid, db);
      const at = now();

      await db.runTransaction(async (tx) => {
        // Read-then-write in one transaction so a concurrent edit from a second
        // tab cannot resurrect a stale `createdAt` or interleave a half-write.
        const existing = await tx.get(ref);
        const previous = existing.data();

        const ballot: Ballot = {
          contestId: contest.id,
          voterUid: principal.uid,
          ranking: [...safe.ranking],
          // First cast wins for `createdAt`; every save bumps `updatedAt`.
          createdAt: previous?.createdAt ?? at,
          updatedAt: at,
        };

        // The deterministic key is what makes double-voting structurally
        // impossible: one person cannot hold two ballots in one contest,
        // because there is only one document they can ever write to.
        tx.set(ref, ballot);
      });

      // 204, with no body. Echoing the ranking back gains nothing — the client
      // already has it — and widens the surface on which a ballot can leak.
      return reply.status(204).send();
    },
  );

  /**
   * DELETE /ballot — withdraw the caller's own ballot.
   *
   * For the member who changes their mind about participating at all. Phase
   * gated like PUT: once voting closes the record is frozen.
   */
  app.delete(
    '/ballot',
    { preHandler: app.requireAuth },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const principal = principalOf(request);
      const contest = await loadDefaultContest();
      assertCanVote(phaseOf(contest));

      // Same deterministic key. Deleting a ballot that was never cast is a
      // no-op, which keeps the route idempotent.
      await ballotDoc(contest.id, principal.uid).delete();

      return reply.status(204).send();
    },
  );
}
