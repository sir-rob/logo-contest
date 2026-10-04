/**
 * Admin operations — contest configuration, moderation, turnout, audit.
 *
 * Three things in this file carry more weight than the rest:
 *
 *  1. `GET /admin/submissions` is the ONLY route in the entire API that
 *     reveals who uploaded what. It writes an audit entry BEFORE it answers,
 *     every single time, with no opt-out. That log line is the compensating
 *     control for lifting anonymity.
 *  2. `GET /admin/turnout` reports WHO voted and never WHAT. It reads ballot
 *     documents through a field projection that physically excludes `ranking`,
 *     so the contents cannot reach this process even by accident.
 *  3. Every mutation writes an audit entry. No exceptions.
 *
 * Responses are built from the DTOs in `@contest/shared` and `.parse()`d on
 * the way out, so a schema drift fails loudly here rather than silently
 * leaking a field to a client.
 */

import type { FastifyInstance } from 'fastify';
import { FieldValue, type UpdateData } from 'firebase-admin/firestore';
import {
  ApiError,
  AuditRowSchema,
  ContestPublicSchema,
  DisqualifySchema,
  ModerationSubmissionSchema,
  SetPhaseSchema,
  TurnoutRowSchema,
  UpdateContestSchema,
  UserSchema,
  validateContestDates,
  type AuditRowDto,
  type Contest,
  type ContestPublicDto,
  type ModerationSubmissionDto,
  type Submission,
  type TurnoutRowDto,
  type User,
} from '@contest/shared';
import { getConfig, now } from '../config.js';
import { getDb } from '../firebase.js';
import {
  auditLogsCol,
  ballotsCol,
  contestDoc,
  submissionDoc,
  submissionsCol,
  userDoc,
  usersCol,
} from '../db/collections.js';
import { fromIso, timestampsToDates, toIso } from '../db/converters.js';
import { principalOf } from '../plugins/auth.js';
import { auditToDto, isAuditAction, writeAudit } from '../services/audit.js';
import { contestToDto, loadContest, loadDefaultContest, phaseOf } from '../services/contest.js';
import { toModerationDto } from '../services/submission-dto.js';

// ---------------------------------------------------------------------------
// Pure helpers — no Firestore, no Fastify, unit-tested in admin.test.ts
// ---------------------------------------------------------------------------

/** The four admin-editable dates, as stored. */
export interface ContestDateFields {
  submissionsOpenAt: Date | null;
  submissionsCloseAt: Date | null;
  votingOpensAt: Date | null;
  votingClosesAt: Date | null;
}

/**
 * The same four fields as they arrive on the wire.
 *
 * The three states are distinct and all meaningful:
 *   - absent / `undefined` → leave whatever is stored alone
 *   - `null`               → clear the date
 *   - ISO string           → set it
 */
export type ContestDatePatch = {
  [K in keyof ContestDateFields]?: string | null;
};

export const CONTEST_DATE_KEYS = [
  'submissionsOpenAt',
  'submissionsCloseAt',
  'votingOpensAt',
  'votingClosesAt',
] as const satisfies readonly (keyof ContestDateFields)[];

/**
 * Apply a patch to the stored dates.
 *
 * Returns the FULL set, not just what changed, because coherence is a property
 * of the whole timeline: moving `votingOpensAt` earlier can invalidate a
 * `submissionsCloseAt` nobody touched. Validating the merged result is the
 * only way to catch that.
 */
export function mergeContestDates(existing: ContestDateFields, patch: ContestDatePatch): ContestDateFields {
  const pick = (key: keyof ContestDateFields): Date | null => {
    const supplied = patch[key];
    if (supplied === undefined) return existing[key];
    const parsed = fromIso(supplied);
    if (parsed !== null && Number.isNaN(parsed.getTime())) {
      throw new ApiError('VALIDATION_FAILED', `${key} is not a valid date.`, { [key]: 'Not a valid date.' });
    }
    return parsed;
  };

  return {
    submissionsOpenAt: pick('submissionsOpenAt'),
    submissionsCloseAt: pick('submissionsCloseAt'),
    votingOpensAt: pick('votingOpensAt'),
    votingClosesAt: pick('votingClosesAt'),
  };
}

/**
 * Reject an incoherent timeline.
 *
 * Delegates to `validateContestDates` in `@contest/shared` so the admin UI and
 * the API refuse the same nonsense with the same words.
 */
export function assertContestDatesValid(merged: ContestDateFields): void {
  const errors = validateContestDates(merged);
  if (errors.length === 0) return;
  // `errors[0]` is `string | undefined` under noUncheckedIndexedAccess even
  // though we just checked the length; the fallback keeps the field detail a
  // plain string for the client.
  throw new ApiError('VALIDATION_FAILED', errors.join(' '), { dates: errors[0] ?? 'Invalid contest dates.' });
}

/** One field's before/after, in the ISO spelling the audit table renders. */
export interface FieldChange {
  before: string | null;
  after: string | null;
}

/**
 * Which fields actually changed, and to what.
 *
 * Only genuine changes are recorded: re-saving the admin form without editing
 * anything should not litter the audit log with no-op entries.
 */
export function diffContestFields(
  before: Record<string, string | number | boolean | null>,
  after: Record<string, string | number | boolean | null>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key] ?? null;
    const next = after[key] ?? null;
    if (prev === next) continue;
    changes[key] = {
      before: prev === null ? null : String(prev),
      after: next === null ? null : String(next),
    };
  }
  return changes;
}

/**
 * Group entries by content hash.
 *
 * Every id maps to the OTHER ids sharing its hash — a singleton maps to `[]`,
 * not to itself. A non-empty list means the same image was uploaded twice:
 * either an accidental re-upload or one member copying another's work. The
 * moderator decides which; this only flags it.
 */
export function computeDuplicateGroups(subs: readonly { id: string; contentHash: string }[]): Record<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const sub of subs) {
    const seen = byHash.get(sub.contentHash);
    if (seen) seen.push(sub.id);
    else byHash.set(sub.contentHash, [sub.id]);
  }

  const groups: Record<string, string[]> = {};
  for (const sub of subs) {
    const sharing = byHash.get(sub.contentHash) ?? [];
    groups[sub.id] = sharing.filter((id) => id !== sub.id);
  }
  return groups;
}

/**
 * Non-voters first, then by display name.
 *
 * This view exists to chase stragglers, so the people who still need chasing
 * belong at the top where they cannot be missed.
 */
export function sortTurnout<T extends { hasVoted: boolean; displayName: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.hasVoted !== b.hasVoted) return a.hasVoted ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Most recent audit rows returned in one page.
 *
 * Also the scan window when `?action=` is set: the filter is applied in
 * memory over the newest 500 entries rather than pushed into the query,
 * because an `action ASC, at DESC` composite index is not among the ones this
 * project deploys. At the scale of a single team contest the whole log fits
 * well inside the window; if it ever does not, add the index and move the
 * `where` into the query.
 */
const AUDIT_PAGE_LIMIT = 500;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * PATCH /admin/contest — edit the timeline and the config knobs.
   *
   * The merged timeline is validated, never just the supplied fields: a lone
   * `votingOpensAt` edit can invalidate a `submissionsCloseAt` the admin never
   * touched, and rejecting that is the entire point.
   */
  app.patch('/admin/contest', { preHandler: app.requireAdmin }, async (request): Promise<ContestPublicDto> => {
    const principal = principalOf(request);
    const body = UpdateContestSchema.parse(request.body);
    const config = getConfig();
    const existing = await loadDefaultContest(config);

    const mergedDates = mergeContestDates(existing, body);
    assertContestDatesValid(mergedDates);

    const before: Record<string, string | number | boolean | null> = {
      title: existing.title,
      description: existing.description,
      submissionsOpenAt: toIso(existing.submissionsOpenAt),
      submissionsCloseAt: toIso(existing.submissionsCloseAt),
      votingOpensAt: toIso(existing.votingOpensAt),
      votingClosesAt: toIso(existing.votingClosesAt),
      allowSelfVote: existing.allowSelfVote,
      showLiveStandings: existing.showLiveStandings,
      minBallotsToPublish: existing.minBallotsToPublish,
    };
    const after: Record<string, string | number | boolean | null> = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      submissionsOpenAt: toIso(mergedDates.submissionsOpenAt),
      submissionsCloseAt: toIso(mergedDates.submissionsCloseAt),
      votingOpensAt: toIso(mergedDates.votingOpensAt),
      votingClosesAt: toIso(mergedDates.votingClosesAt),
      allowSelfVote: body.allowSelfVote ?? existing.allowSelfVote,
      showLiveStandings: body.showLiveStandings ?? existing.showLiveStandings,
      minBallotsToPublish: body.minBallotsToPublish ?? existing.minBallotsToPublish,
    };

    // Write only what was actually supplied. A PATCH that omits a field must
    // not clobber a concurrent edit to it.
    const update: UpdateData<Contest> = { updatedAt: now(config) };
    if (body.title !== undefined) update.title = body.title;
    if (body.description !== undefined) update.description = body.description;
    if (body.submissionsOpenAt !== undefined) update.submissionsOpenAt = mergedDates.submissionsOpenAt;
    if (body.submissionsCloseAt !== undefined) update.submissionsCloseAt = mergedDates.submissionsCloseAt;
    if (body.votingOpensAt !== undefined) update.votingOpensAt = mergedDates.votingOpensAt;
    if (body.votingClosesAt !== undefined) update.votingClosesAt = mergedDates.votingClosesAt;
    if (body.allowSelfVote !== undefined) update.allowSelfVote = body.allowSelfVote;
    if (body.showLiveStandings !== undefined) update.showLiveStandings = body.showLiveStandings;
    if (body.minBallotsToPublish !== undefined) update.minBallotsToPublish = body.minBallotsToPublish;

    await contestDoc(existing.id).update(update);

    const changed = diffContestFields(before, after);
    await writeAudit(
      {
        contestId: existing.id,
        actorUid: principal.uid,
        actorEmail: principal.email,
        action: 'contest.update',
        targetType: 'contest',
        targetId: existing.id,
        metadata: { changedFields: Object.keys(changed), changes: changed },
      },
      request.log,
    );

    // Re-read rather than patch the in-memory copy: the response is what the
    // database actually holds, including the freshly derived phase.
    const refreshed = await loadContest(existing.id);
    return ContestPublicSchema.parse(contestToDto(refreshed, config));
  });

  /**
   * POST /admin/contest/phase — force a phase, or hand control back to the clock.
   *
   * An override beats the clock outright — that is `derivePhase`'s documented
   * precedence, checked before any date is looked at. This is the "just close
   * it now" and "reopen for 10 more minutes" escape hatch. Passing `null`
   * clears it and returns the contest to clock-derived behaviour.
   */
  app.post('/admin/contest/phase', { preHandler: app.requireAdmin }, async (request): Promise<ContestPublicDto> => {
    const principal = principalOf(request);
    const { phase } = SetPhaseSchema.parse(request.body);
    const config = getConfig();
    const existing = await loadDefaultContest(config);

    const from = existing.phaseOverride;
    // What the clock alone would say, recorded so the log explains what the
    // override actually changed rather than just that one was set.
    const derivedPhaseNow = phaseOf({ ...existing, phaseOverride: null }, config);

    const update: UpdateData<Contest> = { phaseOverride: phase, updatedAt: now(config) };
    await contestDoc(existing.id).update(update);

    await writeAudit(
      {
        contestId: existing.id,
        actorUid: principal.uid,
        actorEmail: principal.email,
        action: 'contest.phase_override',
        targetType: 'contest',
        targetId: existing.id,
        metadata: { from, to: phase, derivedPhaseNow },
      },
      request.log,
    );

    // Returned refreshed so the UI sees the effective phase immediately.
    const refreshed = await loadContest(existing.id);
    return ContestPublicSchema.parse(contestToDto(refreshed, config));
  });

  /**
   * GET /admin/submissions — THE MODERATION VIEW.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THIS IS THE ONLY PLACE IN THE ENTIRE API WHERE UPLOADER IDENTITY IS
   * REVEALED.
   *
   * Every access is logged, without exception. The `moderation.view_identities`
   * audit entry is written BEFORE any identity is returned — not after, not
   * conditionally, not only on the first call in a session. That log line is
   * the compensating control that makes lifting anonymity acceptable at all:
   * anonymity here is protected by accountability, not by access denial.
   *
   * If you are tempted to skip the audit write on a "cheap" path through this
   * handler — don't. There is no such path.
   * ═══════════════════════════════════════════════════════════════════════
   */
  app.get(
    '/admin/submissions',
    { preHandler: app.requireAdmin },
    async (request): Promise<{ submissions: ModerationSubmissionDto[] }> => {
      const principal = principalOf(request);
      const config = getConfig();
      const contestId = config.defaultContestId;

      // Every status: moderation needs to see withdrawn and already
      // disqualified entries, not just the standing ones.
      const snap = await submissionsCol().where('contestId', '==', contestId).get();
      const submissions: Submission[] = snap.docs.map((doc) => doc.data());

      // Ordered oldest-first. Sorted here rather than with `orderBy` because
      // `contestId` + `createdAt` is not one of the deployed composite
      // indexes, and one contest's entries are a small, bounded list.
      submissions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // ── The audit write happens HERE, before a single identity is loaded. ──
      await writeAudit(
        {
          contestId,
          actorUid: principal.uid,
          actorEmail: principal.email,
          action: 'moderation.view_identities',
          targetType: 'contest',
          targetId: contestId,
          metadata: { count: submissions.length },
        },
        request.log,
      );

      // Batch-load owners in one round trip — never one read per submission.
      const ownerUids = [...new Set(submissions.map((s) => s.ownerUid))];
      const owners = new Map<string, User>();
      if (ownerUids.length > 0) {
        // `Firestore.getAll` erases the per-ref converter (its only overload
        // returns untyped snapshots), so the parse the `userConverter` would
        // have done is repeated here by hand — same schema, same injected
        // `uid`, same Timestamp→Date normalisation. Still one round trip.
        const ownerSnaps = await getDb().getAll(...ownerUids.map((uid) => userDoc(uid)));
        for (const ownerSnap of ownerSnaps) {
          try {
            if (!ownerSnap.exists) continue;
            const raw = timestampsToDates(ownerSnap.data()) as Record<string, unknown>;
            const user = UserSchema.parse({ ...raw, uid: ownerSnap.id });
            owners.set(user.uid, user);
          } catch (err) {
            // A deleted or malformed user doc must not take down the whole
            // moderation view; `toModerationDto` renders a placeholder.
            request.log.warn({ err, uid: ownerSnap.id }, 'skipping unreadable user doc in moderation view');
          }
        }
      }

      const duplicates = computeDuplicateGroups(
        submissions.map((s) => ({ id: s.id, contentHash: s.contentHash })),
      );

      const dtos = await Promise.all(
        submissions.map((submission) =>
          toModerationDto(submission, owners.get(submission.ownerUid) ?? null, duplicates[submission.id] ?? []),
        ),
      );

      return { submissions: dtos.map((dto) => ModerationSubmissionSchema.parse(dto)) };
    },
  );

  /**
   * POST /admin/submissions/:id/disqualify
   *
   * Note: disqualification does NOT rewrite anybody's ballot. The counting
   * engine skips candidates that are not standing, which is the correct
   * behaviour under IRV — a voter's later preferences still count, exactly as
   * if their top choice had been eliminated in an earlier round. Editing
   * ballots to remove the entry would silently discard those preferences.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/admin/submissions/:id/disqualify',
    { preHandler: app.requireAdmin },
    async (request): Promise<{ ok: true }> => {
      const principal = principalOf(request);
      const { reason } = DisqualifySchema.parse(request.body);
      const submissionId = request.params.id;
      const config = getConfig();

      const snap = await submissionDoc(submissionId).get();
      const submission = snap.data();
      if (!submission) throw new ApiError('SUBMISSION_NOT_FOUND');

      const update: UpdateData<Submission> = {
        status: 'disqualified',
        disqualifiedReason: reason,
        updatedAt: now(config),
      };
      await submissionDoc(submissionId).update(update);

      // The owner's email is deliberately NOT in this metadata. The target id
      // identifies the entry, and the one route that maps an entry to a person
      // is itself audited — there is no need to copy an identity in here.
      await writeAudit(
        {
          contestId: submission.contestId,
          actorUid: principal.uid,
          actorEmail: principal.email,
          action: 'submission.disqualify',
          targetType: 'submission',
          targetId: submissionId,
          metadata: { reason },
        },
        request.log,
      );

      return { ok: true };
    },
  );

  /** POST /admin/submissions/:id/reinstate — undo a disqualification. */
  app.post<{ Params: { id: string } }>(
    '/admin/submissions/:id/reinstate',
    { preHandler: app.requireAdmin },
    async (request): Promise<{ ok: true }> => {
      const principal = principalOf(request);
      const submissionId = request.params.id;
      const config = getConfig();

      const snap = await submissionDoc(submissionId).get();
      const submission = snap.data();
      if (!submission) throw new ApiError('SUBMISSION_NOT_FOUND');

      const update: UpdateData<Submission> = {
        status: 'active',
        // Deleted rather than blanked: a stale reason on a standing entry
        // would read as though it were still disqualified.
        disqualifiedReason: FieldValue.delete(),
        updatedAt: now(config),
      };
      await submissionDoc(submissionId).update(update);

      await writeAudit(
        {
          contestId: submission.contestId,
          actorUid: principal.uid,
          actorEmail: principal.email,
          action: 'submission.reinstate',
          targetType: 'submission',
          targetId: submissionId,
          metadata: { previousStatus: submission.status },
        },
        request.log,
      );

      return { ok: true };
    },
  );

  /**
   * GET /admin/turnout — WHO VOTED, NEVER WHAT.
   *
   * The distinction is the whole design: an admin can chase the people who
   * have not voted yet without ever learning how anyone voted.
   *
   * "Has voted" is determined purely from the EXISTENCE of the ballot
   * document. The query below uses a `.select('voterUid', 'updatedAt')`
   * projection, which is a deliberate safety measure and NOT an optimisation:
   * it means the `ranking` array is never transferred into this process, so
   * there is no variable in this handler that could leak it, however the code
   * below is later edited. The raw (converter-less) handle is used for the
   * same reason — the typed converter would parse whole ballots.
   */
  app.get(
    '/admin/turnout',
    { preHandler: app.requireAdmin },
    async (): Promise<{ rows: TurnoutRowDto[]; eligible: number; voted: number }> => {
      const config = getConfig();
      const contestId = config.defaultContestId;

      const [userSnap, ballotSnap, submissionSnap] = await Promise.all([
        usersCol().get(),
        ballotsCol()
          .withConverter(null)
          .where('contestId', '==', contestId)
          .select('voterUid', 'updatedAt')
          .get(),
        submissionsCol().withConverter(null).where('contestId', '==', contestId).select('ownerUid').get(),
      ]);

      const votedUids = new Set<string>();
      for (const doc of ballotSnap.docs) {
        const voterUid: unknown = doc.get('voterUid');
        if (typeof voterUid === 'string') votedUids.add(voterUid);
      }

      const submittedUids = new Set<string>();
      for (const doc of submissionSnap.docs) {
        const ownerUid: unknown = doc.get('ownerUid');
        if (typeof ownerUid === 'string') submittedUids.add(ownerUid);
      }

      // A row exists for every eligible member, voted or not — the non-voters
      // are the reason this view exists.
      const rows: TurnoutRowDto[] = userSnap.docs.map((doc) => {
        const user = doc.data();
        return {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          hasSubmitted: submittedUids.has(user.uid),
          hasVoted: votedUids.has(user.uid),
          lastSeenAt: toIso(user.lastSeenAt),
        };
      });

      const sorted = sortTurnout(rows).map((row) => TurnoutRowSchema.parse(row));
      return {
        rows: sorted,
        eligible: sorted.length,
        voted: sorted.filter((row) => row.hasVoted).length,
      };
    },
  );

  /** GET /admin/audit — the accountability record, most recent first. */
  app.get<{ Querystring: { action?: string } }>(
    '/admin/audit',
    { preHandler: app.requireAdmin },
    async (request): Promise<{ rows: AuditRowDto[] }> => {
      const actionFilter = request.query.action;
      if (actionFilter !== undefined && !isAuditAction(actionFilter)) {
        throw new ApiError('VALIDATION_FAILED', 'Unknown audit action.', { action: 'Unknown audit action.' });
      }

      const snap = await auditLogsCol().orderBy('at', 'desc').limit(AUDIT_PAGE_LIMIT).get();
      const entries = snap.docs
        .map((doc) => doc.data())
        .filter((entry) => actionFilter === undefined || entry.action === actionFilter);

      return { rows: entries.map((entry) => AuditRowSchema.parse(auditToDto(entry))) };
    },
  );
}
