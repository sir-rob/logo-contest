/**
 * One entry in the live projection.
 *
 * Nothing here identifies an uploader. The DTO carries an alias and an image
 * and that is all there is to render — the anonymity boundary is upstream in
 * `packages/shared/src/api.ts`, and this component simply has nothing else to
 * leak.
 *
 * Elimination is never signalled by colour alone: an eliminated row is dimmed,
 * desaturated, drops its rank number, and carries a text label saying which
 * round it went out in. Any one of those alone would fail somebody.
 */

import { motion } from 'framer-motion';
import { Badge } from '@/components/ui';
import { cn, clamp, formatPercent, plural } from '@/lib/utils';
import { displayAlias, eliminationLabel, type OrderedStanding } from './standings';

export interface StandingRowProps {
  row: OrderedStanding;
  /** Front-runner in the current round. Gets the one accent on the page. */
  isLeader: boolean;
  /** The front-runner is already over the line. */
  hasMajority: boolean;
  reduceMotion: boolean;
}

export function StandingRow({
  row,
  isLeader,
  hasMajority,
  reduceMotion,
}: StandingRowProps): JSX.Element {
  const { entry, position } = row;
  const eliminated = entry.eliminated;
  const width = `${clamp(entry.share, 0, 1) * 100}%`;
  const share = formatPercent(entry.share);
  const alias = displayAlias(entry.alias);

  const transition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 220, damping: 30 };

  return (
    <motion.li
      layout={!reduceMotion}
      transition={transition}
      className={cn(
        'grid grid-cols-[1.75rem_2.5rem_minmax(0,1fr)] items-center gap-3 py-3',
        'sm:grid-cols-[2rem_3rem_minmax(0,1fr)_5rem_3.5rem] sm:gap-4',
        eliminated && 'opacity-60',
      )}
      data-eliminated={eliminated ? 'true' : undefined}
    >
      {/* Position. Eliminated entries deliberately have none: "4th" would imply
          they are still in a race they have already left. */}
      <span
        data-tabular
        className={cn(
          'text-right text-sm',
          eliminated ? 'text-ink-faint' : 'text-ink-muted',
          isLeader && !eliminated && 'text-ink',
        )}
        aria-hidden={position === null ? 'true' : undefined}
      >
        {position ?? '—'}
      </span>

      <div className={cn('entry-frame h-10 w-10 sm:h-12 sm:w-12', eliminated && 'grayscale')}>
        <img src={entry.thumbUrl} alt="" className="max-h-full max-w-full object-contain" />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              'truncate text-body',
              eliminated ? 'text-ink-muted' : 'text-ink',
              isLeader && !eliminated && 'font-medium',
            )}
          >
            {alias}
          </span>

          {eliminated ? (
            <Badge tone="neutral">{eliminationLabel(entry)}</Badge>
          ) : isLeader ? (
            <Badge tone="accent">{hasMajority ? 'Majority' : 'Leading'}</Badge>
          ) : null}
        </div>

        {/* The bar is decoration for a figure already written out as text, so
            it is hidden from assistive tech rather than duplicated into it. */}
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper-sunken"
          aria-hidden="true"
        >
          <motion.div
            className={cn(
              'h-full rounded-full',
              eliminated ? 'bg-ink-faint' : isLeader ? 'bg-accent' : 'bg-ink-subtle',
            )}
            initial={false}
            animate={{ width }}
            transition={transition}
          />
        </div>

        {/* Below `sm` the two right-hand columns fold into this line instead of
            pushing the table sideways. */}
        <p data-tabular className="mt-1 text-xs text-ink-subtle sm:hidden">
          {plural(entry.votes, 'vote')} · {share}
          {eliminated ? ` · ${eliminationLabel(entry)}` : ''}
        </p>
      </div>

      <span data-tabular className="hidden text-right text-sm text-ink-muted sm:block">
        {plural(entry.votes, 'vote')}
      </span>
      <span
        data-tabular
        className={cn(
          'hidden text-right text-sm sm:block',
          eliminated ? 'text-ink-subtle' : 'text-ink',
        )}
      >
        {share}
      </span>
    </motion.li>
  );
}
