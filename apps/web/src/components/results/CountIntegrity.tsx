/**
 * The honesty block: turnout, exhausted ballots, and the seed.
 *
 * The word "majority" changes meaning quietly in an instant-runoff count, and
 * this section exists so it does not change meaning silently. With five ranks
 * and up to twenty-five entries, a real pile of ballots can run out of
 * preferences before the final round; those ballots leave the denominator. A
 * winner on "58%" may hold well under half of everything actually cast.
 *
 * Stating that plainly costs a sentence and buys the result its credibility, so
 * the exhausted count is given the same visual weight as turnout rather than
 * being tucked into a footnote — and when it is large enough to change how the
 * headline should be read, the page says so outright.
 */

import { Divider, Panel, PanelHeader, Stat } from '@/components/ui';
import { cn, formatPercent, plural } from '@/lib/utils';
import type { ResultsModel } from './results-model';

interface CountIntegrityProps {
  model: ResultsModel;
  className?: string;
}

/** Above this share of ballots, exhaustion is material to reading the headline. */
const MATERIAL_EXHAUSTION = 0.1;

export function CountIntegrity({ model, className }: CountIntegrityProps): JSX.Element {
  const {
    totalBallots,
    exhaustedFinal,
    finalActiveBallots,
    finalThreshold,
    winner,
    winnerFinalVotes,
    winnerShareOfContinuing,
    winnerShareOfCast,
    exhaustedShare,
    tieBreakSeed,
  } = model;

  const exhaustionIsMaterial = exhaustedShare >= MATERIAL_EXHAUSTION && exhaustedFinal > 0;

  return (
    <Panel className={cn('p-6', className)}>
      <PanelHeader
        title="How to read this count"
        description="Everything the headline number depends on, in one place."
      />

      <div className="mt-5 grid gap-6 sm:grid-cols-3">
        <Stat
          label="Ballots cast"
          value={totalBallots}
          hint="Total turnout for this contest"
        />
        <Stat
          label="Ballots still counting"
          value={finalActiveBallots}
          hint={`Majority threshold ${finalThreshold}`}
        />
        <Stat
          label="Exhausted ballots"
          value={exhaustedFinal}
          hint={
            totalBallots > 0
              ? `${formatPercent(exhaustedShare)} of ballots cast`
              : 'No ballots cast'
          }
        />
      </div>

      <Divider className="my-6" />

      {/* The one sentence this whole section exists for. */}
      <p className="max-w-measure text-ink">
        {winner ? (
          <>
            {`${winner.alias} holds a majority of the ballots that were still counting in the final round — ${winnerFinalVotes} of ${finalActiveBallots}, or ${formatPercent(
              winnerShareOfContinuing,
            )}. `}
            {exhaustedFinal > 0
              ? `The other ${plural(exhaustedFinal, 'ballot')} had run out of ranked preferences by then, so they were not part of that total.`
              : 'No ballots ran out of preferences, so that is also a majority of every ballot cast.'}
          </>
        ) : (
          'No entry reached a majority of continuing ballots.'
        )}
      </p>

      {winner && exhaustionIsMaterial ? (
        <p className="mt-3 max-w-measure text-sm text-ink-muted" data-tabular>
          {`Measured against every ballot cast rather than the ones still counting, that is ${winnerFinalVotes} of ${totalBallots} — ${formatPercent(
            winnerShareOfCast,
          )}. Both numbers are true; they answer different questions, and with ${formatPercent(
            exhaustedShare,
          )} of ballots exhausted the difference is big enough to be worth stating.`}
        </p>
      ) : null}

      <Divider className="my-6" />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div>
          <p className="eyebrow">Tie-break seed</p>
          <p className="mt-1 max-w-measure text-sm text-ink-muted">
            Ties are broken from a fixed seed rather than a fresh random draw, so this count is
            reproducible: the same ballots and the same seed always produce the same result,
            including the same tie-breaks.
          </p>
        </div>
        <code className="justify-self-start rounded border border-line bg-paper-sunken px-2 py-1 font-mono text-xs text-ink sm:justify-self-end">
          {tieBreakSeed}
        </code>
      </div>
    </Panel>
  );
}
