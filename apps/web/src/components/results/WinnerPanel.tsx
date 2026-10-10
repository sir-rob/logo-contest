/**
 * The winner.
 *
 * Presented as a result, not a celebration. No confetti, no trophy, no burst of
 * colour — a large, calmly framed logo, its alias, its title, and the number
 * that won it. The restraint is the point: this is a design contest, and a
 * screen that shouts over the winning artwork is a screen that has misread its
 * own brief.
 *
 * ANONYMITY: `winnerCredit` is rendered only when the server sends a non-null
 * value, which happens only if that person opted in at upload time. There is no
 * other name anywhere on this page, and no DTO on this screen that could supply
 * one. Everybody else stays anonymous permanently, including the runner-up.
 */

import { Panel } from '@/components/ui';
import { cn, formatPercent } from '@/lib/utils';
import type { ResultsModel } from './results-model';

interface WinnerPanelProps {
  model: ResultsModel;
  /** Opt-in credit for the winning designer. Null for everyone who did not opt in. */
  winnerCredit: string | null;
  className?: string;
}

export function WinnerPanel({ model, winnerCredit, className }: WinnerPanelProps): JSX.Element {
  const { winner } = model;

  if (!winner) {
    return (
      <Panel className={cn('p-6', className)}>
        <p className="eyebrow">Result</p>
        <h2 className="mt-2 font-display text-display-md">No winner was determined</h2>
        <p className="mt-2 max-w-measure text-ink-muted">
          The count completed without any entry reaching a majority of continuing ballots. The
          round-by-round breakdown below shows how it finished.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className={cn('p-6 sm:p-8', className)}>
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:items-center md:gap-12">
        <div className="entry-frame p-4 sm:p-6">
          {winner.thumbUrl ? (
            <img
              src={winner.entry?.displayUrl ?? winner.thumbUrl}
              alt={`The winning entry, ${winner.alias}`}
              width={winner.entry?.width}
              height={winner.entry?.height}
              className="max-h-full w-auto object-contain"
            />
          ) : null}
        </div>

        <div>
          <p className="eyebrow">Winner</p>
          <h2 className="mt-2 font-display text-display-lg">{winner.alias}</h2>

          {winner.title ? (
            <p className="mt-2 text-lead text-ink-muted">{winner.title}</p>
          ) : null}

          {/* The credit only exists if its author asked for it to. */}
          {winnerCredit ? (
            <p className="mt-4 text-sm text-ink">
              <span className="text-ink-subtle">Designed by </span>
              {winnerCredit}
            </p>
          ) : null}

          <hr className="rule my-6" />

          <p className="text-sm text-ink" data-tabular>
            {`${model.winnerFinalVotes} of ${model.finalActiveBallots} continuing ballots`}
            <span className="text-ink-subtle">
              {` · ${formatPercent(model.winnerShareOfContinuing)}`}
            </span>
          </p>
          <p className="mt-1 text-sm text-ink-muted" data-tabular>
            {`Decided in round ${model.rounds.length} of ${model.rounds.length}, against a majority threshold of ${model.finalThreshold}.`}
          </p>
        </div>
      </div>
    </Panel>
  );
}
