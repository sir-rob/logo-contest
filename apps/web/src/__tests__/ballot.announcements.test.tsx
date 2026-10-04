/**
 * Ballot announcements and keyboard shortcuts.
 *
 * Split out from `ballot.flow.test.tsx` because these assert on what a screen
 * reader is TOLD rather than on what the ballot ends up containing. A ballot
 * that reaches the right state while narrating nothing is still broken for the
 * people this path exists for.
 *
 * (Filename note: this file started life as a scratch probe. Its contents are
 * real; the name is a leftover — see the summary.)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      contest: vi.fn(),
      submissions: vi.fn(),
      myBallot: vi.fn(),
      saveBallot: vi.fn(),
      clearBallot: vi.fn(),
    },
  };
});

import { api } from '@/lib/api';
import { Ballot } from '@/pages/Ballot';
import { ENTRIES, makeContestInPhase } from './fixtures';
import { renderWithProviders } from './harness';

const mockApi = vi.mocked(api, { deep: true });

const ballotRegion = (): Element | null =>
  document.querySelector('p[aria-live="polite"][aria-atomic="true"]');

beforeEach(() => {
  mockApi.contest.mockReset().mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
  mockApi.submissions.mockReset().mockResolvedValue(ENTRIES);
  mockApi.myBallot.mockReset().mockResolvedValue(null);
  mockApi.saveBallot.mockReset().mockResolvedValue(undefined);
});

async function renderBallot(): Promise<void> {
  renderWithProviders(<Ballot />, { route: '/ballot' });
  await screen.findByText(/your ranking/i);
}

describe('ballot — digit shortcuts', () => {
  /**
   * Typing a digit on a focused pool card drops it straight into that rank.
   * Placing into a rank beyond the end of the list appends instead of leaving
   * a hole, so there is no way to type a gap into existence.
   */
  it('places an entry at the typed rank without creating a gap', async () => {
    const user = userEvent.setup();
    await renderBallot();

    const add = screen.getByRole('button', { name: /^add entry 01 to your ballot at position 1$/i });
    add.focus();

    // "3" on an empty ballot must append at 1, not leave 1 and 2 hollow.
    await user.keyboard('3');

    await waitFor(() =>
      expect(ballotRegion()?.textContent ?? '').toMatch(
        /entry 01 added to your ballot at position 1 of 1/i,
      ),
    );
  });
});

describe('ballot — the full-ballot state', () => {
  it('explains refusal out loud instead of going quiet', async () => {
    const user = userEvent.setup();
    // Cap is min(contest.maxRanks, MAX_RANKS, entryCount) — pin it at 2.
    mockApi.contest.mockResolvedValue(makeContestInPhase('VOTING_OPEN', { maxRanks: 2 }));
    await renderBallot();

    for (const name of [
      /^add entry 01 to your ballot at position 1$/i,
      /^add entry 02 to your ballot at position 2$/i,
    ]) {
      await user.click(screen.getByRole('button', { name }));
    }

    // The remaining pool cards stay in the tab order — `aria-disabled`, not
    // `disabled` — so a keyboard voter can still reach the thing that explains
    // why nothing is happening.
    // Every still-unranked card shows this state; any one of them will do.
    const blocked = screen.getAllByRole('button', { name: /ballot full/i })[0] as HTMLElement;
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).not.toBeDisabled();

    await user.click(blocked);
    await waitFor(() =>
      expect(ballotRegion()?.textContent ?? '').toMatch(/your ballot is full/i),
    );
  });
});
