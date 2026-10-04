/**
 * Confirmation dialog — a thin wrapper over Radix Dialog.
 *
 * Radix is doing the hard parts: focus trap, focus restore, Escape, scroll
 * lock, `aria-modal` and the title/description wiring. This file only supplies
 * the palette and the two-button footer.
 *
 * A dialog is one of the few things in this system allowed a shadow, because
 * it genuinely floats.
 */

import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm();
      // Only dismiss on success — if the caller throws, the dialog stays put
      // so the user can see what happened and retry.
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          // Radix logs a dev warning when no Description is rendered; passing
          // the attribute explicitly as undefined is the documented opt-out.
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={
            destructive
              ? (event) => {
                  // Land on Cancel, not on the irreversible thing.
                  event.preventDefault();
                  footerRef.current?.querySelector('button')?.focus();
                }
              : undefined
          }
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-paper-raised p-roomy shadow-overlay data-[state=open]:animate-rise-in"
        >
          <Dialog.Title className="pr-loose font-display text-display-sm text-ink">{title}</Dialog.Title>

          {description ? (
            <Dialog.Description className="mt-snug text-sm text-ink-muted">{description}</Dialog.Description>
          ) : null}

          <div ref={footerRef} className="mt-roomy flex flex-wrap justify-end gap-tight">
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>

          <Dialog.Close
            className="absolute right-base top-base inline-flex h-8 w-8 items-center justify-center rounded border border-transparent text-ink-subtle transition-colors hover:border-line-strong hover:bg-paper-sunken hover:text-ink"
            disabled={busy}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
