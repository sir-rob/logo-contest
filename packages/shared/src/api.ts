import { z } from 'zod';
import { ContestPhaseSchema } from './phases.js';
import { RoleSchema, SubmissionStatusSchema } from './entities.js';
import { ResultSnapshotSchema } from './results.js';
import {
  MAX_CONTEST_CODE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RANKS,
  MAX_TITLE_LENGTH,
  MIN_CONTEST_CODE_LENGTH,
} from './constants.js';

/**
 * API data-transfer objects.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THIS FILE IS THE ANONYMITY BOUNDARY.
 *
 * These are the ONLY shapes a member-facing route may return. Note what is
 * absent from `PublicSubmissionDto`: there is no `ownerUid`, no uploader email,
 * no name. There is no DTO anywhere that carries another person's ballot,
 * because no endpoint exists that could return one.
 *
 * If you are adding a route: build its response from a DTO here. Do NOT
 * serialise a Firestore entity directly — the entity types carry server-only
 * fields and will leak them.
 * ══════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Submissions — the anonymous projection
// ---------------------------------------------------------------------------

export const PublicSubmissionSchema = z.object({
  id: z.string(),
  /** "Entry 07". Null before submissions close. */
  alias: z.string().nullable(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbUrl: z.string().url(),
  displayUrl: z.string().url(),
  width: z.number().int(),
  height: z.number().int(),
  /** True only for the signed-in caller's own entry. Never reveals anyone else. */
  isMine: z.boolean(),
});
export type PublicSubmissionDto = z.infer<typeof PublicSubmissionSchema>;

/** ADMIN-ONLY. Returned exclusively by the audited moderation route. */
export const ModerationSubmissionSchema = PublicSubmissionSchema.extend({
  ownerUid: z.string(),
  ownerEmail: z.string().email(),
  ownerDisplayName: z.string(),
  status: SubmissionStatusSchema,
  disqualifiedReason: z.string().optional(),
  contentHash: z.string(),
  /** Other entries sharing this hash — flags accidental or deliberate duplicates. */
  duplicateOf: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});
export type ModerationSubmissionDto = z.infer<typeof ModerationSubmissionSchema>;

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export const MeSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  role: RoleSchema,
  /** Contests the caller has registered for. */
  registeredContestIds: z.array(z.string()).default([]),
  /** The caller's own entry, or null. */
  mySubmission: PublicSubmissionSchema.nullable(),
  /** The caller's own ranking. Only ever their own. */
  myBallot: z.array(z.string()).nullable(),
});
export type MeDto = z.infer<typeof MeSchema>;

// ---------------------------------------------------------------------------
// Contest
// ---------------------------------------------------------------------------

export const ContestPublicSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** Unique contest registration code. */
  code: z.string().optional(),
  phase: ContestPhaseSchema,
  submissionsOpenAt: z.string().datetime().nullable(),
  submissionsCloseAt: z.string().datetime().nullable(),
  votingOpensAt: z.string().datetime().nullable(),
  votingClosesAt: z.string().datetime().nullable(),
  maxRanks: z.number().int(),
  allowSelfVote: z.boolean(),
  showLiveStandings: z.boolean(),
  /** Server time, so clients can run an accurate countdown despite clock skew. */
  serverNow: z.string().datetime(),
});
export type ContestPublicDto = z.infer<typeof ContestPublicSchema>;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const StandingEntrySchema = z.object({
  submissionId: z.string(),
  alias: z.string().nullable(),
  thumbUrl: z.string().url(),
  votes: z.number().int().nonnegative(),
  /** Share of active (non-exhausted) ballots, 0..1. */
  share: z.number(),
  eliminated: z.boolean(),
  eliminatedRound: z.number().int().nullable(),
});
export type StandingEntryDto = z.infer<typeof StandingEntrySchema>;

export const DashboardSchema = z.object({
  phase: ContestPhaseSchema,
  eligibleVoters: z.number().int().nonnegative(),
  submissionCount: z.number().int().nonnegative(),
  ballotsCast: z.number().int().nonnegative(),
  iHaveSubmitted: z.boolean(),
  iHaveVoted: z.boolean(),
  closesAt: z.string().datetime().nullable(),
  serverNow: z.string().datetime(),
  /** Live IRV projection. Null when hidden or not yet meaningful. */
  standings: z.array(StandingEntrySchema).nullable(),
  standingsHiddenReason: z.string().nullable(),
});
export type DashboardDto = z.infer<typeof DashboardSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const ResultsSchema = z.object({
  snapshot: ResultSnapshotSchema.omit({ computedBy: true }).extend({
    computedAt: z.string().datetime(),
  }),
  /** Alias + image for every candidate, so the client can render without a join. */
  entries: z.array(PublicSubmissionSchema),
  winner: PublicSubmissionSchema.nullable(),
  /** Revealed only if the winner opted in at upload time. */
  winnerCredit: z.string().nullable(),
});
export type ResultsDto = z.infer<typeof ResultsSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const RequestMagicLinkSchema = z.object({
  email: z.string().email(),
});
export type RequestMagicLinkBody = z.infer<typeof RequestMagicLinkSchema>;

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
});
export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;

export const SubmissionMetaSchema = z.object({
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  creditOptIn: z.coerce.boolean().default(false),
});
export type SubmissionMetaBody = z.infer<typeof SubmissionMetaSchema>;

export const SaveBallotSchema = z.object({
  ranking: z
    .array(z.string().min(1))
    .min(1, 'Rank at least one entry.')
    .max(MAX_RANKS)
    .refine((r) => new Set(r).size === r.length, { message: 'Each entry can only be ranked once.' }),
});
export type SaveBallotBody = z.infer<typeof SaveBallotSchema>;

export const JoinContestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(MIN_CONTEST_CODE_LENGTH, 'Enter a valid contest code.')
    .max(MAX_CONTEST_CODE_LENGTH, `Contest code must be at most ${MAX_CONTEST_CODE_LENGTH} characters.`),
});
export type JoinContestBody = z.infer<typeof JoinContestSchema>;

export const CreateContestSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Contest ID may only contain lowercase letters, numbers and hyphens.')
    .optional(),
  title: z.string().trim().min(1, 'Give the contest a title.').max(120),
  description: z.string().max(2000).optional(),
  code: z
    .string()
    .trim()
    .min(MIN_CONTEST_CODE_LENGTH, `Code must be at least ${MIN_CONTEST_CODE_LENGTH} characters.`)
    .max(MAX_CONTEST_CODE_LENGTH, `Code must be at most ${MAX_CONTEST_CODE_LENGTH} characters.`)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may only use letters, numbers, hyphens or underscores.'),
  submissionsOpenAt: z.string().datetime().nullable().optional(),
  submissionsCloseAt: z.string().datetime().nullable().optional(),
  votingOpensAt: z.string().datetime().nullable().optional(),
  votingClosesAt: z.string().datetime().nullable().optional(),
  maxRanks: z.number().int().min(1).max(MAX_RANKS).optional(),
  allowSelfVote: z.boolean().optional(),
  showLiveStandings: z.boolean().optional(),
  minBallotsToPublish: z.number().int().min(1).optional(),
});
export type CreateContestBody = z.infer<typeof CreateContestSchema>;

export const UpdateContestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  code: z
    .string()
    .trim()
    .min(MIN_CONTEST_CODE_LENGTH, `Code must be at least ${MIN_CONTEST_CODE_LENGTH} characters.`)
    .max(MAX_CONTEST_CODE_LENGTH, `Code must be at most ${MAX_CONTEST_CODE_LENGTH} characters.`)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may only use letters, numbers, hyphens or underscores.')
    .optional(),
  submissionsOpenAt: z.string().datetime().nullable().optional(),
  submissionsCloseAt: z.string().datetime().nullable().optional(),
  votingOpensAt: z.string().datetime().nullable().optional(),
  votingClosesAt: z.string().datetime().nullable().optional(),
  allowSelfVote: z.boolean().optional(),
  showLiveStandings: z.boolean().optional(),
  minBallotsToPublish: z.number().int().min(1).optional(),
});
export type UpdateContestBody = z.infer<typeof UpdateContestSchema>;

export const SetPhaseSchema = z.object({
  phase: ContestPhaseSchema.nullable(),
});
export type SetPhaseBody = z.infer<typeof SetPhaseSchema>;

export const SetRoleSchema = z.object({
  role: RoleSchema,
});
export type SetRoleBody = z.infer<typeof SetRoleSchema>;

export const DisqualifySchema = z.object({
  reason: z.string().min(1).max(500),
});
export type DisqualifyBody = z.infer<typeof DisqualifySchema>;

export const ResolveTieSchema = z.object({
  tiedCandidates: z.array(z.string()).min(2),
  eliminate: z.string().min(1),
});
export type ResolveTieBody = z.infer<typeof ResolveTieSchema>;

// ---------------------------------------------------------------------------
// Admin read models
// ---------------------------------------------------------------------------

/**
 * Turnout shows WHO has voted, never WHAT they voted. That distinction is the
 * whole design: it lets an admin chase stragglers without touching ballot
 * secrecy.
 */
export const TurnoutRowSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  role: RoleSchema,
  hasSubmitted: z.boolean(),
  hasVoted: z.boolean(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type TurnoutRowDto = z.infer<typeof TurnoutRowSchema>;

export const AuditRowSchema = z.object({
  id: z.string(),
  actorEmail: z.string().email(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()),
  at: z.string().datetime(),
});
export type AuditRowDto = z.infer<typeof AuditRowSchema>;
