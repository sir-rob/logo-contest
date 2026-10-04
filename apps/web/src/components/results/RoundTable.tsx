/**
 * Rounds × tallies, as an actual table.
 *
 * This is not a nicety bolted on next to the chart — it is THE accessible
 * representation of the count. The flow and the stacked list are both
 * `aria-hidden`, so this is what a screen reader reads, on every viewport. An
 * SVG with no text alternative would make the one screen whose entire purpose
 * is "you can check our working" unreadable to anyone not using their eyes.
 *
 * It is always in the DOM. `visible` only controls whether sighted users see it
 * too — the "Show the numbers" toggle. Nothing about the content changes, so
 * there is no version of this page where the table and the chart disagree.
 */

import { cn } from '@/lib/utils';
import type { ResultsModel } from './results-model';

interface RoundTableProps {
  model: ResultsModel;
  /** When false the table is visually hidden but still exposed to assistive tech. */
  visible: boolean;
  id?: string;
  className?: string;
}

export function RoundTable({ model, visible, id, className }: RoundTableProps): JSX.Element {
  const { rounds, candidates, winner } = model;

  const cell = 'whitespace-nowrap px-3 py-2 text-right text-sm';
  const head = 'whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-ink-muted';

  return (
    <div
      id={id}
      className={cn(visible ? 'overflow-x-auto' : 'sr-only', className)}
      data-tabular
    >
      <table className="w-full border-collapse text-sm">
        <caption className="pb-3 text-left text-xs text-ink-muted">
          {`Round-by-round count. ${candidates.length} entries over ${rounds.length} round${
            rounds.length === 1 ? '' : 's'
          }, from ${model.totalBallots} ballot${model.totalBallots === 1 ? '' : 's'}. ` +
            'Each column is the votes an entry held at the start of that round. ' +
            'An em dash means the entry had already been eliminated.'}
        </caption>

        <thead>
          <tr className="border-b border-line-strong">
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-ink-muted">
              Entry
            </th>
            {rounds.map((round) => (
              <th key={round.number} scope="col" className={head}>
                {`Round ${round.number}`}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-ink-muted">
              Outcome
            </th>
          </tr>
        </thead>

        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.id} className="border-b border-line">
              <th scope="row" className="px-3 py-2 text-left text-sm font-normal text-ink">
                {candidate.alias}
              </th>
              {rounds.map((round) => {
                const votes = round.round.tallies[candidate.id];
                return (
                  <td key={round.number} className={cell}>
                    {votes === undefined ? (
                      <span aria-label="not in this round">—</span>
                    ) : (
                      votes
                    )}
                  </td>
                );
              })}
              <td className="whitespace-nowrap px-3 py-2 text-left text-sm text-ink-muted">
                {candidate.isWinner
                  ? 'Winner'
                  : candidate.eliminatedInRound !== null
                    ? `Eliminated in round ${candidate.eliminatedInRound}`
                    : `Placed ${candidate.place}`}
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="border-b border-line">
            <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
              Ballots still counting
            </th>
            {rounds.map((round) => (
              <td key={round.number} className={cell}>
                {round.activeBallots}
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
              Majority needed
            </th>
            {rounds.map((round) => (
              <td key={round.number} className={cell}>
                {round.threshold}
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
              Exhausted ballots
            </th>
            {rounds.map((round) => (
              <td key={round.number} className={cell}>
                {round.exhaustedBallots}
              </td>
            ))}
            <td />
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
              Eliminated
            </th>
            {rounds.map((round) => (
              <td
                key={round.number}
                className="whitespace-nowrap px-3 py-2 text-right text-xs text-ink-muted"
              >
                {round.eliminated ? round.eliminated.alias : '—'}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>

      {/* Tie-breaks are NOT restated here. They get their own always-visible,
          always-accessible section (`TieBreaks`) immediately after this one —
          repeating them would make a screen reader hear every tie-break twice. */}

      <p className="mt-4 text-sm text-ink-muted">
        {winner
          ? `${winner.alias} won with ${model.winnerFinalVotes} of the ${model.finalActiveBallots} ballots still counting in the final round, against a majority threshold of ${model.finalThreshold}. ${model.exhaustedFinal} ballot${
              model.exhaustedFinal === 1 ? '' : 's'
            } had run out of preferences by then and were not in that total.`
          : 'This count did not produce a winner.'}
      </p>
    </div>
  );
}
