/**
 * Route guards.
 *
 * These keep the UI honest; they are not a security boundary. Every screen
 * behind them calls an endpoint that re-checks the same condition server-side,
 * because hiding a button is not an access control.
 *
 * The rule that matters here is what happens on refusal. A member who lands on
 * an admin URL gets a plain page explaining it — NOT a redirect. Redirecting an
 * unauthorised user to a page that then redirects back is how guard code turns
 * into an infinite loop, and the loop always shows up in production first.
 */

import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { useContest } from '@/lib/contest';
import { Forbidden } from '@/pages/Forbidden';
import { PhaseLocked } from '@/pages/PhaseLocked';
import { ROUTES, type GateKey } from '@/routes';
import { rememberReturnTo } from '@/lib/return-to';

export function FullPageSpinner({ label = 'Loading' }: { label?: string }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <Spinner label={label} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Signed in, or off to the sign-in page — remembering where they meant to go.
 *
 * The destination is stashed in sessionStorage rather than router state,
 * because the magic-link round trip is a fresh page load and router state does
 * not survive it.
 */
export function RequireAuth(): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  // 'loading' is a real state, not a stand-in for signed-out. Rendering the
  // sign-in form here flashes it at every already-signed-in user on every load.
  if (status === 'loading') return <FullPageSpinner label="Checking your session" />;

  if (status !== 'signed-in') {
    const intended = `${location.pathname}${location.search}`;
    rememberReturnTo(intended);
    return <Navigate to={ROUTES.signIn} replace state={{ from: intended }} />;
  }

  return <Outlet />;
}

/** Admin-only. A member sees an explanation, not a bounce. */
export function RequireAdmin({ children }: { children: ReactNode }): JSX.Element {
  const { status, isAdmin } = useAuth();

  if (status === 'loading') return <FullPageSpinner label="Checking your access" />;
  if (!isAdmin) return <Forbidden />;

  return <>{children}</>;
}

/**
 * Phase-gated. `gate` is a key into the `derivePhase()`-derived gates, so this
 * agrees with the nav and with the server by construction.
 */
export function RequireGate({ gate, children }: { gate: GateKey; children: ReactNode }): JSX.Element {
  const { phase, gates, isLoading, error } = useContest();

  if (isLoading) return <FullPageSpinner label="Loading the contest" />;

  // Fail closed. If we could not learn the phase, we must not unlock anything.
  if (error || phase === null) return <PhaseLocked gate={gate} phase={phase} unavailable />;

  if (!gates[gate]) return <PhaseLocked gate={gate} phase={phase} />;

  return <>{children}</>;
}
