/**
 * The gallery lightbox.
 *
 * Built on Radix Dialog rather than a hand-rolled overlay, because the four
 * things that make a lightbox usable — focus trapped inside it, focus returned
 * to the tile you opened it from, Escape closing it, and the rest of the page
 * hidden from assistive tech — are exactly the four things hand-rolled
 * overlays get wrong. Arrow-key paging is the only behaviour added on top.
 *
 * It shows `displayUrl` (the 1600px render) in the same neutral frame as the
 * grid. Still no uploader anywhere: the DTO has no such field, and looking at
 * an entry up close must not reveal more than looking at it small.
 */

import { forwardRef, useCallback, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PublicSubmissionDto } from '@contest/shared';
import { EntryFrame } from '@/components/EntryFrame';
import { Badge } from '@/components/ui';
import { entryAlt, entryLabel } from '@/lib/entry-labels';
import { cn } from '@/lib/utils';

export interface EntryLightboxProps {
  entries: PublicSubmissionDto[];
  /** Index into `entries`, or null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export function EntryLightbox({
  entries,
  index,
  onIndexChange,
  onClose,
}: EntryLightboxProps): JSX.Element | null {
  const open = index !== null && index >= 0 && index < entries.length;
  const entry = open ? entries[index] : undefined;

  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const hasPrevious = open && index > 0;
  const hasNext = open && index < entries.length - 1;

  const goPrevious = useCallback(() => {
    if (index !== null && index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);

  const goNext = useCallback(() => {
    if (index !== null && index < entries.length - 1) onIndexChange(index + 1);
  }, [entries.length, index, onIndexChange]);

  /**
   * Keep focus on a control that still exists. Stepping to the last entry
   * disables "Next" while it holds focus, which would otherwise drop the
   * keyboard user back at the top of the dialog.
   */
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active === nextRef.current && !hasNext) previousRef.current?.focus();
    if (active === previousRef.current && !hasPrevious) nextRef.current?.focus();
  }, [hasNext, hasPrevious, open]);

  if (!open || !entry) return null;

  const label = entryLabel(entry);

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/80 animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-0 z-50 flex flex-col gap-4 p-base outline-none sm:p-roomy',
            'animate-fade-in',
          )}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              goPrevious();
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              goNext();
            }
          }}
        >
          {/* Toolbar. Counter first so a screen reader hears position before controls. */}
          <div className="flex items-center justify-between gap-4 text-paper">
            <div className="flex items-center gap-3">
              <Dialog.Title className="font-sans text-sm font-medium text-paper">{label}</Dialog.Title>
              {entry.isMine ? <Badge>Yours</Badge> : null}
            </div>

            <div className="flex items-center gap-2">
              <p className="text-xs text-paper-sunken" data-tabular>
                {(index ?? 0) + 1} of {entries.length}
              </p>
              <Dialog.Close
                className="rounded border border-line-strong/40 p-2 text-paper transition-colors duration-fast hover:bg-paper/10"
                aria-label="Close (Escape)"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center gap-3">
            <LightboxStep
              ref={previousRef}
              direction="previous"
              disabled={!hasPrevious}
              onClick={goPrevious}
            />

            <div className="flex min-h-0 w-full max-w-[min(76vh,44rem)] flex-col gap-4">
              <EntryFrame
                src={entry.displayUrl}
                alt={entryAlt(entry)}
                loading="eager"
                className="w-full bg-paper"
              />

              {entry.title || entry.description ? (
                <div className="space-y-1 text-center">
                  {entry.title ? <p className="text-sm text-paper">{entry.title}</p> : null}
                  {entry.description ? (
                    <p className="mx-auto max-w-measure text-xs text-paper-sunken">{entry.description}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <LightboxStep ref={nextRef} direction="next" disabled={!hasNext} onClick={goNext} />
          </div>

          <p className="text-center text-xs text-paper-sunken">
            Use the left and right arrow keys to move between entries. Escape closes.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Paging control. Not the shared `Button`: this one sits on a dark scrim, and
 * the shared variants are all tuned for paper.
 */
const LightboxStep = forwardRef<
  HTMLButtonElement,
  { direction: 'previous' | 'next'; disabled: boolean; onClick: () => void }
>(function LightboxStep({ direction, disabled, onClick }, ref) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'previous' ? 'Previous entry' : 'Next entry'}
      className={cn(
        'shrink-0 rounded border border-line-strong/40 p-3 text-paper transition-colors duration-fast',
        'hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
      )}
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>
  );
});
