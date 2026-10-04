/**
 * A router link that looks like a button, without pretending to be one.
 *
 * The shared `Button` renders a real `<button>` and takes no `asChild`, so
 * wrapping a `<Link>` in it would nest an anchor inside a button — invalid HTML
 * and a genuinely confusing thing to meet with a screen reader. Navigation is a
 * link; this just gives it the same weight on the page.
 *
 * The focus ring is the shared one and is never removed.
 */

import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/utils';

const BASE =
  'inline-flex items-center justify-center gap-tight rounded border px-base py-snug text-sm ' +
  'no-underline transition-colors duration-fast ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const TONES = {
  primary: 'border-accent bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary: 'border-line-strong bg-paper-raised text-ink hover:bg-paper-sunken',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:text-ink hover:bg-paper-sunken',
} as const;

export function ButtonLink({
  tone = 'secondary',
  className,
  ...props
}: LinkProps & { tone?: keyof typeof TONES }): JSX.Element {
  return <Link {...props} className={cn(BASE, TONES[tone], className)} />;
}
