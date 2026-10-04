import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FullPageSpinnerProps {
  /** Announced and shown under the spinner. */
  label?: string;
  /** Fill the viewport (route-level suspense) or just the parent box. */
  fullscreen?: boolean;
  className?: string;
}

/**
 * The route-level loading state — what `<Suspense>` falls back to while a
 * lazily-loaded page chunk arrives.
 *
 * `role="status"` + `aria-live="polite"` so the wait is announced once,
 * politely, rather than leaving a screen-reader user on a silent blank page.
 * The spinner glyph itself is `aria-hidden`; the text does the talking.
 *
 * `motion-safe:animate-spin` — with reduced motion requested the icon holds
 * still and the label carries the meaning. A perpetually spinning element is
 * one of the more reliable ways to trigger vestibular discomfort.
 */
export function FullPageSpinner({
  label = 'Loading…',
  fullscreen = true,
  className,
}: FullPageSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 bg-background',
        fullscreen ? 'min-h-[60vh]' : 'py-16',
        className,
      )}
    >
      <Loader2 aria-hidden="true" className="size-5 text-muted-foreground motion-safe:animate-spin" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
