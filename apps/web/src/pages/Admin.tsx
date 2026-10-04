/**
 * The admin console for the Media Moguls (North 7) Logo Design Contest.
 *
 * Six sections, one page. The contest has roughly fifteen participants, which
 * shapes almost every decision here: turnout is a list you read row by row
 * rather than a chart, ties are routine rather than exotic, and a single
 * uncast ballot is about seven per cent of the electorate.
 *
 * Two invariants run through the whole screen and are worth stating once:
 *
 *   - BALLOT CONTENTS ARE SEALED. Turnout shows who voted; nothing anywhere
 *     shows what they voted, because no endpoint returns it and none may be
 *     invented to.
 *   - UPLOADER IDENTITY IS AUDITED. The moderation tab is the only place it
 *     appears, and the act of looking is logged server-side.
 *
 * Routing guards this page, but guards get refactored. If a non-admin does
 * reach it, it refuses to render the console rather than trusting the router.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  ShieldAlert,
  Trophy,
  Users,
} from 'lucide-react';
import { PHASE_LABELS } from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Countdown,
  EmptyState,
  PageHeader,
  Panel,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { adminErrorMessage, formatAbsolute } from './admin/admin-shared';
import { TimelineTab } from './admin/TimelineTab';
import { PhaseTab } from './admin/PhaseTab';
import { TurnoutTab } from './admin/TurnoutTab';
import { ModerationTab } from './admin/ModerationTab';
import { ResultsTab } from './admin/ResultsTab';
import { AdminsAuditTab } from './admin/AdminsAuditTab';

const TAB_DEFS = [
  { value: 'timeline', label: 'Timeline & settings', icon: CalendarClock },
  { value: 'phase', label: 'Phase', icon: ClipboardList },
  { value: 'turnout', label: 'Turnout', icon: Users },
  { value: 'moderation', label: 'Moderation', icon: ShieldAlert },
  { value: 'results', label: 'Results', icon: Trophy },
  { value: 'admins', label: 'Admins & audit', icon: BarChart3 },
] as const;

/** The fail-safe. Routing should make this unreachable; it is here for when it doesn't. */
function NotAuthorised(): JSX.Element {
  return (
    <main className="mx-auto max-w-page px-page py-section">
      <Panel>
        <EmptyState
          title="Administrators only"
          description="This page manages the contest — the timeline, moderation, results and who else can administer it. Your account does not have administrator access. If that looks wrong, ask a current administrator to promote you."
        />
      </Panel>
    </main>
  );
}

export function Admin(): JSX.Element {
  const { status, isAdmin, me } = useAuth();
  const [tab, setTab] = React.useState<string>(TAB_DEFS[0].value);

  const contest = useQuery({
    queryKey: queryKeys.contest,
    queryFn: () => api.contest(),
    // Only fetch once we know the caller is allowed to be here.
    enabled: status === 'signed-in' && isAdmin,
  });

  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-page px-page py-section">
        <Spinner label="Loading your account" />
      </main>
    );
  }

  // Fail safe: anything other than a confirmed admin gets the refusal, never
  // a partially-rendered console.
  if (status !== 'signed-in' || !isAdmin) return <NotAuthorised />;

  const data = contest.data;
  const nextDeadline =
    data?.phase === 'SUBMISSIONS_OPEN'
      ? data.submissionsCloseAt
      : data?.phase === 'VOTING_OPEN'
        ? data.votingClosesAt
        : null;

  return (
    <main className="mx-auto max-w-page px-page py-section">
      <PageHeader
        eyebrow="Administration"
        title={data?.title ?? 'Logo design contest'}
        description="Everything that changes the contest happens here. Destructive steps ask first, and every action on this page is written to the audit log."
        actions={
          data ? (
            <div className="flex items-center gap-base">
              <Badge tone="accent">{PHASE_LABELS[data.phase]}</Badge>
              {nextDeadline && (
                <span className="text-sm tabular-nums text-ink-muted">
                  <Countdown
                    to={nextDeadline}
                    serverNow={data.serverNow}
                    expired="Deadline passed"
                  />{' '}
                  · {formatAbsolute(nextDeadline)}
                </span>
              )}
            </div>
          ) : undefined
        }
      />

      {contest.isError ? (
        <Panel>
          <EmptyState
            title="Could not load the contest"
            description={adminErrorMessage(contest.error, 'The contest settings are unavailable.')}
            action={
              <Button variant="secondary" onClick={() => void contest.refetch()}>
                Try again
              </Button>
            }
          />
        </Panel>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="mt-section">
          <TabsList aria-label="Contest administration sections">
            {TAB_DEFS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon aria-hidden className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="pt-loose">
            <TabsContent value="timeline">
              {data ? <TimelineTab contest={data} /> : <Skeleton className="h-32 w-full" />}
            </TabsContent>

            <TabsContent value="phase">
              {data ? <PhaseTab contest={data} /> : <Skeleton className="h-32 w-full" />}
            </TabsContent>

            <TabsContent value="turnout">
              <TurnoutTab />
            </TabsContent>

            {/*
              Mounted only while selected. The moderation route writes an audit
              entry on every call, so pre-fetching it in the background would
              log an identity lookup nobody asked for.
            */}
            <TabsContent value="moderation">
              <ModerationTab />
            </TabsContent>

            <TabsContent value="results">
              <ResultsTab />
            </TabsContent>

            <TabsContent value="admins">
              <AdminsAuditTab currentUid={me?.uid ?? null} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </main>
  );
}

// Named export matches the file name, as on every other page. The `AdminPage`
// alias is kept so `./AdminPage` can keep re-exporting it.
export { Admin as AdminPage };
export default Admin;
