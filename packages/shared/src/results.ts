import { z } from 'zod';

/**
 * Instant-runoff result types.
 *
 * A result is stored as a full round-by-round SNAPSHOT rather than recomputed
 * on read. That makes the outcome auditable ("show me exactly how round 3
 * went"), reproducible, and stable even if ballots are later touched.
 */

/** Why a candidate was eliminated when the tally alone did not decide it. */
export const TIE_BREAK_REASONS = [
  'fewest_previous_round',
  'fewest_total_appearances',
  'fewest_first_place',
  'seeded_shuffle',
  'admin_override',
] as const;
export const TieBreakReasonSchema = z.enum(TIE_BREAK_REASONS);
export type TieBreakReason = z.infer<typeof TieBreakReasonSchema>;

export const TIE_BREAK_LABELS: Record<TieBreakReason, string> = {
  fewest_previous_round: 'Fewest votes in the previous round',
  fewest_total_appearances: 'Appeared on the fewest ballots overall',
  fewest_first_place: 'Fewest first-place votes overall',
  seeded_shuffle: 'Resolved by the contest’s fixed random seed',
  admin_override: 'Chosen by an administrator',
};

export const TieBreakSchema = z.object({
  /** The candidates that were tied on the deciding number. */
  tiedCandidates: z.array(z.string()),
  reason: TieBreakReasonSchema,
  eliminated: z.string(),
  /** Set only for admin_override. */
  decidedByUid: z.string().nullable().default(null),
});
export type TieBreak = z.infer<typeof TieBreakSchema>;

/** Where one eliminated candidate's votes went. */
export const TransferSchema = z.object({
  from: z.string(),
  /** submissionId -> number of ballots moved there. */
  to: z.record(z.number().int().nonnegative()),
  /** Ballots with no surviving preference left. */
  exhausted: z.number().int().nonnegative(),
});
export type Transfer = z.infer<typeof TransferSchema>;

export const RoundSchema = z.object({
  round: z.number().int().positive(),
  /** submissionId -> votes held at the START of this round's count. */
  tallies: z.record(z.number().int().nonnegative()),
  /** Ballots still counting toward a candidate this round. */
  activeBallots: z.number().int().nonnegative(),
  /** Cumulative ballots with no surviving preference. */
  exhaustedBallots: z.number().int().nonnegative(),
  /** Null on the final round. */
  eliminated: z.string().nullable().default(null),
  transfer: TransferSchema.nullable().default(null),
  tieBreak: TieBreakSchema.nullable().default(null),
  /** Set on the round where someone crosses 50% of active ballots. */
  winner: z.string().nullable().default(null),
});
export type Round = z.infer<typeof RoundSchema>;

export const ResultSnapshotSchema = z.object({
  contestId: z.string().min(1),
  winnerSubmissionId: z.string().nullable(),
  rounds: z.array(RoundSchema),
  totalBallots: z.number().int().nonnegative(),
  /** Ballots exhausted by the final round. */
  exhaustedFinal: z.number().int().nonnegative(),
  /** Candidates in elimination order; last entry is the winner. */
  eliminationOrder: z.array(z.string()),
  tieBreakSeed: z.string(),
  computedAt: z.date(),
  computedBy: z.string().min(1),
  published: z.boolean().default(false),
  /** True for the running projection shown during voting. */
  isProjection: z.boolean().default(false),
});
export type ResultSnapshot = z.infer<typeof ResultSnapshotSchema>;

/**
 * Input to the counting engine. Deliberately anonymous: the engine never sees
 * who cast what, which makes it trivially safe to test and impossible to
 * misuse as a de-anonymisation path.
 */
export interface CountableBallot {
  /** Opaque, stable per ballot. NOT a user id. */
  ballotId: string;
  /** Ordered submission IDs, first preference first. */
  ranking: readonly string[];
}

export interface CountOptions {
  candidates: readonly string[];
  ballots: readonly CountableBallot[];
  tieBreakSeed: string;
  /** Pre-resolved admin tie-break decisions, keyed by sorted tied-candidate list. */
  adminTieBreaks?: Record<string, string>;
}
