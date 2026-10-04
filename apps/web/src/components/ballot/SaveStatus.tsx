/**
 * The autosave indicator.
 *
 * Autosave is only reassuring if you can see it working, so this is never blank
 * once the voter has touched something: unsaved → saving → saved at a time, or
 * failed with a retry sitting right next to the explanation. A spinner that
 * quietly gives up is how people lose votes.
 *
 * Status is carried by an icon AND a word, never by colour alone.
 */

import { Check, CircleAlert, RefreshCw } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import type { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { SaveStatus as SaveStatusValue } from './useBallotAutosave';

export interface SaveStatusProps {
  status: SaveStatusValue;
  lastSavedAt: Date | null;
  error: ApiClientError | null;
  onRetry: () => void;
  className?: string;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function SaveStatus({
  status,
  lastSavedAt,
  error,
  onRetry,
  className,
}: SaveStatusProps): JSX.Element {
  const savedAtLabel = lastSavedAt ? timeFormat.format(lastSavedAt) : null;

  if (status === 'error') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-snug rounded border border-danger bg-danger-soft px-snug py-tight',
          className,
        )}
      >
        <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-danger" />
        <p className="flex-1 text-sm text-ink">
          <span className="font-medium">Not saved.</span>{' '}
          {error?.message ?? 'Something went wrong on the way to the server.'}{' '}
          <span className="text-ink-muted">Your ranking is still here — nothing was lost.</span>
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <p className={cn('flex items-center gap-tight text-sm text-ink-muted', className)}>
      {status === 'saving' ? (
        <>
          <Spinner className="h-4 w-4 shrink-0" label="Saving your ballot" />
          <span>Saving…</span>
        </>
      ) : null}

      {status === 'pending' ? (
        <>
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full border border-ink-subtle"
          />
          <span>Unsaved changes</span>
        </>
      ) : null}

      {status === 'saved' ? (
        <>
          <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-success" />
          <span>Saved{savedAtLabel ? <> at {savedAtLabel}</> : null}</span>
        </>
      ) : null}

      {status === 'idle' ? (
        <span>
          {savedAtLabel ? `Saved at ${savedAtLabel}` : 'Changes save themselves as you go.'}
        </span>
      ) : null}
    </p>
  );
}
