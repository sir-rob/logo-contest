/**
 * The round-by-round count as a vertical stack — the narrow-screen view.
 *
 * A horizontal Sankey cannot be made legible at 375px: eight columns of
 * eleven-pixel type is a chart nobody can read, and making the page scroll
 * sideways just hides that fact behind a gesture. So on phones the flow is
 * replaced outright by this list, which carries EVERY piece of information the
 * flow does — tallies, the majority threshold, who was eliminated, where their
 * ballots went, how many exhausted, and any tie-break — in a layout that works
 * in one column.
 *
 * It is a genuine fallback, not a summary. If something is only in the chart,
 * it is a bug.
 *
 * ACCESSIBILITY: `aria-hidden`, like the flow. `RoundTable` is the accessible
 * representation for every viewport, so assistive tech gets one consistent
 * version of the count rather than two that could drift.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { Badge } from '@/components/ui';
import { cn, formatPercent } from '@/lib/utils';
import type { ResultsModel, RoundView } from './results-model';

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

interface RoundListProps {
  model: ResultsModel;
  className?: string;
}

export function RoundList({ model, className }: RoundListProps): JSX.Element {
  return (
    <ol className={cn('space-y-8', className)} aria-hidden="true">
      {model.rounds.map((round) => (
        <li key={round.number}>
          <RoundCard round={round} />
        </li>
      ))}
    </ol>
  );
}

function RoundCard({ round }: { round: RoundView }): JSX.Element {
  const prefersReduced = useReducedMotion() ?? false;
  const thresholdPct = round.activeBallots > 0 ? (round.threshold / round.activeBallots) * 100 : 0;

  return (
    <div className="border-t border-line pt-4">
      {/* ---- round header ---------------------------------------------- */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-display-sm">{`Round ${round.number}`}</h3>
        <p className="text-xs text-ink-muted" data-tabular>
          {round.activeBallots} counting
          {round.exhaustedBallots > 0 ? ` · ${round.exhaustedBallots} exhausted` : null}
        </p>
      </div>
      <p className="mt-1 text-xs text-ink-subtle" data-tabular>
        {`Majority needs ${round.threshold} of ${round.activeBallots}`}
      </p>

      {/* ---- tallies ----------------------------------------------------- */}
      <ul className="mt-4 space-y-2.5">
        {round.rows.map((row) => {
          const pct = row.share * 100;
          const accented = row.candidate.isWinner;
          return (
            <li key={row.candidate.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    'truncate text-sm',
                    row.isEliminatedHere ? 'text-ink-muted line-through' : 'text-ink',
                    accented && 'font-medium',
                  )}
                >
                  {row.candidate.alias}
                </span>
                <span
                  className="shrink-0 text-sm text-ink"
                  data-tabular
                >
                  {row.votes}
                  <span className="ml-1.5 text-xs text-ink-subtle">{formatPercent(row.share)}</span>
                </span>
              </div>

              {/* bar track, with the majority line drawn across it */}
              <div className="relative mt-1.5 h-2 overflow-hidden rounded-sm border border-line bg-paper-sunken">
                <motion.div
                  className={cn('h-full', accented ? 'bg-accent' : 'bg-ink/25')}
                  initial={prefersReduced ? false : { width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={prefersReduced ? { duration: 0 } : { duration: 0.28, ease: EASE }}
                />
                {thresholdPct > 0 && thresholdPct <= 100 ? (
                  <span
                    className="absolute inset-y-0 w-px bg-ink/45"
                    style={{ left: `${thresholdPct}%` }}
                  />
                ) : null}
              </div>

              {/* Elimination is stated in words and position, never by colour. */}
              {row.isEliminatedHere ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {`Eliminated in round ${round.number}`}
                </p>
              ) : null}
              {row.isWinnerHere ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {`Reached a majority in round ${round.number}`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* ---- tie-break --------------------------------------------------- */}
      {round.tieBreak ? (
        <div className="mt-4 rounded border border-line bg-paper-sunken p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">Tie-break</Badge>
            <span className="text-xs text-ink-muted">{round.tieBreak.label}</span>
          </div>
          <p className="mt-2 text-sm text-ink">
            {`${round.tieBreak.tied.map((c) => c.alias).join(' and ')} were tied.`}{' '}
            {round.tieBreak.eliminated
              ? `${round.tieBreak.eliminated.alias} was eliminated.`
              : null}
          </p>
        </div>
      ) : null}

      {/* ---- transfers --------------------------------------------------- */}
      {round.transfer ? (
        <div className="mt-4">
          <p className="eyebrow">Where those ballots went</p>
          <ul className="mt-2 space-y-1">
            {round.transfer.moves.map((move) => (
              <li
                key={move.to.id}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="truncate text-ink-muted">{`→ ${move.to.alias}`}</span>
                <span className="shrink-0 text-ink" data-tabular>{`+${move.count}`}</span>
              </li>
            ))}
            {round.transfer.exhausted > 0 ? (
              <li className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink-muted">
                  → Exhausted (no preferences left)
                </span>
                <span className="shrink-0 text-ink" data-tabular>
                  {`+${round.transfer.exhausted}`}
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
