/**
 * The application, assembled.
 *
 * Layering, outermost first:
 *
 *   ErrorBoundary  — a render crash shows a page with a way out, never white.
 *                    Keyed on the pathname so navigating away clears it.
 *   public routes  — sign-in and the magic-link landing page. No shell: there
 *                    is no session yet, so there is no nav to draw.
 *   RequireAuth    — sends anyone else to /signin, remembering where they were
 *                    going so they land there afterwards.
 *   AppShell       — header, phase strip, nav, footer, and an <Outlet/>.
 *   RequireGate    — phase gating, from the same `derivePhase()` predicates the
 *                    server enforces with.
 *
 * Both spellings of the auth routes are registered. `lib/firebase.ts` builds
 * the magic link against `/finish-sign-in`, and links already sitting in
 * inboxes must keep working.
 */

import { Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/AppShell';
import { RequireAdmin, RequireAuth, RequireGate } from '@/components/RouteGuards';
import { SignIn } from '@/pages/SignIn';
import { CompleteSignIn } from '@/pages/CompleteSignIn';
import { NotFound } from '@/pages/NotFound';
import { LEGACY_ROUTES, ROUTES } from '@/routes';

// Owned by other workers. See the header of each file.
import { Contests } from '@/pages/Contests';
import { Dashboard } from '@/pages/Dashboard';
import { Gallery } from '@/pages/Gallery';
import { MyEntry } from '@/pages/MyEntry';
import { Ballot } from '@/pages/Ballot';
import { Results } from '@/pages/Results';
import { Admin } from '@/pages/Admin';

export function App(): JSX.Element {
  const location = useLocation();

  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes>
        {/* Public */}
        <Route path={ROUTES.signIn} element={<SignIn />} />
        <Route path={LEGACY_ROUTES.signIn} element={<SignIn />} />
        <Route path={ROUTES.completeSignIn} element={<CompleteSignIn />} />
        <Route path={LEGACY_ROUTES.completeSignIn} element={<CompleteSignIn />} />

        {/* Everything else needs a session. */}
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="contests" element={<Contests />} />

            <Route
              path="gallery"
              element={
                <RequireGate gate="gallery">
                  <Gallery />
                </RequireGate>
              }
            />

            {/*
              Upload / replace / withdraw YOUR entry.

              This route was missing entirely until first production use: the
              page existed, `gateReason` already handled a 'submit' gate, and
              the nav had no item for it — so /submit 404'd and there was no
              way to reach the upload form at all. The page and the router were
              built by different people, and nothing failed at compile time
              because an unrouted component is still a perfectly valid module.
            */}
            <Route
              path="submit"
              element={
                <RequireGate gate="submit">
                  <MyEntry />
                </RequireGate>
              }
            />

            <Route
              path="ballot"
              element={
                <RequireGate gate="vote">
                  <Ballot />
                </RequireGate>
              }
            />

            <Route
              path="results"
              element={
                <RequireGate gate="results">
                  <Results />
                </RequireGate>
              }
            />

            {/* Admin owns its own sub-routing. A member gets a plain
                explanation here rather than a redirect, so there is no loop. */}
            <Route
              path="admin/*"
              element={
                <RequireAdmin>
                  <Admin />
                </RequireAdmin>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>

      {/* Outside <Routes> so a toast raised during a transition still lands. */}
      <Toaster position="bottom-right" closeButton toastOptions={{ className: 'font-sans text-sm' }} />
    </ErrorBoundary>
  );
}

export default App;
