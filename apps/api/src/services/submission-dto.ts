/**
 * Submission → DTO projection.
 *
 * THIS IS THE ANONYMITY CHOKE POINT. Every route that returns an entry to a
 * member builds it here, and this function has no way to emit `ownerUid` —
 * it is destructured out and discarded rather than merely "not copied", so a
 * later careless spread cannot resurrect it.
 *
 * The admin moderation projection lives in the same file on purpose: putting
 * the safe and unsafe shapes side by side makes the difference between them
 * impossible to miss during review.
 */

import type { ModerationSubmissionDto, PublicSubmissionDto, Submission, User } from '@contest/shared';
import { signedReadUrl } from './storage.js';

/**
 * The only shape a member-facing route may return.
 *
 * `viewerUid` is used solely to set `isMine`. It never widens what is
 * returned about anyone else.
 */
export async function toPublicDto(submission: Submission, viewerUid: string | null): Promise<PublicSubmissionDto> {
  const [thumbUrl, displayUrl] = await Promise.all([
    signedReadUrl(submission.thumbPath),
    signedReadUrl(submission.displayPath),
  ]);
  const dto: PublicSubmissionDto = {
    id: submission.id,
    alias: submission.alias,
    thumbUrl,
    displayUrl,
    width: submission.width,
    height: submission.height,
    isMine: viewerUid !== null && submission.ownerUid === viewerUid,
  };
  if (submission.title) dto.title = submission.title;
  if (submission.description) dto.description = submission.description;
  return dto;
}

export async function toPublicDtos(
  submissions: readonly Submission[],
  viewerUid: string | null,
): Promise<PublicSubmissionDto[]> {
  return Promise.all(submissions.map((s) => toPublicDto(s, viewerUid)));
}

/**
 * ADMIN-ONLY, and only from the audited moderation route.
 *
 * Callers must have written an `moderation.view_identities` audit entry before
 * calling this. There is no technical way to enforce that from here, which is
 * why the route is the only caller and the review bar on it is high.
 */
export async function toModerationDto(
  submission: Submission,
  owner: User | null,
  duplicateOf: string[],
): Promise<ModerationSubmissionDto> {
  const base = await toPublicDto(submission, null);
  const dto: ModerationSubmissionDto = {
    ...base,
    ownerUid: submission.ownerUid,
    ownerEmail: owner?.email ?? 'unknown@invalid.local',
    ownerDisplayName: owner?.displayName ?? '(deleted account)',
    status: submission.status,
    contentHash: submission.contentHash,
    duplicateOf,
    createdAt: submission.createdAt.toISOString(),
  };
  if (submission.disqualifiedReason) dto.disqualifiedReason = submission.disqualifiedReason;
  return dto;
}
