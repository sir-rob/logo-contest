/**
 * Button.
 *
 * Four variants, and only one of them is loud. `primary` is the single place
 * the accent is allowed to fill a shape — if two primary buttons are visible
 * at once, one of them is wrong. Everything else is paper, ink and a hairline.
 *
 * The focus ring is deliberately NOT declared here. `:focus-visible` in
 * index.css owns it globally so that it can never be accidentally removed or
 * overridden per-component.
 */

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy`, and disables the button. */
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // The one filled shape in the system. Hover/active have real tokens.
  primary: cn(
    'border-accent bg-accent text-accent-contrast',
    'enabled:hover:border-accent-hover enabled:hover:bg-accent-hover',
    'enabled:active:border-accent-active enabled:active:bg-accent-active',
  ),
  // Default. Paper with a hairline — structure without weight.
  secondary: cn(
    'border-line-strong bg-paper-raised text-ink',
    'enabled:hover:border-ink-faint enabled:hover:bg-paper-sunken',
    'enabled:active:bg-paper-sunken',
  ),
  // No chrome until you reach for it.
  ghost: cn(
    'border-transparent bg-transparent text-ink-muted',
    'enabled:hover:border-line-strong enabled:hover:bg-paper-sunken enabled:hover:text-ink',
    'enabled:active:bg-paper-sunken',
  ),
  // Withdraw / disqualify. `danger` has no -hover token, so the darkening is
  // done with a filter rather than by inventing a colour outside the palette.
  danger: cn(
    'border-danger bg-danger text-paper',
    'enabled:hover:brightness-90 enabled:active:brightness-75',
  ),
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-tight px-snug text-xs',
  md: 'h-10 gap-tight px-base text-sm',
  lg: 'h-12 gap-snug px-roomy text-body',
};

/** Decorative only — the accessible signal for loading is `aria-busy`. */
function LoadingRing(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="8" cy="8" r="6" className="opacity-25" />
      <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled === true || loading;

  return (
    <button
      // Defaulting to "button" stops a button inside a form from silently
      // submitting it — a bug that only shows up in production.
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap',
        'rounded border font-sans font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <LoadingRing /> : null}
      {children}
    </button>
  );
}
