/**
 * The frame every signed-in screen sits in.
 *
 * Header, phase strip, nav, content, footer — and nothing else. The shell's job
 * is to say where you are and what is open; the pages do the work.
 *
 * On the nav: a gated destination is shown DISABLED WITH ITS REASON, never
 * hidden. "Ballot — opens when submissions close" teaches the shape of the
 * contest. A greyed item with no explanation just looks broken, and the reason
 * is real text rather than a tooltip, because hover-only information does not
 * exist on a phone and does not exist for a screen reader.
 */

import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { AccentToggle, Button } from '@/components/ui';
import { PhaseBadge, PhaseBanner } from '@/components/PhaseBanner';
import { useAuth } from '@/auth/AuthProvider';
import { useContest } from '@/lib/contest';
import { navItemsFor, type NavItem } from '@/routes';
import { CONTEST_NAME, FOOTER_NOTE } from '@/lib/branding';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children?: ReactNode }): JSX.Element {
  const { me, isAdmin, signOut } = useAuth();
  const { contest, phase } = useContest();

  const title = contest?.title ?? CONTEST_NAME;
  const items = navItemsFor(phase, isAdmin).filter((item) => item.visible);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Keyboard users should not have to tab the nav on every page. */}
      <a
        href="#main"
        className="sr-only rounded bg-accent px-base py-snug text-accent-contrast focus:not-sr-only focus:absolute focus:left-base focus:top-base focus:z-50"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-paper-raised">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-base gap-y-tight px-base py-snug">
          <Link
            to="/"
            className="font-display text-lead text-ink no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {title}
          </Link>

          <div className="flex items-center gap-snug">
            <PhaseBadge />

            {me ? (
              <span
                className="hidden max-w-[18ch] truncate text-xs text-ink-subtle md:inline"
                title={me.email}
              >
                {me.email}
              </span>
            ) : null}

            <AccentToggle />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void signOut();
              }}
              aria-label={me ? `Sign out of ${me.email}` : 'Sign out'}
            >
              <LogOut aria-hidden="true" className="mr-tight h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        <PrimaryNav items={items} />
      </header>

      <PhaseBanner />

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-page flex-1 px-base py-loose">
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-page px-base py-base">
          <p className="text-xs text-ink-subtle">{FOOTER_NOTE}</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Scrolls rather than collapsing into a menu on narrow screens. With five
 * items, a hamburger would hide the phase information that makes the nav worth
 * reading, and every item stays directly keyboard-reachable this way.
 */
function PrimaryNav({ items }: { items: NavItem[] }): JSX.Element {
  return (
    <nav aria-label="Primary" className="mx-auto max-w-page px-base">
      <ul className="-mb-px flex gap-base overflow-x-auto whitespace-nowrap">
        {items.map((item) => (
          <li key={item.to}>
            {item.disabledReason ? (
              <span
                aria-disabled="true"
                className="flex cursor-not-allowed items-center gap-tight border-b-2 border-transparent py-snug text-sm text-ink-faint"
              >
                <item.icon aria-hidden="true" className="h-4 w-4" />
                <span>{item.label}</span>
                <span className="text-xs text-ink-subtle">&mdash; {item.disabledReason}</span>
              </span>
            ) : (
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-tight border-b-2 py-snug text-sm no-underline transition-colors duration-fast',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    isActive
                      ? 'border-accent text-ink'
                      : 'border-transparent text-ink-muted hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon aria-hidden="true" className="h-4 w-4" />
                    <span>{item.label}</span>
                    {/* Position and weight already mark the current tab; this
                        is for anyone not perceiving either. */}
                    {isActive ? <span className="sr-only">(current page)</span> : null}
                  </>
                )}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default AppShell;
