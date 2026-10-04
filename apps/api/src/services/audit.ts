/**
 * Audit log.
 *
 * Two jobs. The obvious one is accountability for admin actions. The less
 * obvious and more important one: every single time an admin looks at
 * uploader identities, that view is recorded. The moderation screen is the one
 * place anonymity is lifted, so it is the one place that must leave a trace.
 *
 * Writes are best-effort and never block the action being audited — a failed
 * log line should not roll back a legitimate disqualification — but a failure
 * is logged loudly.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { AUDIT_ACTIONS, type AuditAction, type AuditLog, type AuditRowDto } from '@contest/shared';
import { auditLogsCol } from '../db/collections.js';
import { now } from '../config.js';

export interface AuditEntryInput {
  contestId?: string | null;
  actorUid: string;
  actorEmail: string;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Metadata is admin-supplied and ends up in an admin-visible table. Ballot
 * contents must never find their way in here, so anything that looks like a
 * ranking is stripped as a belt-and-braces measure.
 */
function sanitiseMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'ranking' || k === 'ballot' || k === 'ballots') continue;
    out[k] = v;
  }
  return out;
}

export async function writeAudit(input: AuditEntryInput, logger?: FastifyBaseLogger): Promise<void> {
  const id = randomUUID();
  const entry: AuditLog = {
    id,
    contestId: input.contestId ?? null,
    actorUid: input.actorUid,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: sanitiseMetadata(input.metadata),
    at: now(),
  };

  try {
    await auditLogsCol().doc(id).set(entry);
  } catch (err) {
    logger?.error({ err, action: input.action }, 'failed to write audit log');
  }
}

export function auditToDto(entry: AuditLog): AuditRowDto {
  return {
    id: entry.id,
    actorEmail: entry.actorEmail,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    at: entry.at.toISOString(),
  };
}
