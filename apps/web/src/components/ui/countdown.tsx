/**
 * Countdown to a contest deadline.
 *
 * The clock is anchored to the SERVER. We take `serverNow` once, measure it
 * against the browser clock to get an offset, and advance from there. A user
 * whose laptop is twenty minutes fast must not believe the submission window
 * closes twenty minutes early — the deadline is the same fact for everyone.
 *
 * Announcements are deliberately coarse. The visible text ticks every second
 * and is `aria-hidden`; the polite live region renders a string that only
 * changes once a minute, so React never touches that text node in between and
 * no announcement fires. A per-second live region is unusable with a screen
 * reader.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDuration } from 'date-fns';
import { cn } from '@/lib/utils';

export interface CountdownProps {
  /** ISO-8601 target. */
  to: string;
  /** Server time at page load, ISO-8601 — the clock is anchored to the SERVER, never the browser. */
  serverNow: string;
  /** Rendered when the deadline has passed. */
  expired?: ReactNode;
  className?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Visible format:
 *   >= 1 day   "2 days, 4 hours"
 *   >= 1 hour  "4:12:09"
 *   < 1 hour   "12:09"
 */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  if (days >= 1) return formatDuration({ days, hours }, { delimiter: ', ' });
  if (hours >= 1) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Spoken format, derived from whole minutes so the string is stable for a full
 * minute at a time. Rounding up means "1 minute remaining" never reads as zero
 * while there is still time on the clock.
 */
function describeMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return 'The deadline has passed.';
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days >= 1) return `${formatDuration({ days, hours }, { delimiter: ', ' })} remaining`;
  if (hours >= 1) return `${formatDuration({ hours, minutes }, { delimiter: ', ' })} remaining`;
  return `${formatDuration({ minutes }, { delimiter: ', ' })} remaining`;
}

export function Countdown({ to, serverNow, expired, className }: CountdownProps): JSX.Element {
  const targetMs = useMemo(() => new Date(to).getTime(), [to]);

  // Sampled once per `serverNow`: how far the browser clock is from the server.
  const offsetMs = useMemo(() => new Date(serverNow).getTime() - Date.now(), [serverNow]);

  const [nowMs, setNowMs] = useState(() => Date.now() + offsetMs);

  const invalid = Number.isNaN(targetMs) || Number.isNaN(offsetMs);
  const remaining = targetMs - nowMs;
  const isExpired = !invalid && remaining <= 0;

  useEffect(() => {
    if (invalid) return undefined;
    const tick = (): void => setNowMs(Date.now() + offsetMs);
    tick();
    // Nothing left to count once the deadline is behind us.
    if (targetMs - (Date.now() + offsetMs) <= 0) return undefined;
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [offsetMs, targetMs, invalid, isExpired]);

  if (invalid) {
    return (
      <span className={cn('inline-flex items-baseline text-ink-subtle', className)}>
        <span aria-hidden="true">&mdash;</span>
        <span className="sr-only">Deadline unavailable</span>
      </span>
    );
  }

  // Whole minutes left, rounded up. This is the only input to the live region,
  // which is what keeps announcements to at most one per minute.
  const minutesLeft = Math.max(0, Math.ceil(remaining / 60_000));

  return (
    <span className={cn('inline-flex items-baseline gap-tight', className)}>
      {isExpired ? (
        <span aria-hidden="true">{expired ?? 'Deadline passed'}</span>
      ) : (
        <time dateTime={to} aria-hidden="true" data-tabular className="tabular-nums">
          {formatRemaining(remaining)}
        </time>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {describeMinutes(minutesLeft)}
      </span>
    </span>
  );
}
