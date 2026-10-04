/**
 * Route guards and nav affordances.
 *
 * Two rules from `RouteGuards.tsx` and `routes.tsx`, tested as rules:
 *
 *   1. Refusal is a PAGE, not a redirect. Bouncing an unauthorised user to a
 *      route that may bounce them back is how guards become redirect loops,
 *      and loops always surface in production first.
 *   2. A gated nav item is shown, disabled, AND carries its reason. A greyed
 *      item with no explanation reads as a bug and gets filed as one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { AuthContextValue } from '@/auth/AuthProvider';

const authState: { current: Partial<AuthContextValue> } = { current: {} };

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => authState.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  pendingMagicLink: () => ({ isLink: false, email: null }),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { contest: vi.fn(), dashboard: vi.fn(), submissions: vi.fn(), me: vi.fn() },
  };
});

import { api } from '@/lib/api';
import { RequireAdmin, RequireAuth } from '@/components/RouteGuards';
import { AppShell } from '@/components/AppShell';
import { makeContestInPhase, makeMe } from './fixtures';
import { renderWithProviders } from './harness';

const mockApi = vi.mocked(api, { deep: true });

/** Reports the current path so a redirect is observable, not inferred. */
function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

const asMember = (): void => {
  authState.current = {
    status: 'signed-in',
    isAdmin: false,
    me: makeMe(),
    signOut: vi.fn(),
  } as Partial<AuthContextValue>;
};

const asAdmin = (): void => {
  authState.current = {
    status: 'signed-in',
    isAdmin: true,
    me: makeMe({ role: 'admin' }),
    signOut: vi.fn(),
  } as Partial<AuthContextValue>;
};

beforeEach(() => {
  mockApi.contest.mockReset().mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
  asMember();
});

describe('routing — a member lands on /admin', () => {
  it('gets the plain "not available" page, with no crash and no redirect', async () => {
    renderWithProviders(
      <>
        <LocationProbe />
        <RequireAdmin>
          <div>SECRET ADMIN TOOLS</div>
        </RequireAdmin>
      </>,
      { route: '/admin' },
    );

    // The explanation, in a matter-of-fact tone — nobody did anything wrong.
    expect(
      await screen.findByRole('heading', { name: /this part is for contest admins/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/you do not have access to this page/i)).toBeInTheDocument();

    // The guarded content never rendered.
    expect(screen.queryByText('SECRET ADMIN TOOLS')).toBeNull();

    // And crucially: still on /admin. No bounce, so no loop.
    expect(screen.getByTestId('path')).toHaveTextContent('/admin');

    // Not dressed as a failure.
    expect(screen.queryByText(/access denied/i)).toBeNull();
    expect(screen.queryByText(/error/i)).toBeNull();

    // There is a way onward.
    expect(screen.getByRole('link', { name: /back to the dashboard/i })).toBeInTheDocument();
  });

  it('lets an admin straight through', async () => {
    asAdmin();
    renderWithProviders(
      <RequireAdmin>
        <div>SECRET ADMIN TOOLS</div>
      </RequireAdmin>,
      { route: '/admin' },
    );

    expect(await screen.findByText('SECRET ADMIN TOOLS')).toBeInTheDocument();
  });

  it('shows a session check rather than flashing a refusal while loading', () => {
    authState.current = { status: 'loading', isAdmin: false } as Partial<AuthContextValue>;
    renderWithProviders(
      <RequireAdmin>
        <div>SECRET ADMIN TOOLS</div>
      </RequireAdmin>,
      { route: '/admin' },
    );

    // The spinner deliberately renders its label twice — once visibly and
    // once for screen readers — so more than one match is correct here.
    expect(screen.getAllByText(/checking your access/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/this part is for contest admins/i)).toBeNull();
  });
});

describe('routing — signed out', () => {
  it('redirects to sign-in ONCE and remembers where they were going', async () => {
    authState.current = { status: 'signed-out', isAdmin: false } as Partial<AuthContextValue>;

    renderWithProviders(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/ballot" element={<div>THE BALLOT</div>} />
        </Route>
        <Route path="/signin" element={<LocationProbe />} />
      </Routes>,
      { route: '/ballot' },
    );

    // Landed on sign-in, and stayed there — a loop would keep re-rendering.
    expect(await screen.findByTestId('path')).toHaveTextContent('/signin');
    expect(screen.queryByText('THE BALLOT')).toBeNull();

    // The intended destination survives the magic-link round trip.
    expect(window.sessionStorage.getItem('n7.returnTo')).toBe('/ballot');
  });

  it('does not flash the sign-in redirect while the session is still loading', () => {
    authState.current = { status: 'loading', isAdmin: false } as Partial<AuthContextValue>;

    renderWithProviders(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/ballot" element={<div>THE BALLOT</div>} />
        </Route>
        <Route path="/signin" element={<LocationProbe />} />
      </Routes>,
      { route: '/ballot' },
    );

    expect(screen.getAllByText(/checking your session/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('path')).toBeNull();
  });
});

describe('nav — a gated destination explains itself', () => {
  it('shows a phase-gated item disabled WITH the reason, not silently greyed', async () => {
    // Submissions open: the gallery is visible but voting has not started, so
    // the ballot is gated.
    mockApi.contest.mockResolvedValue(makeContestInPhase('SUBMISSIONS_OPEN'));

    renderWithProviders(<AppShell />, { route: '/' });

    const nav = await screen.findByRole('navigation', { name: /primary/i });

    // Wait for the phase to actually arrive — until it does, every gate
    // honestly reports "Loading the contest…", which is a different state.
    await waitFor(() => {
      const item = within(nav).getByText('Ballot').closest('[aria-disabled="true"]');
      expect(item?.textContent ?? '').not.toMatch(/loading the contest/i);
    });

    // The item is PRESENT — people need to know a ballot exists before it opens.
    const ballotItem = within(nav).getByText('Ballot').closest('[aria-disabled="true"]');
    expect(ballotItem).not.toBeNull();

    // …and it says WHY, in real text rather than a hover-only tooltip.
    expect(ballotItem?.textContent ?? '').toMatch(/opens when submissions close/i);

    // It is not a link, so it cannot be followed into a wall.
    expect(within(nav).queryByRole('link', { name: /^ballot$/i })).toBeNull();
  });

  it('makes the same item a real link once its phase arrives', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('VOTING_OPEN'));

    renderWithProviders(<AppShell />, { route: '/' });

    const nav = await screen.findByRole('navigation', { name: /primary/i });
    expect(await within(nav).findByRole('link', { name: /ballot/i })).toBeInTheDocument();
  });

  it('hides the admin tab from members entirely rather than teasing it', async () => {
    renderWithProviders(<AppShell />, { route: '/' });

    const nav = await screen.findByRole('navigation', { name: /primary/i });
    expect(within(nav).queryByText('Admin')).toBeNull();
  });

  it('shows the admin tab to an admin', async () => {
    asAdmin();
    renderWithProviders(<AppShell />, { route: '/' });

    const nav = await screen.findByRole('navigation', { name: /primary/i });
    expect(within(nav).getByText('Admin')).toBeInTheDocument();
  });

  it('gives every disabled nav item a reason — none left bare', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('SETUP'));

    renderWithProviders(<AppShell />, { route: '/' });
    await screen.findByRole('navigation', { name: /primary/i });

    const disabled = document.querySelectorAll('nav [aria-disabled="true"]');
    expect(disabled.length).toBeGreaterThan(0);

    for (const item of Array.from(disabled)) {
      // Every one carries more than just its own label.
      expect(item.textContent ?? '').toMatch(/—/);
    }
  });
});
