/**
 * The dashboard — the landing page for everyone in the contest.
 *
 * One page, three faces. During submissions it is about participation; during
 * voting it is about turnout and the live ranked-choice projection; after
 * publication it is a winner and a door through to the full count. The visual
 * language does not change between them, only what is worth saying.
 *
 * Two rules are load-bearing here:
 *
 *  - `dashboard.phase` is the server's answer and we do not second-guess it.
 *    `derivePhase` exists so both sides agree, but it needs the publication
 *    timestamp and the admin override, and neither is in `ContestPublicDto`.
 *    Re-deriving from the windows we *can* see would cheerfully show "accepting
 *    entries" to someone an admin has already closed submissions on. So we take
 *    the phase from the DTO and use the `can*` predicates to gate the actions.
 *  - Every countdown is anchored to `serverNow`, never `Date.now()`. A laptop
 *    with a skewed clock must not be told voting closed an hour ago.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PHASE_LABELS, canSubmit, canVote, canViewResults } from '@contest/shared';
import type { ContestPhase } from '@contest/shared';
import { ApiClientError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { formatPercent, plural } from '@/lib/utils';
import {
  Badge,
  Button,
  Countdown,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  Stat,
} from '@/components/ui';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { LiveStandings } from '@/components/dashboard/LiveStandings';
import { ViewerStatus } from '@/components/dashboard/ViewerStatus';
import { WinnerSummary } from '@/components/dashboard/WinnerSummary';

/**
 * Counts move on human timescales and a stale number for twenty seconds has
 * never hurt anyone. Slow enough to be invisible on the API, fast enough that
 * standings feel live. Polling, not a socket: this is ten to twenty-five people
 * for a fortnight, and a socket is a connection to keep alive for no gain.
 */
const DASHBOARD_POLL_MS = 25_000;

/** Only the phases where a number can actually change are worth polling. */
const LIVE_PHASES: ReadonlySet<ContestPhase> = new Set<ContestPhase>([
  'SUBMISSIONS_OPEN',
  'VOTING_OPEN',
]);

export function Dashboard(): JSX.Element {
  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.dashboard(),
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase !== undefined && LIVE_PHASES.has(phase) ? DASHBOARD_POLL_MS : false;
    },
  });

  const contestQuery = useQuery({
    queryKey: queryKeys.contest,
    queryFn: () => api.contest(),
    staleTime: 5 * 60_000,
  });

  const dashboard = dashboardQuery.data;
  const phase = dashboard?.phase;
  const resultsPublished = phase !== undefined && canViewResults(phase);

  const resultsQuery = useQuery({
    queryKey: queryKeys.results,
    queryFn: () => api.results(),
    enabled: resultsPublished,
    staleTime: 5 * 60_000,
  });

  // A poll that fails while we already have good data should not tear the page
  // down — keep showing the last figures and mention it quietly instead.
  const staleFetchFailed = dashboardQuery.isError && dashboard !== undefined;
  const { errorUpdatedAt } = dashboardQuery;
  useEffect(() => {
    if (!staleFetchFailed) return;
    toast.error('Could not refresh the numbers.', {
      description: 'Showing the last figures we managed to load.',
    });
  }, [staleFetchFailed, errorUpdatedAt]);

  if (dashboardQuery.isPending) return <DashboardSkeleton />;

  if (dashboard === undefined) {
    return (
      <DashboardError
        error={dashboardQuery.error}
        onRetry={() => void dashboardQuery.refetch()}
        isRetrying={dashboardQuery.isFetching}
      />
    );
  }

  const contest = contestQuery.data;
  const title = contest?.title ?? 'Media Moguls (North 7) Logo Design Contest';
  const turnout =
    dashboard.eligibleVoters > 0 ? dashboard.ballotsCast / dashboard.eligibleVoters : 0;
  const participation =
    dashboard.eligibleVoters > 0 ? dashboard.submissionCount / dashboard.eligibleVoters : 0;

  return (
    <div className="space-y-section">
      <PageHeaderBlock
        title={title}
        description={contest?.description}
        phase={dashboard.phase}
      />

      {dashboard.phase === 'SETUP' && <SetupFace eligibleVoters={dashboard.eligibleVoters} />}

      {dashboard.phase === 'SUBMISSIONS_OPEN' && (
        <>
          <ViewerStatus
            done={dashboard.iHaveSubmitted}
            doneTitle="You've submitted ✓"
            doneDescription="Your logo is in. You can swap it for a different one until uploads close."
            todoTitle="You haven't submitted yet"
            todoDescription="One logo each. It takes a minute, and every entry is shown anonymously."
            actionLabel="Upload your logo"
            changeLabel="Replace your entry"
            actionTo="/submit"
            actionable={canSubmit(dashboard.phase)}
          />

          <StatRow>
            <Stat
              label="Entries so far"
              value={dashboard.submissionCount}
              hint={dashboard.submissionCount === 1 ? 'one logo in' : 'logos in'}
            />
            <Stat
              label="Teammates submitted"
              value={`${dashboard.submissionCount} of ${dashboard.eligibleVoters}`}
              hint={
                dashboard.eligibleVoters > 0
                  ? `${formatPercent(participation)} of the team`
                  : 'no one on the list yet'
              }
            />
            <Stat
              label="Uploads close"
              value={
                dashboard.closesAt ? (
                  <Countdown to={dashboard.closesAt} serverNow={dashboard.serverNow} />
                ) : (
                  'No deadline set'
                )
              }
              hint={dashboard.closesAt ? 'then voting opens' : 'an admin will set one'}
            />
          </StatRow>

          {dashboard.submissionCount === 0 ? (
            <Panel>
              <EmptyState
                title="No entries yet"
                description="Nothing has been uploaded so far. Someone has to go first — it may as well be a good one."
              />
            </Panel>
          ) : (
            <GalleryNote count={dashboard.submissionCount} />
          )}
        </>
      )}

      {dashboard.phase === 'VOTING_OPEN' && (
        <>
          <ViewerStatus
            done={dashboard.iHaveVoted}
            doneTitle="Your ballot is in ✓"
            doneDescription="You can reorder your ranking any time until voting closes."
            todoTitle="You haven't voted yet"
            todoDescription="Rank the entries you like, best first. You don't have to rank them all."
            actionLabel="Rank the entries"
            changeLabel="Edit your ranking"
            actionTo="/ballot"
            actionable={canVote(dashboard.phase)}
          />

          <StatRow>
            <Stat
              label="Ballots cast"
              value={`${dashboard.ballotsCast} of ${dashboard.eligibleVoters}`}
              hint={
                dashboard.eligibleVoters > 0
                  ? `${formatPercent(turnout)} turnout`
                  : 'no one on the list yet'
              }
            />
            <Stat
              label="Entries in the running"
              value={dashboard.submissionCount}
              hint={plural(dashboard.submissionCount, 'logo')}
            />
            <Stat
              label="Voting closes"
              value={
                dashboard.closesAt ? (
                  <Countdown to={dashboard.closesAt} serverNow={dashboard.serverNow} />
                ) : (
                  'No deadline set'
                )
              }
              hint={dashboard.closesAt ? 'ranking locks then' : 'an admin will set one'}
            />
          </StatRow>

          <LiveStandings
            standings={dashboard.standings}
            standingsHiddenReason={dashboard.standingsHiddenReason}
            ballotsCast={dashboard.ballotsCast}
          />
        </>
      )}

      {dashboard.phase === 'CLOSED' && (
        <>
          <Panel>
            <EmptyState
              title="Voting has closed"
              description="The ranked-choice count is being finalised. The winner and the full round-by-round breakdown will appear here once an admin publishes them."
            />
          </Panel>

          <StatRow>
            <Stat label="Entries" value={dashboard.submissionCount} hint="logos received" />
            <Stat
              label="Ballots cast"
              value={`${dashboard.ballotsCast} of ${dashboard.eligibleVoters}`}
              hint={
                dashboard.eligibleVoters > 0 ? `${formatPercent(turnout)} turnout` : 'final tally'
              }
            />
            <Stat
              label="Your ballot"
              value={dashboard.iHaveVoted ? 'Counted' : 'Not cast'}
              hint={dashboard.iHaveVoted ? 'thanks for voting' : 'voting is over'}
            />
          </StatRow>
        </>
      )}

      {dashboard.phase === 'RESULTS_PUBLISHED' && (
        <>
          <WinnerSummary
            winner={resultsQuery.data?.winner ?? null}
            winnerCredit={resultsQuery.data?.winnerCredit ?? null}
            isLoading={resultsQuery.isPending}
            failed={resultsQuery.isError}
          />

          <StatRow>
            <Stat label="Entries" value={dashboard.submissionCount} hint="logos received" />
            <Stat
              label="Ballots counted"
              value={`${dashboard.ballotsCast} of ${dashboard.eligibleVoters}`}
              hint={
                dashboard.eligibleVoters > 0 ? `${formatPercent(turnout)} turnout` : 'final tally'
              }
            />
            <Stat
              label="Your ballot"
              value={dashboard.iHaveVoted ? 'Counted' : 'Not cast'}
              hint={dashboard.iHaveVoted ? 'thanks for voting' : 'no ballot recorded'}
            />
          </StatRow>
        </>
      )}
    </div>
  );
}

/** The route table imports this name. Same component. */
export { Dashboard as DashboardPage };
export default Dashboard;

// ---------------------------------------------------------------------------

function PageHeaderBlock({
  title,
  description,
  phase,
}: {
  title: string;
  description?: string;
  phase: ContestPhase;
}): JSX.Element {
  return (
    <PageHeader
      eyebrow="Media Moguls · North 7"
      title={title}
      description={description}
      actions={<Badge tone={phase === 'VOTING_OPEN' ? 'accent' : 'neutral'}>{PHASE_LABELS[phase]}</Badge>}
    />
  );
}

/** Three stats that reflow to one column on a phone. */
function StatRow({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid gap-base sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function SetupFace({ eligibleVoters }: { eligibleVoters: number }): JSX.Element {
  return (
    <Panel>
      <EmptyState
        title="Not open yet"
        description={
          eligibleVoters > 0
            ? `${plural(eligibleVoters, 'teammate')} are on the list. Uploads open shortly — this page will tell you when.`
            : 'Uploads open shortly. This page will tell you when.'
        }
      />
    </Panel>
  );
}

function GalleryNote({ count }: { count: number }): JSX.Element {
  return (
    <Panel>
      <PanelHeader
        eyebrow="While you wait"
        title="See what's been submitted"
        description="Every entry is shown anonymously — an alias and the image, nothing about who made it."
      />
      <Link
        to="/gallery"
        className="inline-flex rounded text-sm text-accent underline underline-offset-4 hover:text-accent-hover"
      >
        Browse {plural(count, 'entry', 'entries')}
      </Link>
    </Panel>
  );
}

function DashboardError({
  error,
  onRetry,
  isRetrying,
}: {
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
}): JSX.Element {
  const isAccessRequired =
    error instanceof ApiClientError && error.code === 'CONTEST_ACCESS_REQUIRED';
  const message =
    error instanceof ApiClientError
      ? error.message
      : 'Something went wrong loading the contest dashboard.';

  if (isAccessRequired) {
    return (
      <Panel>
        <EmptyState
          title="Register for a contest to view its dashboard"
          description={message}
          action={
            <Link
              to="/contests"
              className="inline-flex items-center rounded bg-accent px-base py-snug text-sm font-medium text-accent-contrast no-underline"
            >
              Go to your contests
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel>
      <EmptyState
        title="Could not load the dashboard"
        description={message}
        action={
          <Button onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? 'Retrying…' : 'Try again'}
          </Button>
        }
      />
    </Panel>
  );
}
