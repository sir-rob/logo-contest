/**
 * The count, in whichever form the viewport can actually carry.
 *
 * Three representations of one model:
 *
 *   FLOW   — the horizontal Sankey. Shown from `md` up, and only while the
 *            count is short enough for it to stay legible.
 *   LIST   — the vertical stacked rounds. Shown below `md`, and at every width
 *            once the flow would be too cramped to read. Carries identical
 *            information.
 *   TABLE  — rounds × tallies. Always in the DOM as the accessible
 *            representation; `Show the numbers` also makes it visible.
 *
 * The flow/list switch is plain CSS (`hidden md:block` / `md:hidden`) rather
 * than a measured breakpoint, so the right view is correct in the first painted
 * frame — no layout flash, no dependence on JS having run.
 *
 * The second condition is the honest one. Ranked-choice runs one round per
 * elimination, so a 12-entry contest can easily produce eight or nine columns.
 * Past `MAX_FLOW_ROUNDS` the columns get narrower than their own labels, and
 * the only way to keep the chart would be to let the page scroll sideways —
 * which just relocates the illegibility. Instead the flow steps aside and the
 * list, which does not care how many rounds there are, takes over everywhere.
 */

import { useId, useState } from 'react';
import { Button, Panel, PanelHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ResultsModel } from './results-model';
import { RoundFlow } from './RoundFlow';
import { RoundList } from './RoundList';
import { RoundTable } from './RoundTable';

/** Beyond this, columns are narrower than their labels and the flow is dropped. */
export const MAX_FLOW_ROUNDS = 6;

interface CountPanelProps {
  model: ResultsModel;
  className?: string;
}

export function CountPanel({ model, className }: CountPanelProps): JSX.Element {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const roundCount = model.rounds.length;
  const flowIsLegible = roundCount > 0 && roundCount <= MAX_FLOW_ROUNDS;

  return (
    <Panel className={cn('p-6', className)}>
      <PanelHeader
        title="Round by round"
        description={`Every ballot counts toward its highest-ranked entry that is still in. The lowest entry is eliminated each round and its ballots move to each voter's next surviving choice. Ballots with no choices left stop counting. ${
          roundCount === 1 ? 'It took one round.' : `It took ${roundCount} rounds.`
        }`}
        actions={
          <Button
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={tableId}
          >
            {showTable ? 'Hide the numbers' : 'Show the numbers'}
          </Button>
        }
      />

      {flowIsLegible ? (
        <>
          {/* Wide screens: the flow. */}
          <div className="mt-6 hidden md:block">
            <RoundFlow model={model} />
            <FlowLegend className="mt-4" />
          </div>
          {/* Phones: the same count, stacked. */}
          <div className="mt-6 md:hidden">
            <RoundList model={model} />
          </div>
        </>
      ) : (
        <div className="mt-6">
          <RoundList model={model} />
        </div>
      )}

      {/* Always present for assistive tech; `showTable` only affects sighted users. */}
      <div className={cn(showTable && 'mt-8 border-t border-line pt-6')}>
        <RoundTable model={model} visible={showTable} id={tableId} />
      </div>
    </Panel>
  );
}

/**
 * What the marks mean. Aria-hidden with the chart it describes — the table
 * needs no legend because it has headers.
 */
function FlowLegend({ className }: { className?: string }): JSX.Element {
  return (
    <ul
      className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-muted', className)}
      aria-hidden="true"
    >
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-sm border border-accent bg-accent/20" />
        The winner&rsquo;s path
      </li>
      <li className="flex items-center gap-2">
        <span className="h-3 w-5 rounded-sm border border-line-strong bg-ink/10" />
        Ballots held or transferred
      </li>
      <li className="flex items-center gap-2">
        <span
          className="h-3 w-5 rounded-sm border border-line-strong"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, hsl(var(--ink) / 0.28) 0 1.4px, transparent 1.4px 6px)',
          }}
        />
        Exhausted — no preferences left
      </li>
      <li className="flex items-center gap-2">
        <span className="h-px w-5 border-t border-dashed border-ink/50" />
        Majority threshold
      </li>
      <li>Dashed outline &middot; eliminated that round</li>
    </ul>
  );
}
