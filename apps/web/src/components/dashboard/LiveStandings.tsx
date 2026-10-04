/**
 * The live standings block.
 *
 * The single most important thing on this page is the LABEL, not the numbers.
 * A reader who assumes these are first-choice vote totals will misread every
 * figure below them and then argue with the final result. So the heading, the
 * description and the footnote all say the same thing in plain English: this
 * is the full ranked-choice count, re-run against the ballots in so far.
 */

import { motion, useReducedMotion } from 'framer-motion';
import type { StandingEntryDto } from '@contest/shared';
import { Badge, EmptyState, Panel, PanelHeader } from '@/components/ui';
import { plural } from '@/lib/utils';
import { StandingRow } from './StandingRow';
import { summariseStandings } from './standings';

export interface LiveStandingsProps {
  standings: StandingEntryDto[] | null;
  standingsHiddenReason: string | null;
  ballotsCast: number;
}

export function LiveStandings({
  standings,
  standingsHiddenReason,
  ballotsCast,
}: LiveStandingsProps): JSX.Element {
  const reduceMotion = useReducedMotion() ?? false;

  // A hidden projection is a deliberate state — an admin switched it off, or
  // there are too few ballots for it to mean anything yet. It is not an error
  // and must not be dressed as one.
  if (standings === null) {
    return (
      <Panel>
        <PanelHeader
          eyebrow="Live projection"
          title="Standings are hidden"
          description="They will appear here if and when they are turned back on."
        />
        <EmptyState
          title="Not showing standings right now"
          description={standingsHiddenReason ?? 'Standings are unavailable at the moment.'}
        />
      </Panel>
    );
  }

  if (standings.length === 0) {
    return (
      <Panel>
        <PanelHeader
          eyebrow="Live projection"
          title="Standings so far"
          description="A full ranked-choice count of the ballots cast so far — not first-choice totals."
        />
        <EmptyState
          title="Nothing to count yet"
          description="The projection appears as soon as the first ballots come in."
        />
      </Panel>
    );
  }

  const summary = summariseStandings(standings, ballotsCast);
  const { continuing, eliminated, activeBallots, exhaustedBallots, majorityThreshold } = summary;

  return (
    <Panel>
      <PanelHeader
        eyebrow="Live projection"
        title="Standings so far"
        description="A full ranked-choice count of every ballot cast so far — not first-choice totals. Lower choices are already being redistributed, so positions move as ballots arrive."
        actions={<Badge tone="neutral">Updates automatically</Badge>}
      />

      {/* Column headings, only where there are columns to head. */}
      <div
        className="hidden grid-cols-[2rem_3rem_minmax(0,1fr)_5rem_3.5rem] gap-4 border-b border-line pb-2 sm:grid"
        aria-hidden="true"
      >
        <span className="eyebrow text-right">#</span>
        <span className="eyebrow">Entry</span>
        <span className="eyebrow" />
        <span className="eyebrow text-right">Votes</span>
        <span className="eyebrow text-right">Share</span>
      </div>

      <motion.ul layout={!reduceMotion} className="divide-y divide-line">
        {continuing.map((row) => (
          <StandingRow
            key={row.entry.submissionId}
            row={row}
            isLeader={row.position === 1}
            hasMajority={summary.leaderHasMajority}
            reduceMotion={reduceMotion}
          />
        ))}
      </motion.ul>

      {eliminated.length > 0 && (
        <div className="mt-roomy">
          <h3 className="eyebrow">Eliminated</h3>
          <p className="mt-1 text-xs text-ink-subtle">
            Their ballots have already moved to whichever entry each voter ranked next.
          </p>
          <motion.ul layout={!reduceMotion} className="mt-2 divide-y divide-line">
            {eliminated.map((row) => (
              <StandingRow
                key={row.entry.submissionId}
                row={row}
                isLeader={false}
                hasMajority={false}
                reduceMotion={reduceMotion}
              />
            ))}
          </motion.ul>
        </div>
      )}

      <footer className="mt-roomy border-t border-line pt-base text-xs text-ink-muted">
        {activeBallots !== null && majorityThreshold !== null ? (
          <p data-tabular>
            {plural(activeBallots, 'ballot')} still counting.{' '}
            {exhaustedBallots !== null && exhaustedBallots > 0
              ? `${plural(exhaustedBallots, 'ballot')} ran out of ranked choices and no longer count toward anyone. `
              : 'Every ballot cast is still counting. '}
            A majority means more than half of the ballots still counting — right now that is{' '}
            {plural(majorityThreshold, 'vote')}, not half of the {ballotsCast} cast.
          </p>
        ) : (
          <p>
            Shares are measured against the ballots still counting — ballots whose ranked choices
            have all been eliminated stop counting toward anyone.
          </p>
        )}
        <p className="mt-1">
          Positions are a projection, not a result. Every ballot that arrives re-runs the whole
          count from the top.
        </p>
      </footer>
    </Panel>
  );
}
