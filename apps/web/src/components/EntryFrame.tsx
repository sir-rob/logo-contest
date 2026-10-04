/**
 * The one frame every logo is shown in.
 *
 * Identical for all entries: same square aspect, same padding, same paper
 * background, same hairline. That sameness is the point — presentation must
 * never advantage an entry, so there is deliberately no `size`, `elevated` or
 * `featured` prop here. If a future screen wants a logo to stand out, the
 * answer is a label or a position, not a different frame.
 *
 * The gallery, the lightbox and the upload preview all render through this, so
 * a person choosing a file sees exactly what everyone else will see.
 */

import { cn } from '@/lib/utils';

export interface EntryFrameProps {
  src: string;
  /** Required. There is no sensible default for someone using a screen reader. */
  alt: string;
  /** Off the critical path by default: a gallery is mostly below the fold. */
  loading?: 'lazy' | 'eager';
  className?: string;
}

export function EntryFrame({ src, alt, loading = 'lazy', className }: EntryFrameProps): JSX.Element {
  return (
    <div className={cn('entry-frame p-base', className)}>
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        draggable={false}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

/**
 * The same frame with nothing in it — used while the upload form is waiting
 * for a file, so the layout does not jump once one arrives.
 */
export function EmptyEntryFrame({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('entry-frame p-base border-dashed text-center', className)}>
      <div className="text-xs text-ink-subtle">{children}</div>
    </div>
  );
}
