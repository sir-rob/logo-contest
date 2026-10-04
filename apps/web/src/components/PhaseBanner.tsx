/**
 * A slim strip under the header: where the contest is, and when that changes.
 *
 * The countdown is anchored to `serverNow` from the contest DTO, NEVER to the
 * browser clock. A laptop four minutes fast must not show voting opening four
 * minutes early — and on a deadline-driven app, that skew is the difference
 * between "I submitted in time" and an argument.
 *
 * One line. It reports; it does not decorate.
 */

import { CalendarClock } from 'lucide-react';
import { PHASE_LABELS } from '@contest/shared';
import { Badge, Countdown, Skeleton } from '@/components/ui';
import { useContest } from '@/lib/contest';
import { cn } from '@/lib/utils';

export function PhaseBanner({ className }: { className?: string }): JSX.Element | null {
  const { contest, phase, next, isLoading, error } = useContest();

  if (isLoading) {
    return (
      <div className={cn('border-b border-line bg-paper-sunken', className)}>
        <div className="mx-auto max-w-page px-base py-snug">
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    );
  }

  // A failed contest fetch is reported by the page itself. A broken strip here
  // would just be noise at the top of an already-unhappy screen.
  if (error || !contest || !phase) return null;

  return (
    <div className={cn('border-b border-line bg-paper-sunken', className)}>
      <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-base gap-y-tight px-base py-snug">
        <div className="flex items-center gap-tight">
          <CalendarClock aria-hidden="true" className="h-4 w-4 text-ink-subtle" />
          <span className="text-sm text-ink">{PHASE_LABELS[phase]}</span>
        </div>

        {next ? (
          <p className="text-sm text-ink-muted">
            <span>{next.label} in </span>
            <Countdown
              to={next.at.toISOString()}
              serverNow={contest.serverNow}
              expired={<span>a moment</span>}
              className="font-mono tabular-nums text-ink"
            />
            <span className="text-ink-subtle">
              {' '}
              &middot;{' '}
              {next.at.toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
              })}
            </span>
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            {phase === 'RESULTS_PUBLISHED'
              ? 'Results are published below.'
              : 'No deadlines remaining.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** The phase as a single badge, for the header. */
export function PhaseBadge(): JSX.Element | null {
  const { phase } = useContest();
  if (!phase) return null;

  // The accent marks the one phase that wants action from you right now.
  const tone = phase === 'SUBMISSIONS_OPEN' || phase === 'VOTING_OPEN' ? 'accent' : 'neutral';
  return <Badge tone={tone}>{PHASE_LABELS[phase]}</Badge>;
}
