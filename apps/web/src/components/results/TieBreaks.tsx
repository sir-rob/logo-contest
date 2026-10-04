/**
 * Tie-breaks, stated plainly and never folded away.
 *
 * At 10–25 voters a tie is ordinary, not exotic: two entries sitting on two
 * votes each in round three is a Tuesday. The failure mode this section exists
 * to prevent is someone watching their favourite vanish from the chart with no
 * stated reason and concluding the count was rigged. An unexplained elimination
 * is the single fastest way to lose trust in a ranked-choice result, so the
 * rule for this block is: visible by default, full sentences, and the actual
 * `TIE_BREAK_LABELS` wording rather than a paraphrase.
 *
 * Unlike the flow and the list, this is NOT `aria-hidden`. It is the one and
 * only place tie-breaks are described, for every user.
 */

import { Badge, Panel, PanelHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ResultsModel } from './results-model';

interface TieBreaksProps {
  model: ResultsModel;
  className?: string;
}

export function TieBreaks({ model, className }: TieBreaksProps): JSX.Element | null {
  if (model.tieBreaks.length === 0) return null;

  return (
    <Panel className={cn('p-6', className)}>
      <PanelHeader
        title="Tie-breaks"
        description={
          model.tieBreaks.length === 1
            ? 'One round was too close to decide on the tally alone. Here is exactly how it was settled.'
            : `${model.tieBreaks.length} rounds were too close to decide on the tally alone. Here is exactly how each was settled.`
        }
      />

      <ul className="mt-5 space-y-5">
        {model.tieBreaks.map(({ round, tieBreak }) => (
          <li key={round.number} className="border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{`Round ${round.number}`}</span>
              <Badge tone="warning">Tie-break</Badge>
              {tieBreak.wasAdminDecision ? <Badge>Administrator decision</Badge> : null}
            </div>

            <p className="mt-2 text-sm text-ink">
              {tieBreak.tied.length > 0
                ? `${joinAliases(tieBreak.tied.map((c) => c.alias))} were tied on the deciding number.`
                : 'Two or more entries were tied on the deciding number.'}{' '}
              {tieBreak.eliminated
                ? `${tieBreak.eliminated.alias} was eliminated.`
                : 'One of them was eliminated.'}
            </p>

            <p className="mt-1 text-sm text-ink-muted">
              <span className="text-ink-subtle">Rule applied: </span>
              {tieBreak.label}.
            </p>

            {tieBreak.reason === 'seeded_shuffle' ? (
              <p className="mt-1 text-xs text-ink-subtle">
                The seed is fixed and published below, so this draw produces the same result every
                time the count is re-run.
              </p>
            ) : null}
            {tieBreak.wasAdminDecision ? (
              <p className="mt-1 text-xs text-ink-subtle">
                A human made this call and it is recorded in the audit log.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** "A", "A and B", "A, B and C" — Oxford-free, matches the rest of the copy. */
function joinAliases(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1] ?? '';
  return `${head} and ${tail}`;
}
