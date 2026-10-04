/**
 * A small square thumbnail for the compact ballot rows.
 *
 * NOT a replacement for `EntryFrame` — the pool tiles use that, because the
 * gallery frame's identical padding and aspect is what stops presentation
 * advantaging an entry. But `EntryFrame` bakes in `p-base` (16px), which at the
 * 40px size a slot row needs would leave about eight pixels of logo. This is
 * the same neutral frame without the padding, used only where the image is an
 * aid to recognition rather than the thing being judged.
 *
 * `alt=""` is deliberate. Every row that renders one of these also renders the
 * entry's alias and title as real text immediately beside it, so describing the
 * image again would make a screen reader say "Entry 07" twice and tell nobody
 * anything new.
 */

import type { PublicSubmissionDto } from '@contest/shared';
import { cn } from '@/lib/utils';

export interface EntryThumbProps {
  entry: Pick<PublicSubmissionDto, 'thumbUrl'>;
  className?: string;
  /** Rows are few and above the fold; tiles in a long pool are not. */
  eager?: boolean;
}

export function EntryThumb({ entry, className, eager = false }: EntryThumbProps): JSX.Element {
  return (
    <div className={cn('entry-frame', className)}>
      <img
        src={entry.thumbUrl}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
