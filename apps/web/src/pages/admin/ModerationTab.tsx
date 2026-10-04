/**
 * Tab 4 — Moderation.
 *
 * The ONE place in the product where uploader identity is visible. The server
 * writes a `moderation.view_identities` audit entry before it answers, every
 * time, with no opt-out — so the notice at the top of this screen is simply
 * true. Saying it out loud is what turns the log from a surprise into a
 * deterrent; an admin who knows the lookup is recorded thinks twice, and one
 * who does not, does not.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Eye, RefreshCw, ShieldAlert } from 'lucide-react';
import type { ModerationSubmissionDto } from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import {
  Badge,
  Button,
  CharCount,
  ConfirmDialog,
  Divider,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { adminErrorMessage, formatAbsoluteWithYear } from './admin-shared';

const MAX_REASON = 500;

/** "Entry 07" once aliases are assigned; before that there is only the id. */
function entryLabel(entry: ModerationSubmissionDto): string {
  return entry.alias ?? entry.title ?? `Entry ${entry.id.slice(0, 6)}`;
}

export function ModerationTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [target, setTarget] = React.useState<ModerationSubmissionDto | null>(null);
  const [reason, setReason] = React.useState('');
  const [reasonTouched, setReasonTouched] = React.useState(false);
  /** Id of the row whose reason form is open, before the confirmation step. */
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [reinstateTarget, setReinstateTarget] = React.useState<ModerationSubmissionDto | null>(null);

  const moderation = useQuery({
    queryKey: queryKeys.admin.moderation,
    queryFn: () => api.admin.moderation(),
  });

  const invalidateAll = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.moderation }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.audit }),
      queryClient.invalidateQueries({ queryKey: queryKeys.submissions }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
  }, [queryClient]);

  const disqualify = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) =>
      api.admin.disqualify(id, { reason: why }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Entry disqualified. The reason is recorded in the audit log.');
    },
    onError: (error: unknown) => toast.error(adminErrorMessage(error, 'Could not disqualify that entry.')),
  });

  const reinstate = useMutation({
    mutationFn: (id: string) => api.admin.reinstate(id),
    onSuccess: async () => {
      await invalidateAll();
      toast.success('Entry reinstated.');
    },
    onError: (error: unknown) => toast.error(adminErrorMessage(error, 'Could not reinstate that entry.')),
  });

  const entries = moderation.data ?? [];

  /** Group by content hash so a duplicate pair reads as a pair, not two rows. */
  const duplicateGroups = React.useMemo(() => {
    const byHash = new Map<string, ModerationSubmissionDto[]>();
    for (const entry of entries) {
      if (entry.duplicateOf.length === 0) continue;
      const bucket = byHash.get(entry.contentHash);
      if (bucket) bucket.push(entry);
      else byHash.set(entry.contentHash, [entry]);
    }
    return byHash;
  }, [entries]);

  const disqualifiedCount = entries.filter((entry) => entry.status !== 'active').length;

  const reasonTooShort = reason.trim().length === 0;

  return (
    <div className="space-y-loose">
      {/*
        Not a toast, not a tooltip. A standing notice, above the data it applies
        to, that survives a page refresh.
      */}
      <div
        role="note"
        data-testid="moderation-audit-notice"
        className="rounded border border-warning bg-warning-soft p-roomy"
      >
        <div className="flex items-start gap-base">
          <Eye aria-hidden className="mt-hair size-5 shrink-0 text-warning" />
          <div className="max-w-measure">
            <p className="text-body font-semibold text-ink">
              Opening this page is recorded in the audit log.
            </p>
            <p className="mt-hair text-sm text-ink">
              This is the only screen that links an entry to the person who uploaded it. Every
              load writes a <code className="font-mono text-xs">moderation.view_identities</code>{' '}
              line naming you and the time — server-side, with no way to switch it off. Other
              admins can see it on the Admins &amp; audit tab.
            </p>
          </div>
        </div>
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Entries"
          title="Moderation"
          description={
            entries.length > 0
              ? `${entries.length} entries, ${disqualifiedCount} disqualified.`
              : undefined
          }
          actions={
            <Button
              variant="ghost"
              onClick={() => void moderation.refetch()}
              loading={moderation.isFetching}
            >
              <RefreshCw aria-hidden className="size-4" />
              Refresh
            </Button>
          }
        />
        <Divider />

        {moderation.isPending ? (
          <div className="grid gap-base p-roomy sm:grid-cols-2">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-32 w-full" />
            ))}
          </div>
        ) : moderation.isError ? (
          <EmptyState
            title="Could not load entries"
            description={adminErrorMessage(moderation.error, 'The moderation list is unavailable.')}
            action={
              <Button variant="secondary" onClick={() => void moderation.refetch()}>
                Try again
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No entries yet"
            description="Nothing has been uploaded, so there is nothing to moderate."
          />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((entry) => {
              const isDisqualified = entry.status !== 'active';
              const siblings = duplicateGroups.get(entry.contentHash) ?? [];
              const others = siblings.filter((s) => s.id !== entry.id);
              return (
                <li key={entry.id} className="flex flex-col gap-base p-roomy sm:flex-row">
                  <img
                    src={entry.thumbUrl}
                    alt={`Thumbnail of ${entryLabel(entry)}`}
                    width={entry.width}
                    height={entry.height}
                    className="h-24 w-24 shrink-0 rounded border border-line bg-paper-sunken object-contain"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-medium text-ink">{entryLabel(entry)}</span>
                      {isDisqualified ? (
                        <Badge tone="danger">Disqualified</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                      {entry.duplicateOf.length > 0 && (
                        <Badge tone="warning">
                          <Copy aria-hidden className="size-3" />
                          Possible duplicate
                        </Badge>
                      )}
                    </div>

                    {/* The identity reveal this whole screen is audited for. */}
                    <p className="mt-hair text-sm text-ink">
                      <span className="font-medium">{entry.ownerDisplayName}</span>{' '}
                      <span className="text-ink-muted">&lt;{entry.ownerEmail}&gt;</span>
                    </p>
                    <p className="text-xs tabular-nums text-ink-muted">
                      Uploaded {formatAbsoluteWithYear(entry.createdAt)}
                    </p>

                    {entry.description && (
                      <p className="mt-tight max-w-measure text-sm text-ink-muted">
                        {entry.description}
                      </p>
                    )}

                    {entry.duplicateOf.length > 0 && (
                      <p className="mt-tight max-w-measure rounded border border-line bg-paper-sunken px-3 py-2 text-xs text-ink">
                        Byte-identical image to{' '}
                        {others.length > 0
                          ? others.map((o) => entryLabel(o)).join(', ')
                          : entry.duplicateOf.join(', ')}
                        . Same hash means the same file, which is usually a re-upload under two
                        accounts rather than two people arriving at the same pixels.
                      </p>
                    )}

                    {isDisqualified && entry.disqualifiedReason && (
                      <p className="mt-tight max-w-measure rounded border border-danger bg-danger-soft px-3 py-2 text-xs text-ink">
                        <span className="font-medium">Reason given:</span>{' '}
                        {entry.disqualifiedReason}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-stretch gap-tight sm:w-80">
                    {isDisqualified ? (
                      <Button
                        variant="secondary"
                        onClick={() => setReinstateTarget(entry)}
                        loading={reinstate.isPending && reinstate.variables === entry.id}
                      >
                        Reinstate
                      </Button>
                    ) : pendingId === entry.id ? (
                      // The reason is written here rather than inside the
                      // dialog: ConfirmDialog is a confirmation, not a form, so
                      // the text is captured first and quoted back on confirm.
                      <div className="space-y-tight">
                        <Field
                          label="Reason"
                          htmlFor={`disqualify-reason-${entry.id}`}
                          required
                          hint="Required. Whoever reviews this later — including the entrant, if they ask — sees exactly this text."
                          error={
                            reasonTouched && reasonTooShort
                              ? 'A reason is required to disqualify an entry.'
                              : undefined
                          }
                        >
                          <Textarea
                            id={`disqualify-reason-${entry.id}`}
                            rows={3}
                            maxLength={MAX_REASON}
                            value={reason}
                            onChange={(event) => {
                              setReason(event.target.value);
                              setReasonTouched(true);
                            }}
                            placeholder="e.g. Re-uploaded another member's entry"
                          />
                          <CharCount value={reason} max={MAX_REASON} />
                        </Field>
                        <div className="flex flex-wrap gap-tight">
                          <Button
                            variant="danger"
                            // Kept focusable while incomplete so the reason
                            // requirement is announced rather than silent.
                            aria-disabled={reasonTooShort || undefined}
                            onClick={() => {
                              if (reasonTooShort) {
                                setReasonTouched(true);
                                return;
                              }
                              setTarget(entry);
                            }}
                          >
                            <ShieldAlert aria-hidden className="size-4" />
                            Disqualify
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setPendingId(null);
                              setReason('');
                              setReasonTouched(false);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setReason('');
                          setReasonTouched(false);
                          setPendingId(entry.id);
                        }}
                      >
                        <ShieldAlert aria-hidden className="size-4" />
                        Disqualify
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        destructive
        title={target ? `Disqualify ${entryLabel(target)}?` : 'Disqualify entry'}
        description={
          target
            ? `The entry is removed from the gallery and excluded from the count. ${target.ownerDisplayName} keeps the upload but it stops competing. The reason you gave — “${reason.trim()}” — is stored with the entry and written to the audit log under your name.`
            : undefined
        }
        confirmLabel="Disqualify"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (!target || reasonTooShort) return;
          const id = target.id;
          const why = reason.trim();
          setTarget(null);
          setPendingId(null);
          setReason('');
          setReasonTouched(false);
          disqualify.mutate({ id, why });
        }}
      />

      <ConfirmDialog
        open={reinstateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReinstateTarget(null);
        }}
        title={reinstateTarget ? `Reinstate ${entryLabel(reinstateTarget)}?` : 'Reinstate entry'}
        description="The entry returns to the gallery and counts again. The stored disqualification reason is cleared, and the reinstatement is recorded in the audit log."
        confirmLabel="Reinstate"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (!reinstateTarget) return;
          const id = reinstateTarget.id;
          setReinstateTarget(null);
          reinstate.mutate(id);
        }}
      />
    </div>
  );
}
