/**
 * The file-picking surface for an entry.
 *
 * Two ways in, deliberately. Drag-and-drop is convenient and completely
 * unusable without a mouse, so the drop target is a `<label>` bound to a real
 * `<input type="file">`. The input stays in the tab order (visually hidden, not
 * `display:none`, which would remove it from the accessibility tree); the
 * label shows the focus ring on its behalf and opens the picker on Enter or
 * Space via the browser's own behaviour. One tab stop, no keyboard trap, no
 * custom key handling to get subtly wrong.
 *
 * Validation happens here, before anything is sent — see `checkImageFile`. The
 * dropzone reports either an accepted file with its dimensions, or a rejection
 * written in plain language.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { AlertCircle, ImageUp, Loader2 } from 'lucide-react';
import { MAX_IMAGE_DIMENSION, MIN_IMAGE_DIMENSION } from '@contest/shared';
import {
  ACCEPTED_TYPES_LABEL,
  ACCEPT_ATTRIBUTE,
  MAX_UPLOAD_LABEL,
  checkImageFile,
  type AcceptedImage,
  type ImageRejection,
} from '@/lib/image-validation';
import { cn } from '@/lib/utils';

export interface UploadDropzoneProps {
  /** Called with a validated file. The caller owns `previewUrl` and must revoke it. */
  onAccepted: (image: AcceptedImage) => void;
  /** Called when the file fails a client-side check. Nothing was sent. */
  onRejected: (rejection: ImageRejection) => void;
  /** True while an upload is in flight — no swapping the file mid-request. */
  disabled?: boolean;
  /** Changes the copy from "add" to "replace". */
  hasExistingEntry?: boolean;
  /** Rejection to display inline. Owned by the parent so it survives a re-render. */
  rejection?: ImageRejection | null;
  className?: string;
}

export function UploadDropzone({
  onAccepted,
  onRejected,
  disabled = false,
  hasExistingEntry = false,
  rejection = null,
  className,
}: UploadDropzoneProps): JSX.Element {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [checking, setChecking] = useState(false);

  const dragging = dragDepth > 0 && !disabled;

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || disabled) return;
      setChecking(true);
      try {
        const result = await checkImageFile(file);
        if (result.ok) {
          const { file: accepted, width, height, previewUrl } = result;
          onAccepted({ file: accepted, width, height, previewUrl });
        } else {
          onRejected(result.rejection);
        }
      } finally {
        setChecking(false);
        // Let the same file be chosen again after a rejection — without this,
        // re-picking an identical path fires no change event.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [disabled, onAccepted, onRejected],
  );

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={disabled}
        aria-describedby={rejection ? `${hintId} ${errorId}` : hintId}
        aria-invalid={rejection ? true : undefined}
        onChange={(event) => void handleFile(event.target.files?.[0])}
        className="peer sr-only"
      />

      <label
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragDepth((depth) => depth + 1);
        }}
        onDragOver={(event) => {
          // Without this the browser navigates to the dropped file.
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragDepth((depth) => Math.max(0, depth - 1));
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragDepth(0);
          if (disabled) return;
          // One entry per person, so a multi-file drop takes the first and the
          // copy below says as much rather than silently discarding the rest.
          void handleFile(event.dataTransfer?.files?.[0]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded border border-dashed px-base py-loose text-center',
          'transition-colors duration-fast',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-paper-sunken',
          rejection ? 'border-danger' : '',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-ink-faint',
        )}
      >
        {checking ? (
          <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-ink-subtle" />
        ) : (
          <ImageUp aria-hidden="true" className="h-6 w-6 text-ink-subtle" />
        )}

        <span className="space-y-1">
          <span className="block font-sans text-body text-ink">
            {checking
              ? 'Checking your image…'
              : dragging
                ? 'Drop it here'
                : hasExistingEntry
                  ? 'Drag a new logo here, or choose a file'
                  : 'Drag your logo here, or choose a file'}
          </span>
          <span className="block text-xs text-ink-subtle">
            {ACCEPTED_TYPES_LABEL} · up to {MAX_UPLOAD_LABEL} · {MIN_IMAGE_DIMENSION}–{MAX_IMAGE_DIMENSION}
            px on each side
          </span>
        </span>
      </label>

      <p id={hintId} className="text-xs text-ink-subtle">
        SVG is not accepted. If you drop several files, only the first is used. Your image is checked in the
        browser before anything is uploaded.
      </p>

      {/* Announced, not just shown: the rejection may arrive while focus is
          still on the input, with nothing visible in view. */}
      <div role="alert" aria-live="assertive">
        {rejection ? (
          <p id={errorId} className="flex items-start gap-2 text-sm text-danger">
            <AlertCircle aria-hidden="true" className="mt-hair h-4 w-4 shrink-0" />
            <span>{rejection.message}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
