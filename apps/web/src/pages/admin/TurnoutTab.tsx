/**
 * Tab 3 — Turnout.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS SCREEN SHOWS **WHO** HAS VOTED. IT NEVER SHOWS **WHAT** THEY VOTED.
 *
 * Ballot contents are sealed from everyone, administrators included. There is
 * no endpoint that returns another person's ranking — `GET /admin/turnout`
 * deliberately returns booleans and nothing else — and none may be invented
 * to fill this table out.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Non-voters sort to the top because chasing stragglers is the actual job. At
 * ~15 participants one missing ballot is about 7% of the electorate, which is
 * large enough to change an instant-runoff outcome on its own.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import type { TurnoutRowDto } from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import {
  Badge,
  Button,
  Divider,
  EmptyState,
  Input,
  Panel,
  PanelHeader,
  Skeleton,
  Stat,
} from '@/components/ui';
import { adminErrorMessage, formatAbsoluteWithYear, formatRelative, pct } from './admin-shared';

/**
 * Non-voters first, then people who have not submitted, then alphabetical.
 * Deliberately stable so the row you were about to click does not move.
 */
function chaseOrder(a: TurnoutRowDto, b: TurnoutRowDto): number {
  if (a.hasVoted !== b.hasVoted) return a.hasVoted ? 1 : -1;
  if (a.hasSubmitted !== b.hasSubmitted) return a.hasSubmitted ? 1 : -1;
  return (a.displayName || a.email).localeCompare(b.displayName || b.email);
}

function YesNo({ yes, yesLabel, noLabel }: { yes: boolean; yesLabel: string; noLabel: string }): JSX.Element {
  return yes ? <Badge tone="success">{yesLabel}</Badge> : <Badge tone="warning">{noLabel}</Badge>;
}

export function TurnoutTab(): JSX.Element {
  const [filter, setFilter] = React.useState('');
  const [onlyOutstanding, setOnlyOutstanding] = React.useState(false);

  const turnout = useQuery({
    queryKey: queryKeys.admin.turnout,
    queryFn: () => api.admin.turnout(),
  });

  const rows = React.useMemo(() => {
    const all = [...(turnout.data?.rows ?? [])].sort(chaseOrder);
    const needle = filter.trim().toLowerCase();
    return all.filter((row) => {
      if (onlyOutstanding && row.hasVoted) return false;
      if (!needle) return true;
      return (
        row.email.toLowerCase().includes(needle) ||
        row.displayName.toLowerCase().includes(needle)
      );
    });
  }, [turnout.data, filter, onlyOutstanding]);

  const eligible = turnout.data?.eligible ?? 0;
  const voted = turnout.data?.voted ?? 0;
  const submitted = (turnout.data?.rows ?? []).filter((row) => row.hasSubmitted).length;
  const outstanding = Math.max(eligible - voted, 0);

  return (
    <div className="space-y-loose">
      <div role="note" className="rounded border border-line bg-paper-sunken p-roomy">
        <p className="max-w-measure text-sm text-ink">
          <strong className="font-semibold">Who voted, never what they voted.</strong> Ballot
          contents are sealed from administrators as firmly as from anyone else — no endpoint
          returns them, and this table cannot be made to. Use it to chase the people who have not
          voted yet, not to guess how they did.
        </p>
      </div>

      <div className="grid gap-base sm:grid-cols-3">
        <Stat
          label="Entries submitted"
          value={`${submitted} / ${eligible}`}
          hint={`${pct(submitted, eligible)} of eligible participants have an entry.`}
        />
        <Stat
          label="Ballots cast"
          value={`${voted} / ${eligible}`}
          hint={`${pct(voted, eligible)} of the electorate has voted.`}
        />
        <Stat
          label="Still to vote"
          value={String(outstanding)}
          hint={
            outstanding === 0
              ? 'Everyone eligible has voted.'
              : `Each one is about ${pct(1, eligible)} of the electorate.`
          }
        />
      </div>

      <Panel>
        <PanelHeader
          eyebrow="Participants"
          title="Turnout"
          description="Non-voters are listed first."
          actions={
            <Button
              variant="ghost"
              onClick={() => void turnout.refetch()}
              loading={turnout.isFetching}
              aria-label="Refresh turnout"
            >
              <RefreshCw aria-hidden className="size-4" />
              Refresh
            </Button>
          }
        />
        <Divider />

        <div className="flex flex-wrap items-end gap-base p-roomy">
          <div className="min-w-0 flex-1">
            <label htmlFor="turnout-filter" className="block text-label uppercase text-ink-muted">
              Find a participant
            </label>
            <div className="relative mt-hair">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
              />
              <Input
                id="turnout-filter"
                className="pl-10"
                placeholder="Name or email"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          </div>
          <Button
            variant={onlyOutstanding ? 'primary' : 'secondary'}
            aria-pressed={onlyOutstanding}
            onClick={() => setOnlyOutstanding((prev) => !prev)}
          >
            {onlyOutstanding ? 'Showing non-voters only' : 'Show non-voters only'}
          </Button>
        </div>

        <Divider />

        {turnout.isPending ? (
          <div className="space-y-tight p-roomy">
            {[0, 1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-10 w-full" />
            ))}
          </div>
        ) : turnout.isError ? (
          <EmptyState
            title="Could not load turnout"
            description={adminErrorMessage(turnout.error, 'The turnout list is unavailable.')}
            action={
              <Button variant="secondary" onClick={() => void turnout.refetch()}>
                Try again
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={onlyOutstanding ? 'Everyone has voted' : 'No participants match'}
            description={
              onlyOutstanding
                ? 'There is nobody left to chase.'
                : 'Try a different name or email fragment.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Participants, showing whether each has submitted an entry and whether each has
                cast a ballot. Ballot contents are not shown.
              </caption>
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Participant
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Role
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Submitted
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Voted
                  </th>
                  <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.uid}
                    className="border-b border-line last:border-0 hover:bg-paper-sunken"
                  >
                    <th scope="row" className="px-roomy py-tight text-left font-normal">
                      <span className="block font-medium text-ink">{row.displayName}</span>
                      <span className="block text-xs text-ink-muted">{row.email}</span>
                    </th>
                    <td className="px-roomy py-tight">
                      {row.role === 'admin' ? (
                        <Badge tone="accent">Admin</Badge>
                      ) : (
                        <span className="text-ink-muted">Member</span>
                      )}
                    </td>
                    <td className="px-roomy py-tight">
                      <YesNo yes={row.hasSubmitted} yesLabel="Submitted" noLabel="No entry" />
                    </td>
                    <td className="px-roomy py-tight">
                      <YesNo yes={row.hasVoted} yesLabel="Voted" noLabel="Not voted" />
                    </td>
                    <td className="px-roomy py-tight tabular-nums text-ink-muted">
                      <span className="block text-ink">{formatRelative(row.lastSeenAt)}</span>
                      <span className="block text-xs">
                        {formatAbsoluteWithYear(row.lastSeenAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
