/**
 * Tab 6 — Admins & audit.
 *
 * The last-admin rule is enforced twice on purpose. The server returns
 * `LAST_ADMIN` and that is the real control; the button here is disabled with
 * an explanation because "your click did nothing, here is a 409" teaches an
 * admin nothing about why. Locking yourself out of a contest has no recovery
 * path from inside the app, so the UI says that in words before it happens.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, ShieldCheck, ShieldMinus, ShieldPlus } from 'lucide-react';
import { AUDIT_ACTIONS, type Role, type TurnoutRowDto } from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import {
  Badge,
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  Skeleton,
} from '@/components/ui';
import {
  adminErrorMessage,
  auditActionLabel,
  formatAbsoluteWithYear,
  formatRelative,
  localTimeZone,
  timeZoneAbbreviation,
} from './admin-shared';

const LAST_ADMIN_EXPLANATION =
  'This is the only administrator. Demoting them would leave nobody able to publish results, ' +
  'moderate entries or fix the timeline — and there is no way to promote someone back from ' +
  'inside the app. Promote a second administrator first.';

interface RoleChange {
  row: TurnoutRowDto;
  next: Role;
}

export function AdminsAuditTab({ currentUid }: { currentUid: string | null }): JSX.Element {
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<RoleChange | null>(null);
  const [actionFilter, setActionFilter] = React.useState<string>('all');

  /**
   * The user directory comes from the turnout route: it already carries uid,
   * email, display name and role for every participant, so there is no need
   * for a second list endpoint here.
   */
  const people = useQuery({
    queryKey: queryKeys.admin.turnout,
    queryFn: () => api.admin.turnout(),
  });

  const audit = useQuery({
    queryKey: queryKeys.admin.audit,
    queryFn: () => api.admin.audit(),
  });

  const rows = people.data?.rows ?? [];
  const admins = rows.filter((row) => row.role === 'admin');
  const isLastAdmin = admins.length <= 1;

  const sortedPeople = React.useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
      }),
    [rows],
  );

  const setRole = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: Role }) => api.admin.setRole(uid, role),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.turnout }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.audit }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
      toast.success(
        variables.role === 'admin' ? 'Promoted to administrator.' : 'Demoted to member.',
      );
    },
    onError: (error: unknown) => toast.error(adminErrorMessage(error, 'Could not change that role.')),
  });

  const auditRows = React.useMemo(() => {
    const all = audit.data ?? [];
    const filtered = actionFilter === 'all' ? all : all.filter((row) => row.action === actionFilter);
    // Most recent first, regardless of what order the server used.
    return [...filtered].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [audit.data, actionFilter]);

  /** Actions present in the data, plus the canonical list, so the filter never lies. */
  const filterOptions = React.useMemo(() => {
    const seen = new Set<string>(AUDIT_ACTIONS);
    for (const row of audit.data ?? []) seen.add(row.action);
    return [...seen].sort();
  }, [audit.data]);

  const zone = timeZoneAbbreviation();

  return (
    <div className="space-y-loose">
      <Panel>
        <PanelHeader
          eyebrow="Access"
          title="Administrators"
          description={`${admins.length} of ${rows.length} participants can administer this contest.`}
          actions={
            <Button
              variant="ghost"
              onClick={() => void people.refetch()}
              loading={people.isFetching}
            >
              <RefreshCw aria-hidden className="size-4" />
              Refresh
            </Button>
          }
        />
        <Divider />

        {isLastAdmin && rows.length > 0 && (
          <div role="note" className="m-roomy rounded border border-warning bg-warning-soft p-base">
            <p className="max-w-measure text-sm text-ink">
              <ShieldCheck aria-hidden className="mr-2 inline size-4 align-text-bottom text-warning" />
              {LAST_ADMIN_EXPLANATION}
            </p>
          </div>
        )}

        {people.isPending ? (
          <div className="space-y-tight p-roomy">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-10 w-full" />
            ))}
          </div>
        ) : people.isError ? (
          <EmptyState
            title="Could not load participants"
            description={adminErrorMessage(people.error, 'The participant list is unavailable.')}
            action={
              <Button variant="secondary" onClick={() => void people.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Participants and their roles</caption>
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Person
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Role
                  </th>
                  <th scope="col" className="px-roomy py-tight text-right font-medium text-ink-muted">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPeople.map((row) => {
                  const isAdmin = row.role === 'admin';
                  const blockLastAdmin = isAdmin && isLastAdmin;
                  const isSelf = currentUid !== null && row.uid === currentUid;
                  return (
                    <tr key={row.uid} className="border-b border-line last:border-0">
                      <th scope="row" className="px-roomy py-tight text-left font-normal">
                        <span className="block font-medium text-ink">
                          {row.displayName}
                          {isSelf && <span className="ml-2 text-xs text-ink-muted">(you)</span>}
                        </span>
                        <span className="block text-xs text-ink-muted">{row.email}</span>
                      </th>
                      <td className="px-roomy py-tight">
                        {isAdmin ? <Badge tone="accent">Admin</Badge> : <Badge tone="neutral">Member</Badge>}
                      </td>
                      <td className="px-roomy py-tight text-right">
                        <div className="flex flex-col items-end gap-hair">
                          <Button
                            variant={isAdmin ? 'secondary' : 'primary'}
                            disabled={blockLastAdmin}
                            loading={setRole.isPending && setRole.variables?.uid === row.uid}
                            aria-describedby={blockLastAdmin ? 'last-admin-reason' : undefined}
                            onClick={() =>
                              setPending({ row, next: isAdmin ? 'member' : 'admin' })
                            }
                          >
                            {isAdmin ? (
                              <>
                                <ShieldMinus aria-hidden className="size-4" />
                                Demote to member
                              </>
                            ) : (
                              <>
                                <ShieldPlus aria-hidden className="size-4" />
                                Promote to admin
                              </>
                            )}
                          </Button>
                          {blockLastAdmin && (
                            <span
                              id="last-admin-reason"
                              className="max-w-xs text-right text-xs text-ink-muted"
                            >
                              Cannot demote the last administrator.
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Accountability"
          title="Audit log"
          description={`Most recent first, in ${localTimeZone} (${zone}). Includes every time an administrator looked up who uploaded what.`}
          actions={
            <Button variant="ghost" onClick={() => void audit.refetch()} loading={audit.isFetching}>
              <RefreshCw aria-hidden className="size-4" />
              Refresh
            </Button>
          }
        />
        <Divider />

        <div className="max-w-xs p-roomy">
          <Field
            label="Filter by action"
            htmlFor="audit-action-filter"
            hint="Narrow the log to one kind of event."
          >
            <select
              id="audit-action-filter"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              className="h-10 w-full rounded border border-line bg-paper px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <option value="all">All actions</option>
              {filterOptions.map((action) => (
                <option key={action} value={action}>
                  {auditActionLabel(action)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Divider />

        {audit.isPending ? (
          <div className="space-y-tight p-roomy">
            {[0, 1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-10 w-full" />
            ))}
          </div>
        ) : audit.isError ? (
          <EmptyState
            title="Could not load the audit log"
            description={adminErrorMessage(audit.error, 'The audit log is unavailable.')}
            action={
              <Button variant="secondary" onClick={() => void audit.refetch()}>
                Try again
              </Button>
            }
          />
        ) : auditRows.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            description={
              actionFilter === 'all'
                ? 'No administrative actions have been taken on this contest.'
                : 'No entries of that kind. Try a different action.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Administrative actions, most recent first</caption>
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    When
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Actor
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Action
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-roomy py-tight tabular-nums">
                      <span className="block text-ink">{formatAbsoluteWithYear(row.at)}</span>
                      <span className="block text-xs text-ink-muted">{formatRelative(row.at)}</span>
                    </td>
                    <td className="px-roomy py-tight text-ink">{row.actorEmail}</td>
                    <td className="px-roomy py-tight">
                      <span className="block text-ink">{auditActionLabel(row.action)}</span>
                      <code className="block font-mono text-xs text-ink-faint">{row.action}</code>
                    </td>
                    <td className="px-roomy py-tight text-ink-muted">
                      {row.targetType || row.targetId ? (
                        <>
                          <span className="block text-ink">{row.targetType ?? 'target'}</span>
                          <code className="block font-mono text-xs">{row.targetId ?? '—'}</code>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        destructive={pending?.next === 'member'}
        title={
          pending
            ? pending.next === 'admin'
              ? `Make ${pending.row.displayName} an administrator?`
              : `Remove ${pending.row.displayName}'s administrator access?`
            : 'Change role'
        }
        description={
          pending
            ? pending.next === 'admin'
              ? `${pending.row.displayName} will be able to change the timeline, force phases, see who uploaded every entry, disqualify entries and publish results. Uploader identities are the sensitive part — that lookup is audited, but it is still a real disclosure.`
              : `${pending.row.displayName} loses access to this console immediately. They stay a participant and their entry and ballot are untouched.${
                  pending.row.uid === currentUid
                    ? ' This is your own account — you will be locked out of this page as soon as you confirm.'
                    : ''
                }`
            : undefined
        }
        confirmLabel={pending?.next === 'admin' ? 'Promote' : 'Demote'}
        cancelLabel="Cancel"
        onConfirm={() => {
          if (!pending) return;
          const { row, next } = pending;
          setPending(null);
          setRole.mutate({ uid: row.uid, role: next });
        }}
      />
    </div>
  );
}
