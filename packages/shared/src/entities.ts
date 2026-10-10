import { z } from 'zod';
import { ContestPhaseSchema } from './phases.js';
import {
  DEFAULT_CONTEST_CODE,
  MAX_CONTEST_CODE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RANKS,
  MAX_TITLE_LENGTH,
  MIN_RANKS,
} from './constants.js';

/**
 * Firestore document shapes.
 *
 * PRIVACY NOTE: several fields here are server-only and must never reach a
 * member-facing response — `Submission.ownerUid` and the whole `Ballot`
 * document above all. The DTOs in `api.ts` are the safe projections; build
 * responses from those, never by serialising these types directly.
 */

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const RoleSchema = z.enum(['member', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().max(MAX_DISPLAY_NAME_LENGTH),
  role: RoleSchema,
  /** Contests this user has registered for using a contest code. */
  registeredContestIds: z.array(z.string().min(1)).default([]),
  createdAt: z.date(),
  lastSeenAt: z.date(),
});
export type User = z.infer<typeof UserSchema>;

// ---------------------------------------------------------------------------
// Contest
// ---------------------------------------------------------------------------

export const ContestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  /** Unique access code participants enter to register for this contest. */
  code: z.string().min(1).max(MAX_CONTEST_CODE_LENGTH).default(DEFAULT_CONTEST_CODE),

  phaseOverride: ContestPhaseSchema.nullable().default(null),
  submissionsOpenAt: z.date().nullable().default(null),
  submissionsCloseAt: z.date().nullable().default(null),
  votingOpensAt: z.date().nullable().default(null),
  votingClosesAt: z.date().nullable().default(null),
  resultsPublishedAt: z.date().nullable().default(null),

  maxRanks: z.number().int().min(1).max(MAX_RANKS).default(MAX_RANKS),
  allowSelfVote: z.boolean().default(true),
  showLiveStandings: z.boolean().default(true),
  minBallotsToPublish: z.number().int().min(1).default(5),

  /** Stored so any recount reproduces identical tie-breaks. */
  tieBreakSeed: z.string().min(1),
  /** Aliases are assigned in a shuffled order when submissions close. */
  aliasesAssignedAt: z.date().nullable().default(null),

  createdBy: z.string().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Contest = z.infer<typeof ContestSchema>;

/**
 * Dates must be coherent. Caught here rather than in a route so the admin UI
 * and the API reject the same nonsense with the same message.
 */
export const validateContestDates = (c: {
  submissionsOpenAt: Date | null;
  submissionsCloseAt: Date | null;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
}): string[] => {
  const errors: string[] = [];
  const { submissionsOpenAt: so, submissionsCloseAt: sc, votingOpensAt: vo, votingClosesAt: vc } = c;
  if (so && sc && sc <= so) errors.push('Submissions must close after they open.');
  if (vo && vc && vc <= vo) errors.push('Voting must close after it opens.');
  if (sc && vo && vo < sc) {
    errors.push('Voting cannot open before submissions close — early voters would never see late entries.');
  }
  return errors;
};

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export const SubmissionStatusSchema = z.enum(['active', 'withdrawn', 'disqualified']);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const SubmissionSchema = z.object({
  id: z.string().min(1),
  contestId: z.string().min(1),

  /** SERVER-ONLY. Never serialise to a member. */
  ownerUid: z.string().min(1),

  /** Anonymous public label. Null until submissions close. */
  alias: z.string().nullable().default(null),

  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  /** Opt-in to being named if this entry wins. */
  creditOptIn: z.boolean().default(false),

  originalPath: z.string().min(1),
  displayPath: z.string().min(1),
  thumbPath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  /** SHA-256 of the normalised image, for duplicate detection. */
  contentHash: z.string().min(1),

  status: SubmissionStatusSchema.default('active'),
  disqualifiedReason: z.string().max(500).optional(),

  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

// ---------------------------------------------------------------------------
// Ballot
// ---------------------------------------------------------------------------

/**
 * SERVER-ONLY IN ITS ENTIRETY. There is no endpoint that lists ballots, and no
 * admin view of ballot contents. Only the owner may read their own, and only
 * aggregate tallies are ever exposed.
 */
export const BallotSchema = z.object({
  contestId: z.string().min(1),
  voterUid: z.string().min(1),
  /** Ordered, index 0 = first preference. Distinct submission IDs. */
  ranking: z.array(z.string().min(1)).min(MIN_RANKS).max(MAX_RANKS),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Ballot = z.infer<typeof BallotSchema>;

/** A ranking is valid only if it has no duplicates. */
export const rankingHasNoDuplicates = (ranking: readonly string[]): boolean =>
  new Set(ranking).size === ranking.length;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  'admin.promote',
  'admin.demote',
  'contest.create',
  'contest.update',
  'contest.phase_override',
  'submission.disqualify',
  'submission.reinstate',
  'moderation.view_identities',
  'results.compute',
  'results.publish',
  'results.unpublish',
  'results.tiebreak_override',
  'export.ballots',
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogSchema = z.object({
  id: z.string().min(1),
  contestId: z.string().nullable().default(null),
  actorUid: z.string().min(1),
  actorEmail: z.string().email(),
  action: AuditActionSchema,
  targetType: z.string().nullable().default(null),
  targetId: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
  at: z.date(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
