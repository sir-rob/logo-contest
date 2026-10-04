/**
 * Form field primitives.
 *
 * `Field` exists so that no screen has to remember the accessibility wiring.
 * Give it a label and the id of the control it wraps and it will connect the
 * hint and the error message with `aria-describedby`, flip `aria-invalid`, and
 * mark the control required — on whatever control you nest inside it.
 *
 * Errors are never colour-only: every error carries an icon and a sentence.
 */

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>): JSX.Element {
  return (
    <label className={cn('font-sans text-sm font-medium text-ink', className)} {...rest}>
      {children}
    </label>
  );
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

/** Attributes `Field` is allowed to push down onto the control it wraps. */
type WiredControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

const joinIds = (...ids: Array<string | undefined>): string | undefined =>
  ids.filter(Boolean).join(' ') || undefined;

export function Field({ label, htmlFor, hint, error, required = false, children }: FieldProps): JSX.Element {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = joinIds(hintId, errorId);

  // Push the wiring onto the control rather than asking every caller to repeat
  // it. Anything that is not an element (a string, null) is passed through.
  const wired = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const el = child as ReactElement<WiredControlProps>;
    return cloneElement(el, {
      id: el.props.id ?? htmlFor,
      'aria-describedby': joinIds(describedBy, el.props['aria-describedby']),
      'aria-invalid': error ? true : el.props['aria-invalid'],
      'aria-required': required ? true : el.props['aria-required'],
    });
  });

  return (
    <div className="grid gap-tight">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <>
            {/* The glyph is decoration; the word is the actual signal. */}
            <span aria-hidden="true" className="ml-hair text-ink-subtle">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </Label>

      {hint ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}

      {wired}

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-hair text-xs text-danger">
          <AlertCircle aria-hidden="true" className="mt-px h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE = cn(
  'w-full rounded border border-line-strong bg-paper-raised text-body text-ink',
  'placeholder:text-ink-faint transition-colors',
  'enabled:hover:border-ink-faint',
  'focus:border-accent',
  'disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-subtle',
  // Errors get a border as well as the message, so the state survives being
  // read in greyscale.
  'aria-[invalid=true]:border-danger',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = 'text', ...rest }, ref) {
    return <input ref={ref} type={type} className={cn(CONTROL_BASE, 'h-10 px-snug', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(CONTROL_BASE, 'min-h-[6rem] resize-y px-snug py-tight', className)}
        {...rest}
      />
    );
  },
);

export interface CharCountProps {
  value: string;
  max: number;
}

/**
 * Character budget for the entry title and description.
 *
 * The visible count is `aria-hidden` on purpose: a live region that fires on
 * every keystroke is unusable with a screen reader. Instead a single polite
 * status appears only once the budget is actually blown, which is the only
 * moment the information changes what the user should do.
 */
export function CharCount({ value, max }: CharCountProps): JSX.Element {
  const used = value.length;
  const over = used - max;
  const isOver = over > 0;
  const isNear = !isOver && used >= Math.floor(max * 0.9);

  return (
    <span className="flex items-center justify-end gap-tight text-xs">
      {isOver ? (
        // Text, not just a colour change.
        <span className="font-medium text-danger">{over} over</span>
      ) : null}
      <span
        aria-hidden="true"
        data-tabular
        className={cn(
          'tabular-nums',
          isOver ? 'font-medium text-danger' : isNear ? 'text-warning' : 'text-ink-subtle',
        )}
      >
        {used} / {max}
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {isOver ? `${over} characters over the ${max} character limit` : ''}
      </span>
    </span>
  );
}
