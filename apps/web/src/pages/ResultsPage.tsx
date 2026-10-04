/**
 * Results — the signature screen.
 *
 * Reads top to bottom as an argument rather than a scoreboard: here is who won,
 * here is exactly how the count got there, here is where every entry finished,
 * and here is what you need to know to read the headline number honestly.
 *
 * The states below are deliberately not errors. "Results are not published
 * yet" and "too few ballots to publish anonymously" are both the system working
 * correctly, and dressing either in red would teach people to distrust a page
 * whose entire job is to be trusted.
 *
 * ANONYMITY: the only identity this screen can render is `winnerCredit`, and
 * only when the winner opted in. `ResultsDto` carries no uploader id, no email
 * and no display name for anyone else, so there is nothing here to leak.
 */

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hourglass, Info, Lock } from 'lucide-react';
import { canViewResults, type ErrorCode } from '@contest/shared';
import { ApiClientError, api } from '@/lib/api';
import { EmptyState, PageHeader } from '@/components/ui';
import { CountPanel } from '@/components/results/CountPanel';
import { CountIntegrity } from '@/components/results/CountIntegrity';
import { FinalStandings } from '@/components/results/FinalStandings';
import { ResultsSkeleton } from '@/components/results/ResultsSkeleton';
import { TieBreaks } from '@/components/results/TieBreaks';
import { WinnerPanel } from '@/components/results/WinnerPanel';
import { buildResultsModel } from '@/components/results/results-model';

/** Expected outcomes, not transient faults — retrying them would be noise. */
const TERMINAL_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'PHASE_RESULTS_NOT_PUBLISHED',
  'RESULTS_TOO_FEW_BALLOTS',
  'RESULTS_NOT_COMPUTED',
  'FORBIDDEN',
  'AUTH_REQUIRED',
]);

const codeOf = (error: unknown): ErrorCode | null =>
  error instanceof ApiClientError ? error.code : null;

export function ResultsPage(): JSX.Element {
  const contestQuery = useQuery({
    queryKey: ['contest'],
    queryFn: () => api.contest(),
  });

  const phase = contestQuery.data?.phase ?? null;
  const published = phase !== null && canViewResults(phase);

  const resultsQuery = useQuery({
    queryKey: ['results'],
    queryFn: () => api.results(),
    enabled: published,
    retry: (failureCount, error) => {
      const code = codeOf(error);
      if (code !== null && TERMINAL_CODES.has(code)) return false;
      return failureCount < 2;
    },
  });

  const header = (
    <PageHeader
      eyebrow="Results"
      title={contestQuery.data?.title ?? 'Results'}
      description="The final ranked-choice count, round by round."
    />
  );

  // ---- loading ------------------------------------------------------------
  if (contestQuery.isLoading || (published && resultsQuery.isLoading)) {
    return (
      <Page header={header}>
        <ResultsSkeleton />
      </Page>
    );
  }

  // ---- contest itself unreachable ----------------------------------------
  if (contestQuery.isError) {
    return (
      <Page header={header}>
        <EmptyState
          icon={<Info aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="We could not load the contest"
          description="Something went wrong reaching the server. Refreshing usually sorts it."
        />
      </Page>
    );
  }

  // ---- not published yet --------------------------------------------------
  const resultsCode = codeOf(resultsQuery.error);
  if (!published || resultsCode === 'PHASE_RESULTS_NOT_PUBLISHED') {
    return (
      <Page header={header}>
        <EmptyState
          icon={<Hourglass aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="Results aren't out yet"
          description="They appear here once voting has closed and an administrator publishes the count. Nothing is hidden from you specifically — the results do not exist publicly until then."
        />
      </Page>
    );
  }

  // ---- withheld to protect anonymity -------------------------------------
  if (resultsCode === 'RESULTS_TOO_FEW_BALLOTS') {
    return (
      <Page header={header}>
        <EmptyState
          icon={<Lock aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="Results are staying hidden for now"
          description="Too few ballots have been cast to publish a breakdown without making it possible to work out how individuals voted. They will be released if enough ballots come in."
        />
      </Page>
    );
  }

  // ---- computed but not yet run ------------------------------------------
  if (resultsCode === 'RESULTS_NOT_COMPUTED') {
    return (
      <Page header={header}>
        <EmptyState
          icon={<Hourglass aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="The count hasn't been run yet"
          description="Voting is over and an administrator still has to run the count. This page will fill in once they do."
        />
      </Page>
    );
  }

  if (resultsQuery.isError || !resultsQuery.data) {
    return (
      <Page header={header}>
        <EmptyState
          icon={<Info aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="We could not load the results"
          description="Something went wrong reaching the server. Refreshing usually sorts it."
        />
      </Page>
    );
  }

  // ---- the real thing -----------------------------------------------------
  const results = resultsQuery.data;
  const model = buildResultsModel(results);

  return (
    <Page header={header}>
      <div className="space-y-8">
        <WinnerPanel model={model} winnerCredit={results.winnerCredit} />
        <CountPanel model={model} />
        <TieBreaks model={model} />
        <FinalStandings model={model} />
        <CountIntegrity model={model} />
      </div>
    </Page>
  );
}

function Page({
  header,
  children,
}: {
  header: JSX.Element;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-page px-4 py-roomy sm:px-6">
      {header}
      <div className="mt-roomy">{children}</div>
    </div>
  );
}

export default ResultsPage;
