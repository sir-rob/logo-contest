/**
 * Surfaces and headers.
 *
 * There are no shadows in this file. Elevation is a hairline and some space —
 * shadows are reserved for things that genuinely float (dialog, dropdown).
 * Cards-inside-cards is the failure mode this is designed to prevent.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PanelProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}

export function Panel({ children, className, as = 'div' }: PanelProps): JSX.Element {
  const Tag = as;
  return (
    <Tag className={cn('rounded-lg border border-line bg-paper-raised p-roomy', className)}>{children}</Tag>
  );
}

export interface PanelHeaderProps {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}

export function PanelHeader({ title, eyebrow, description, actions }: PanelHeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-base">
      <div className="min-w-0 max-w-measure">
        {eyebrow ? <p className="eyebrow mb-hair">{eyebrow}</p> : null}
        <h2 className="font-display text-display-sm text-ink">{title}</h2>
        {description ? <p className="mt-tight text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-tight">{actions}</div> : null}
    </div>
  );
}

/** The hairline that does the work a border-on-a-card would otherwise do. */
export function Divider({ className }: { className?: string }): JSX.Element {
  return <hr className={cn('rule my-base', className)} />;
}

export interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, eyebrow, description, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-base">
      <div className="min-w-0 max-w-measure">
        {eyebrow ? <p className="eyebrow mb-tight">{eyebrow}</p> : null}
        <h1 className="font-display text-display-lg text-ink">{title}</h1>
        {description ? <p className="mt-snug text-lead text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-tight">{actions}</div> : null}
    </header>
  );
}
