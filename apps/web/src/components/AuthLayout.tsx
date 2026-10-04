/**
 * The frame every signed-out screen sits in.
 *
 * Sign-in, the check-your-inbox state, the wrong-door screen and the expired
 * link all share it, so a person moving between them sees one continuous page
 * rather than four differently-shaped ones.
 */

import type { ReactNode } from 'react';
import { Panel } from '@/components/ui';
import { CONTEST_NAME } from '@/lib/branding';
import { cn } from '@/lib/utils';

export function AuthLayout({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-paper px-base py-loose">
      <main className={cn('mx-auto flex w-full max-w-measure flex-1 flex-col justify-center', className)}>
        <p className="mb-snug text-label uppercase text-ink-subtle">{CONTEST_NAME}</p>

        <Panel className="rounded border border-line bg-paper-raised p-roomy">
          <h1 className="font-display text-display-sm text-ink">{title}</h1>
          {description ? <p className="mt-snug text-sm text-ink-muted">{description}</p> : null}
          <div className="mt-base">{children}</div>
        </Panel>

        {footer ? <div className="mt-base text-sm text-ink-subtle">{footer}</div> : null}
      </main>
    </div>
  );
}
