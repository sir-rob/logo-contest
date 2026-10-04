/**
 * Final placement for every entry.
 *
 * A real table, semantically — this one is meant to be read by everybody, so it
 * is not `aria-hidden` and gets proper row headers. Thumbnails are the same
 * `.entry-frame` treatment used everywhere else so that presentation never
 * advantages an entry, including in defeat.
 *
 * "Round eliminated" is a column rather than a visual state, because the
 * elimination round is the single most useful fact about a losing entry and
 * encoding it as a fade would put it out of reach of half the audience.
 */

import { Panel, PanelHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ResultsModel } from './results-model';

interface FinalStandingsProps {
  model: ResultsModel;
  className?: string;
}

export function FinalStandings({ model, className }: FinalStandingsProps): JSX.Element {
  return (
    <Panel className={cn('p-6', className)}>
      <PanelHeader
        title="Final standings"
        description="Placement follows the order entries left the count — the last one standing wins, the last one eliminated places second, and so on."
      />

      <div className="mt-5 overflow-x-auto" data-tabular>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line-strong">
              <th
                scope="col"
                className="w-12 px-2 py-2 text-left text-xs font-medium text-ink-muted"
              >
                #
              </th>
              <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-ink-muted">
                Entry
              </th>
              <th
                scope="col"
                className="whitespace-nowrap px-2 py-2 text-right text-xs font-medium text-ink-muted"
              >
                Final votes
              </th>
              <th
                scope="col"
                className="whitespace-nowrap px-2 py-2 text-right text-xs font-medium text-ink-muted"
              >
                Left the count
              </th>
            </tr>
          </thead>
          <tbody>
            {model.candidates.map((candidate) => (
              <tr key={candidate.id} className="border-b border-line">
                <td className="px-2 py-3 text-sm text-ink-muted align-middle">
                  {candidate.place}
                </td>
                <th scope="row" className="px-2 py-3 text-left font-normal align-middle">
                  <div className="flex items-center gap-3">
                    <div className="entry-frame size-11 shrink-0 p-1">
                      {candidate.thumbUrl ? (
                        <img
                          src={candidate.thumbUrl}
                          alt=""
                          className="max-h-full w-auto object-contain"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'truncate text-sm text-ink',
                          candidate.isWinner && 'font-medium',
                        )}
                      >
                        {candidate.alias}
                      </p>
                      {candidate.title ? (
                        <p className="truncate text-xs text-ink-subtle">{candidate.title}</p>
                      ) : null}
                    </div>
                  </div>
                </th>
                <td className="whitespace-nowrap px-2 py-3 text-right text-sm text-ink align-middle">
                  {candidate.finalVotes}
                </td>
                <td className="whitespace-nowrap px-2 py-3 text-right text-sm text-ink-muted align-middle">
                  {candidate.isWinner
                    ? 'Won'
                    : candidate.eliminatedInRound !== null
                      ? `Round ${candidate.eliminatedInRound}`
                      : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
