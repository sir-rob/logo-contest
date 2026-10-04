/**
 * The published-results summary.
 *
 * Deliberately thin: the winner, who made it if they chose to be named, and a
 * door through to `/results`. The round-by-round elimination visual belongs to
 * that page and is not duplicated here — two versions of the same count that
 * could ever disagree is worse than one.
 */

import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PublicSubmissionDto } from '@contest/shared';
import { Badge, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui';
import { displayAlias } from './standings';

export interface WinnerSummaryProps {
  winner: PublicSubmissionDto | null;
  /** Only ever set when the winner opted in at upload time. */
  winnerCredit: string | null;
  isLoading: boolean;
  /** True when the results call failed; the link still works. */
  failed: boolean;
}

export function WinnerSummary({
  winner,
  winnerCredit,
  isLoading,
  failed,
}: WinnerSummaryProps): JSX.Element {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Final result"
        title="The winner"
        description="Decided by a full ranked-choice count of every ballot cast."
        actions={<Badge tone="accent">Published</Badge>}
      />

      {isLoading ? (
        <div className="flex items-center gap-roomy">
          <Skeleton className="h-32 w-32 shrink-0" />
          <div className="w-full space-y-2">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : failed || winner === null ? (
        <EmptyState
          title={failed ? 'Could not load the winner just now' : 'No winner recorded'}
          description="The full count is on the results page."
          action={<ResultsLink label="Open the results" />}
        />
      ) : (
        <div className="flex flex-col gap-roomy sm:flex-row sm:items-center">
          <div className="entry-frame h-32 w-32 shrink-0 p-3 sm:h-[10rem] sm:w-[10rem]">
            <img
              src={winner.displayUrl}
              alt={`Winning entry: ${displayAlias(winner.alias)}`}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          <div className="min-w-0">
            <p className="eyebrow">{displayAlias(winner.alias)}</p>
            {winner.title ? (
              <h3 className="mt-1 text-display-md">{winner.title}</h3>
            ) : (
              <h3 className="mt-1 text-display-md">{displayAlias(winner.alias)}</h3>
            )}
            {winnerCredit ? (
              <p className="mt-2 text-sm text-ink-muted">Designed by {winnerCredit}</p>
            ) : (
              <p className="mt-2 text-sm text-ink-subtle">
                The designer chose to stay anonymous.
              </p>
            )}
            <div className="mt-base">
              <ResultsLink label="See the round-by-round count" />
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ResultsLink({ label }: { label: string }): JSX.Element {
  return (
    <Link
      to="/results"
      className="inline-flex items-center gap-1 rounded text-sm text-accent underline underline-offset-4 hover:text-accent-hover"
    >
      {label}
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </Link>
  );
}
