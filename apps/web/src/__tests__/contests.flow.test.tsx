/**
 * Contests directory, registration by contest code, and admin contest creation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    api: {
      contest: vi.fn(),
      contests: vi.fn(),
      joinContest: vi.fn(),
      me: vi.fn(),
      admin: {
        createContest: vi.fn(),
      },
    },
  };
});

import { api } from '@/lib/api';
import { Contests } from '@/pages/Contests';
import { makeContest, makeMe } from './fixtures';
import { renderWithProviders } from './harness';

const mockApi = vi.mocked(api, { deep: true });

beforeEach(() => {
  mockApi.contests.mockReset().mockResolvedValue([
    makeContest({ id: 'media-moguls-2026', title: 'North 7 Logo Contest', code: 'NORTH7' }),
  ]);
  mockApi.joinContest.mockReset();
  mockApi.admin.createContest.mockReset();
  authState.current = {
    status: 'signed-in',
    isAdmin: false,
    me: makeMe({ registeredContestIds: ['media-moguls-2026'] }),
    refresh: vi.fn(async () => undefined),
    signOut: vi.fn(),
  };
});

describe('contests directory — member & admin flows', () => {
  it('shows registered contests and lets a member register for a new contest with a code', async () => {
    const user = userEvent.setup();
    const joinedContest = makeContest({
      id: 'summer-photo',
      title: 'Summer Photo Contest',
      code: 'SUMMER26',
    });
    mockApi.joinContest.mockResolvedValue(joinedContest);

    renderWithProviders(<Contests />, { route: '/contests' });

    expect(await screen.findByText('North 7 Logo Contest')).toBeInTheDocument();

    const codeInput = screen.getByLabelText(/contest code/i);
    await user.type(codeInput, 'summer26');
    await user.click(screen.getByRole('button', { name: /register for contest/i }));

    await waitFor(() => {
      expect(mockApi.joinContest).toHaveBeenCalledWith('SUMMER26');
    });
  });

  it('allows an admin to see all contests and create a new contest with a unique code', async () => {
    const user = userEvent.setup();
    authState.current = {
      status: 'signed-in',
      isAdmin: true,
      me: makeMe({ role: 'admin' }),
      refresh: vi.fn(async () => undefined),
      signOut: vi.fn(),
    };

    const created = makeContest({
      id: 'q4-mascot',
      title: 'Q4 Mascot Contest',
      code: 'MASCOT26',
      description: 'Upload a mascot concept.',
    });
    mockApi.admin.createContest.mockResolvedValue(created);

    renderWithProviders(<Contests />, { route: '/contests' });

    expect(await screen.findByRole('heading', { name: /all contests/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /new contest/i }));

    await user.type(screen.getByLabelText(/contest name/i), 'Q4 Mascot Contest');
    await user.type(screen.getByLabelText(/unique contest code/i), 'mascot26');
    await user.type(screen.getByLabelText(/description & prompt/i), 'Upload a mascot concept.');
    await user.click(screen.getByRole('button', { name: /create contest/i }));

    await waitFor(() => {
      expect(mockApi.admin.createContest).toHaveBeenCalledWith({
        title: 'Q4 Mascot Contest',
        code: 'MASCOT26',
        description: 'Upload a mascot concept.',
      });
    });
  });
});
