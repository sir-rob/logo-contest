/**
 * Counting orchestration, snapshot persistence, live projection and the
 * publish gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BALLOT-SECRECY INVARIANT FOR THIS FILE.
 *
 * Ballots are sealed from everyone, including admins. The counting engine is
 * the only consumer of ballot bodies, and it must receive them ANONYMISED.
 *
 * So, throughout this module:
 *
 *     A `voterUid` and a `ranking` NEVER coexist in the same object anywhere
 *     in this file.
 *
 * That is enforced structurally rather than by convention. Ballots are read
 * through a Firestore field projection that selects `ranking` and nothing
 * else, so the uid is never even transferred from the database; and the read
 * deliberately bypasses `ballotsCol()` (whose converter would hydrate a full
 * `Ballot`, uid included) in favour of a converter-less handle that cannot
 * produce one. The projected rows are mapped straight to `CountableBallot`,
 * whose only identifier is an opaque index minted here.
 *
 * Ballots are also NEVER sorted by a voter attribute. They are ordered by a
 * hash of the ranking, so the order handed to the engine is a function of the
 * votes alone and leaks nothing about who voted, or when.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import {
  ApiError,
  COLLECTIONS,
  DEFAULT_MIN_BALLOTS_TO_PUBLISH,
  ResultsSchema,
  type CountableBallot,
  type PublicSubmissionDto,
  type ResultSnapshot,
  type ResultsDto,
  type StandingEntryDto,
  type Submission,
  type TieBreak,
} from '@contest/shared';
import { getConfig, now, type AppConfig } from '../config.js';
import { getDb } from '../firebase.js';
import { contestDoc, projectionDoc, resultDoc, submissionsCol, usersCol } from '../db/collections.js';
import { adminTieBreakKey, countIrv, type IrvResult } from '../irv/index.js';
import { loadContest } from './contest.js';
import { toPublicDtos } from './submission-dto.js';
import { writeAudit } from './audit.js';
import { anonymousBallotId, orderRankingsAnonymously } from './csv.js';

/** Who asked for a count. Never stored on anything a member can read. */
export interface ResultsActor {
  uid: string;
  email: string;
}

/**
 * How stale a live projection may be before the dashboard recomputes it.
 *
 * A dashboard that polls must not re-run IRV on every request — at 25 voters
 * the count is cheap, but the read amplification is not, and a burst of polls
 * would hammer Firestore for an answer that cannot have changed meaningfully.
 */
export const PROJECTION_MAX_AGE_MS = 15_000;

// ---------------------------------------------------------------------------
// Reading ballots — the anonymised path
// ---------------------------------------------------------------------------

/**
 * Rankings only. The return type is `string[][]` and not a ballot type on
 * purpose: there is no shape in this function that could carry a voter.
 */
async function loadBallotRankings(contestId: string): Promise<string[][]> {
  const snap = await getDb()
    .collection(COLLECTIONS.ballots)
    // No converter: `ballotConverter` would parse a full `Ballot` and hand us
    // back `voterUid` alongside `ranking`, which is precisely the pairing this
    // module forbids.
    .where('contestId', '==', contestId)
    // FIELD PROJECTION. `voterUid` is never transferred out of Firestore.
    .select('ranking')
    .get();

  const rankings: string[][] = [];
  for (const doc of snap.docs) {
    // NB: `doc.id` is `<contestId>_<uid>` and is therefore POISON — reading it
    // here would reintroduce the voter. It is never touched.
    const raw: unknown = doc.get('ranking');
    if (!Array.isArray(raw)) continue;
    const ranking = raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (ranking.length > 0) rankings.push(ranking);
  }
  return rankings;
}

/**
 * Ballots as the counting engine sees them: an opaque id and a ranking.
 *
 * The id is a sequential index over a hash-ordered list, so it is stable
 * across recounts, unique per row, and derived from nothing but the vote.
 */
export async function loadCountableBallots(contestId: string): Promise<CountableBallot[]> {
  const rankings = await loadBallotRankings(contestId);
  // Hash order, never Firestore order (which correlates with document id, and
  // therefore with uid) and never creation time (which correlates with who).
  return orderRankingsAnonymously(rankings).map((ranking, index) => ({
    ballotId: anonymousBallotId(index, 'b'),
    ranking,
  }));
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * Candidates are the ACTIVE submissions. Disqualified and withdrawn entries
 * are not candidates — the engine skips them wherever they appear in a
 * ranking, so a voter who ranked a since-disqualified entry still has their
 * next preference counted.
 */
export async function loadCandidateSubmissions(contestId: string): Promise<Submission[]> {
  const snap = await submissionsCol().where('contestId', '==', contestId).where('status', '==', 'active').get();
  return snap.docs.map((d) => d.data());
}

/** Every submission, including disqualified ones — needed to alias old rankings. */
export async function loadAllSubmissions(contestId: string): Promise<Submission[]> {
  const snap = await submissionsCol().where('contestId', '==', contestId).get();
  return snap.docs.map((d) => d.data());
}

// ---------------------------------------------------------------------------
// Admin tie-break overrides
// ---------------------------------------------------------------------------

/**
 * WHERE THE OVERRIDE MAP LIVES, AND WHY.
 *
 * `ContestSchema` has no `adminTieBreaks` field, and neither does
 * `ResultSnapshotSchema`. Both collections are read through zod converters
 * that `.parse()` and therefore STRIP unknown keys, so an extra field written
 * through either typed handle would vanish on the next read.
 *
 * Per instruction the map therefore lives on the RESULT DOCUMENT, reached
 * through a converter-less handle to the very same path. It sits beside the
 * snapshot in storage but outside the snapshot's schema, which is exactly
 * right: it is an INPUT to the count, not part of the count's published
 * record, and it must not appear in any DTO.
 */
function adminTieBreaksRef(contestId: string): DocumentReference<DocumentData> {
  return resultDoc(contestId).withConverter(null);
}

export async function loadAdminTieBreaks(contestId: string): Promise<Record<string, string>> {
  const snap = await adminTieBreaksRef(contestId).get();
  const raw: unknown = snap.get('adminTieBreaks');
  // A missing field is not an error: a contest with no unbreakable tie simply
  // never grows one.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

/** Merge-writes a single override without disturbing the snapshot beside it. */
export async function recordAdminTieBreak(contestId: string, key: string, eliminate: string): Promise<void> {
  // A nested-map merge (rather than a dotted field path) because the key is
  // `id|id|…` and a dotted path would mangle any id containing a period.
  await adminTieBreaksRef(contestId).set({ adminTieBreaks: { [key]: eliminate } }, { merge: true });
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

/**
 * Pure: `IrvResult` + context -> `ResultSnapshot`.
 *
 * Kept free of Firestore so the assembly can be tested against a fabricated
 * engine result, and so the field-by-field mapping is reviewable in one place.
 */
export function snapshotFromIrv(
  irv: IrvResult,
  ctx: {
    contestId: string;
    tieBreakSeed: string;
    computedAt: Date;
    computedBy: string;
    published: boolean;
    isProjection: boolean;
  },
): ResultSnapshot {
  return {
    contestId: ctx.contestId,
    winnerSubmissionId: irv.winnerSubmissionId,
    rounds: irv.rounds,
    totalBallots: irv.totalBallots,
    exhaustedFinal: irv.exhaustedFinal,
    eliminationOrder: irv.eliminationOrder,
    tieBreakSeed: ctx.tieBreakSeed,
    computedAt: ctx.computedAt,
    // Recorded for the audit trail. `ResultsSchema` omits it — see
    // `toResultSnapshotDto` — because an admin's identity is not part of the
    // public record of who won.
    computedBy: ctx.computedBy,
    published: ctx.published,
    isProjection: ctx.isProjection,
  };
}

/**
 * Run the count and persist the result.
 *
 * The final snapshot goes to `resultDoc` and the projection to
 * `projectionDoc` — SEPARATE documents, so a rolling live projection can never
 * be mistaken for a published result, nor overwrite one.
 */
export async function computeSnapshot(
  contestId: string,
  opts: { computedBy: string; isProjection: boolean },
  config: AppConfig = getConfig(),
): Promise<{ snapshot: ResultSnapshot; irv: IrvResult }> {
  const contest = await loadContest(contestId);
  const [candidates, ballots, adminTieBreaks] = await Promise.all([
    loadCandidateSubmissions(contestId),
    loadCountableBallots(contestId),
    loadAdminTieBreaks(contestId),
  ]);

  const irv = countIrv({
    candidates: candidates.map((c) => c.id),
    ballots,
    // From the contest document, so a recount reproduces identical tie-breaks.
    tieBreakSeed: contest.tieBreakSeed,
    adminTieBreaks,
  });

  // A recompute must not silently unpublish. Dropping results members can
  // already see is an explicit, audited act (`results.unpublish`), never a
  // side effect of an admin pressing "recount".
  const previouslyPublished = opts.isProjection ? false : ((await resultDoc(contestId).get()).data()?.published ?? false);

  const snapshot = snapshotFromIrv(irv, {
    contestId,
    tieBreakSeed: contest.tieBreakSeed,
    computedAt: now(config),
    computedBy: opts.computedBy,
    published: previouslyPublished,
    isProjection: opts.isProjection,
  });

  const ref = opts.isProjection ? projectionDoc(contestId) : resultDoc(contestId);
  // `merge` writes the whole snapshot but leaves the `adminTieBreaks` sidecar
  // alone; every snapshot field is always present, so this is a full replace
  // of the snapshot itself.
  await ref.set(snapshot, { merge: true });

  return { snapshot, irv };
}

/** The persisted FINAL snapshot, or null if nobody has counted yet. */
export async function loadFinalSnapshot(contestId: string): Promise<ResultSnapshot | null> {
  return (await resultDoc(contestId).get()).data() ?? null;
}

export async function loadProjectionSnapshot(contestId: string): Promise<ResultSnapshot | null> {
  return (await projectionDoc(contestId).get()).data() ?? null;
}

// ---------------------------------------------------------------------------
// Live projection
// ---------------------------------------------------------------------------

/**
 * Re-run the SAME engine against the ballots cast so far.
 *
 * Live standings show the current IRV projection, not raw first-choice totals,
 * so the number on screen means the same thing as the number in the final
 * result. A first-choice bar chart would tell a leading-on-first-preferences
 * entry it is winning when IRV will eliminate it.
 */
export async function refreshProjection(contestId: string, config: AppConfig = getConfig()): Promise<ResultSnapshot> {
  const { snapshot } = await computeSnapshot(contestId, { computedBy: 'system:projection', isProjection: true }, config);
  return snapshot;
}

/** Pure freshness predicate, so the cache rule is testable without a clock. */
export function isProjectionFresh(
  snapshot: ResultSnapshot | null | undefined,
  at: Date,
  maxAgeMs: number = PROJECTION_MAX_AGE_MS,
): boolean {
  if (!snapshot) return false;
  const age = at.getTime() - snapshot.computedAt.getTime();
  // A snapshot stamped in the future is treated as fresh rather than
  // recomputed forever: clock skew should not become a spin loop.
  return age < maxAgeMs;
}

/** Cached projection: reuse the stored document while it is fresh enough. */
export async function getLiveProjection(contestId: string, config: AppConfig = getConfig()): Promise<ResultSnapshot> {
  const cached = await loadProjectionSnapshot(contestId);
  if (isProjectionFresh(cached, now(config))) return cached as ResultSnapshot;
  return refreshProjection(contestId, config);
}

// ---------------------------------------------------------------------------
// The publish gate
// ---------------------------------------------------------------------------

/**
 * The tie-break that decided the WINNER, if there was one.
 *
 * `IrvResult.winnerDecidedByTieBreak` is available at count time but is not
 * part of `ResultSnapshotSchema`, and publish runs against the stored
 * snapshot, so it is re-derived here: the last round carrying a tie-break
 * whose tied set contains the eventual winner is the one that decided them.
 */
export function finalTieBreakForWinner(snapshot: ResultSnapshot): TieBreak | null {
  const winner = snapshot.winnerSubmissionId;
  if (!winner) return null;
  for (let i = snapshot.rounds.length - 1; i >= 0; i -= 1) {
    const tb = snapshot.rounds[i]?.tieBreak;
    if (tb && tb.tiedCandidates.includes(winner)) return tb;
  }
  return null;
}

/** True when a coin-flip, not the ballots, separated the winner from the runner-up. */
export function winnerDecidedByTieBreak(snapshot: ResultSnapshot): boolean {
  const tb = finalTieBreakForWinner(snapshot);
  // An `admin_override` is already a conscious human decision, so it does not
  // need a second one.
  return tb !== null && tb.reason !== 'admin_override';
}

/**
 * Everything that must be true before members can see a result. Pure, so the
 * gate can be tested without a database.
 */
export function assertPublishable(
  snapshot: ResultSnapshot,
  opts: { minBallotsToPublish?: number; adminTieBreaks: Record<string, string> },
): void {
  const floor = opts.minBallotsToPublish ?? DEFAULT_MIN_BALLOTS_TO_PUBLISH;

  // ANONYMITY FLOOR, NOT A QUORUM RULE. This is not "enough people voted for
  // the result to be legitimate" — it is "with this few ballots, the
  // round-by-round transfers reveal an individual's ranking". With three
  // ballots you can read a person's preference order straight off the
  // elimination chart. Publishing below the floor de-anonymises voters, which
  // is why it is refused outright rather than warned about.
  if (snapshot.totalBallots < floor) {
    throw new ApiError(
      'RESULTS_TOO_FEW_BALLOTS',
      `Results cannot be published with fewer than ${floor} ballots — the round-by-round transfers would identify individual voters.`,
    );
  }

  const tb = finalTieBreakForWinner(snapshot);
  if (tb && tb.reason !== 'admin_override') {
    // At 10–25 voters a coin-flip winner is a real possibility, not a
    // theoretical one. The admin must consciously accept or override it before
    // publication rather than discover it afterwards, so publishing is blocked
    // until an override has been recorded for exactly this tied set.
    const key = adminTieBreakKey(tb.tiedCandidates);
    if (!(key in opts.adminTieBreaks)) {
      throw new ApiError(
        'RESULTS_UNRESOLVED_TIE',
        'The winner was decided by an automatic tie-break. Record a tie-break decision before publishing.',
      );
    }
  }
}

export async function publishResults(
  contestId: string,
  actor: ResultsActor,
  config: AppConfig = getConfig(),
): Promise<void> {
  const snapshot = await loadFinalSnapshot(contestId);
  if (!snapshot) throw new ApiError('RESULTS_NOT_COMPUTED');

  const [contest, adminTieBreaks] = await Promise.all([loadContest(contestId), loadAdminTieBreaks(contestId)]);
  assertPublishable(snapshot, {
    minBallotsToPublish: contest.minBallotsToPublish,
    adminTieBreaks,
  });

  const at = now(config);
  // One batch: the phase flips to RESULTS_PUBLISHED and the snapshot is marked
  // published together, so there is no window in which members can reach
  // `/results` and find an unpublished snapshot, or vice versa.
  const batch = getDb().batch();
  batch.set(contestDoc(contestId), { resultsPublishedAt: at, updatedAt: at }, { merge: true });
  batch.set(resultDoc(contestId), { published: true }, { merge: true });
  await batch.commit();

  await writeResultsAudit(contestId, actor, 'results.publish', {
    totalBallots: snapshot.totalBallots,
    winnerSubmissionId: snapshot.winnerSubmissionId,
  });
}

export async function unpublishResults(
  contestId: string,
  actor: ResultsActor,
  config: AppConfig = getConfig(),
): Promise<void> {
  const at = now(config);
  const batch = getDb().batch();
  batch.set(contestDoc(contestId), { resultsPublishedAt: null, updatedAt: at }, { merge: true });
  batch.set(resultDoc(contestId), { published: false }, { merge: true });
  await batch.commit();

  await writeResultsAudit(contestId, actor, 'results.unpublish', {});
}

// ---------------------------------------------------------------------------
// Tie-break override
// ---------------------------------------------------------------------------

/**
 * Record an admin's choice and immediately re-run the count with it applied,
 * so the admin sees the consequence of the override rather than guessing at it.
 */
export async function applyTieBreakOverride(
  contestId: string,
  tiedCandidates: readonly string[],
  eliminate: string,
  actor: ResultsActor,
  config: AppConfig = getConfig(),
): Promise<{ snapshot: ResultSnapshot; irv: IrvResult }> {
  if (!tiedCandidates.includes(eliminate)) {
    throw new ApiError('VALIDATION_FAILED', 'The eliminated entry must be one of the tied entries.', {
      eliminate: 'Not one of the tied entries.',
    });
  }
  if (new Set(tiedCandidates).size !== tiedCandidates.length) {
    throw new ApiError('VALIDATION_FAILED', 'The tied entries must be distinct.', {
      tiedCandidates: 'Duplicate entry.',
    });
  }

  const candidateIds = new Set((await loadCandidateSubmissions(contestId)).map((c) => c.id));
  const unknown = tiedCandidates.filter((id) => !candidateIds.has(id));
  if (unknown.length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'One or more tied entries are not active candidates.', {
      tiedCandidates: `Unknown entr${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}`,
    });
  }

  await recordAdminTieBreak(contestId, adminTieBreakKey(tiedCandidates), eliminate);
  return computeSnapshot(contestId, { computedBy: actor.uid, isProjection: false }, config);
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/**
 * Derive the standings table from the FINAL round of a snapshot.
 *
 * `votes` is what a candidate holds after every transfer; `share` is that over
 * the ACTIVE (non-exhausted) ballots, so the shares of surviving candidates
 * sum to 1 and a reader can tell at a glance who is over 50%.
 */
export function standingsFromSnapshot(
  snapshot: ResultSnapshot,
  entries: readonly PublicSubmissionDto[],
): StandingEntryDto[] {
  const finalRound = snapshot.rounds[snapshot.rounds.length - 1];

  const eliminatedIn = new Map<string, number>();
  for (const round of snapshot.rounds) {
    if (round.eliminated) eliminatedIn.set(round.eliminated, round.round);
  }

  const tallies: Record<string, number> = finalRound?.tallies ?? {};
  const talliedTotal = Object.values(tallies).reduce((sum, n) => sum + n, 0);
  // Prefer the round's own active count; fall back to the sum of tallies so a
  // degenerate snapshot yields 0 rather than NaN or Infinity.
  const denominator = finalRound && finalRound.activeBallots > 0 ? finalRound.activeBallots : talliedTotal;

  // Later elimination = better placing. The engine's `eliminationOrder` ends
  // with the winner, so the index doubles as a full ranking.
  const survival = new Map<string, number>();
  snapshot.eliminationOrder.forEach((id, index) => survival.set(id, index));

  return entries
    .map((entry): StandingEntryDto => {
      const votes = tallies[entry.id] ?? 0;
      return {
        submissionId: entry.id,
        alias: entry.alias,
        thumbUrl: entry.thumbUrl,
        votes,
        share: denominator > 0 ? votes / denominator : 0,
        eliminated: eliminatedIn.has(entry.id),
        eliminatedRound: eliminatedIn.get(entry.id) ?? null,
      };
    })
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      const sa = survival.get(a.submissionId) ?? -1;
      const sb = survival.get(b.submissionId) ?? -1;
      if (sb !== sa) return sb - sa;
      return (a.alias ?? '').localeCompare(b.alias ?? '');
    });
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * Snapshot -> wire shape. `computedBy` is destructured out and DISCARDED
 * rather than merely not copied, so a later careless spread cannot resurrect
 * it: which admin pressed the button is an audit-log fact, not part of the
 * public record of who won.
 */
export function toResultSnapshotDto(snapshot: ResultSnapshot): ResultsDto['snapshot'] {
  const { computedBy: _discarded, ...rest } = snapshot;
  return {
    ...rest,
    // Strip `decidedByUid` from every tie-break.
    //
    // A tie-break records WHICH ADMIN broke the tie. What makes the count
    // auditable is the round, the reason and the outcome — not the person, and
    // that person's identity belongs in the audit log, not in a payload every
    // member receives.
    //
    // It is always null today, which is exactly why this is easy to miss:
    // spreading `...rest` carries the field through, and `irv/count.ts` states
    // that "the persisting route stamps the uid". The day somebody implements
    // that comment, every member would silently start receiving an admin's
    // uid. Stripping here means that change cannot become a leak.
    rounds: rest.rounds.map((round) =>
      round.tieBreak ? { ...round, tieBreak: { ...round.tieBreak, decidedByUid: null } } : round,
    ),
    computedAt: snapshot.computedAt.toISOString(),
  };
}

/**
 * The winner's name.
 *
 * THIS IS THE ONE PLACE A NAME IS EVER REVEALED TO MEMBERS, and only if the
 * winner set `creditOptIn: true` at upload time. Anything else — no opt-in, no
 * user record, a blank display name — yields null. The email address is never
 * used as a fallback: opting in to being credited is not opting in to having
 * your address published.
 */
export async function winnerCreditFor(winner: Submission | null): Promise<string | null> {
  if (!winner || !winner.creditOptIn) return null;
  const user = (await usersCol().doc(winner.ownerUid).get()).data();
  const name = user?.displayName.trim() ?? '';
  return name.length > 0 ? name : null;
}

/** Build and validate the member-facing results payload. */
export async function buildResultsDto(
  snapshot: ResultSnapshot,
  viewerUid: string | null,
): Promise<ResultsDto> {
  const candidates = await loadCandidateSubmissions(snapshot.contestId);
  const entries = await toPublicDtos(candidates, viewerUid);

  const winnerSubmission = candidates.find((c) => c.id === snapshot.winnerSubmissionId) ?? null;
  const winner = entries.find((e) => e.id === snapshot.winnerSubmissionId) ?? null;
  const winnerCredit = await winnerCreditFor(winnerSubmission);

  // Parsed, not cast: `ResultsSchema` is the anonymity boundary, and parsing
  // strips anything that should not be on the wire instead of trusting us.
  return ResultsSchema.parse({
    snapshot: toResultSnapshotDto(snapshot),
    entries,
    winner,
    winnerCredit,
  });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function writeResultsAudit(
  contestId: string,
  actor: ResultsActor,
  action: 'results.publish' | 'results.unpublish',
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    contestId,
    actorUid: actor.uid,
    actorEmail: actor.email,
    action,
    targetType: 'contest',
    targetId: contestId,
    metadata,
  });
}
