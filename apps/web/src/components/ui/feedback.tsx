/**
 * Status, absence and loading.
 *
 * Badges deserve a note. The tone is carried by a tinted wash, a hairline and
 * a small dot — but the text itself stays ink. Two reasons: a badge is set at
 * 11px, where tinted text on a tinted ground struggles to clear WCAG AA (our
 * `warning` pair lands at 3.9:1, under the 4.5:1 bar); and it keeps the label
 * readable if the colour is never perceived at all. The dot is the icon that
 * pairs with the word, so tone is never the only carrier of meaning.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, { wrap: string; dot: string }> = {
  neutral: { wrap: 'border-line bg-paper-sunken', dot: 'bg-ink-faint' },
  accent: { wrap: 'border-accent/25 bg-accent-soft', dot: 'bg-accent' },
  success: { wrap: 'border-success/25 bg-success-soft', dot: 'bg-success' },
  warning: { wrap: 'border-warning/30 bg-warning-soft', dot: 'bg-warning' },
  danger: { wrap: 'border-danger/25 bg-danger-soft', dot: 'bg-danger' },
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }): JSX.Element {
  const style = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-tight rounded-full border px-snug py-hair',
        'font-sans text-label uppercase text-ink',
        style.wrap,
      )}
    >
      <span aria-hidden="true" className={cn('h-1 w-1 shrink-0 rounded-full', style.dot)} />
      {children}
    </span>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * Absence, stated calmly. An empty ballot or an entry list before the window
 * opens is a normal state, not a failure — so: dashed hairline, muted type,
 * no `role="alert"`, nothing red.
 */
export function EmptyState({ title, description, icon, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-snug rounded-lg border border-dashed border-line bg-paper px-roomy py-section text-center">
      {icon ? (
        <span aria-hidden="true" className="text-ink-faint">
          {icon}
        </span>
      ) : null}
      <h3 className="font-display text-display-sm text-ink">{title}</h3>
      {description ? <p className="max-w-measure text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-tight">{action}</div> : null}
    </div>
  );
}

/**
 * Loading placeholder. Hidden from assistive tech — a screen reader should be
 * told "loading" once by the region that owns the data, not read a wall of
 * decorative boxes.
 */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('relative h-4 w-full overflow-hidden rounded bg-paper-sunken', className)}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-paper-raised to-transparent" />
    </div>
  );
}

/** `label` is the accessible name; it is intentionally not painted on screen. */
export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }): JSX.Element {
  return (
    <span role="status" className={cn('inline-flex items-center text-ink-muted', className)}>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 16 16"
        className="h-4 w-4 animate-spin"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="8" cy="8" r="6" className="opacity-25" />
        <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
}

export function Stat({ label, value, hint }: StatProps): JSX.Element {
  return (
    <div className="grid gap-hair">
      <span className="eyebrow">{label}</span>
      {/* data-tabular keeps digits from jittering as counts tick up. */}
      <span data-tabular className="font-display text-display-md leading-none text-ink">
        {value}
      </span>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}
