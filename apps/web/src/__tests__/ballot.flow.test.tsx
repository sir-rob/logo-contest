/**
 * The ballot, driven through the UI.
 *
 * The two things worth testing here are the ones a screenshot cannot show:
 *
 *   1. A voter with no pointer can complete a ballot. Ranked-choice voting is
 *      a reordering task, and reordering is where drag-only UIs quietly
 *      disenfranchise people. The keyboard test below installs a tripwire on
 *      every pointer/mouse event and fails if the app needs one.
 *   2. Rank is position. Removing the middle of a ballot must renumber the
 *      tail, because a gap is not something the API can express or IRV can
 *      count.
 *
 * dnd-kit's pointer/keyboard sensors are NOT exercised here. jsdom has no
 * layout, so dnd-kit measures every droppable as a zero-size rect at the
 * origin and a simulated drag resolves to nothing — a "drag test" in jsdom
 * asserts that a stub did nothing. The button path is the primary path by
 * design (see the header of `BallotSlots.tsx`), and that is what is covered.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';

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

import { api, ApiClientError } from '@/lib/api';
import { Ballot } from '@/pages/Ballot';
import { ENTRIES, makeContestInPhase } from './fixtures';
import { renderWithProviders } from './harness';

const mockApi = api as unknown as {
  contest: ReturnType<typeof vi.fn>;
  submissions: ReturnType<typeof vi.fn>;
  myBallot: ReturnType<typeof vi.fn>;
  saveBallot: ReturnType<typeof vi.fn>;
  clearBallot: ReturnType<typeof vi.fn>;
};

/** Autosave debounces at 800ms; give it room without making the suite slow. */
const AUTOSAVE_WAIT = { timeout: 3000 };

beforeEach(() => {
  mockApi.contest.mockReset().mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
  mockApi.submissions.mockReset().mockResolvedValue(ENTRIES);
  mockApi.myBallot.mockReset().mockResolvedValue(null);
  mockApi.saveBallot.mockReset().mockResolvedValue(undefined);
  mockApi.clearBallot.mockReset().mockResolvedValue(undefined);
});

async function renderBallot(): Promise<void> {
  renderWithProviders(<Ballot />, { route: '/ballot' });
  await screen.findByRole('heading', { name: /your ballot/i });
  // "Your ranking" appears only once contest + entries + ballot have all
  // landed. Waiting on a pool card instead would assume nothing is ranked yet,
  // which is false for the tests that start from a saved ballot.
  await screen.findByText(/your ranking/i);
}

/** The ranked list, read back as `['Entry 01', 'Entry 02', …]` in slot order. */
function rankedOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /^remove entry \d+ from your ballot$/i })
    .map((button) => /remove (entry \d+) from/i.exec(button.getAttribute('aria-label') ?? '')?.[1] ?? '')
    .map((label) => label.replace(/^e/, 'E'));
}

/**
 * Each ranked row's own position, read back from its reorder-handle label.
 *
 * Reading position off the DOM (rather than trusting the array we passed in) is
 * the point: a gap in the ranks would show up here as a jump.
 *
 * This deliberately reads the REORDER HANDLE ("Reorder Entry 07, currently
 * position 2 of 3"), which every ranked row carries in every state. An earlier
 * version parsed the "move down" button instead, and that was a trap: the
 * first and last rows label their disabled move buttons differently ("is
 * already your first choice"), so those rows silently dropped out of the
 * result and a short array still looked contiguous. A helper that goes blind
 * at the edges is worse than no helper — the edges are where rank bugs live.
 *
 * The rank numerals themselves are `aria-hidden` decoration, so they are not a
 * usable signal.
 */
function slotPositions(): number[] {
  return screen
    .getAllByRole('button', { name: /^reorder entry \d+, currently position \d+ of \d+$/i })
    .map((b) =>
      Number(/currently position (\d+) of/.exec(b.getAttribute('aria-label') ?? '')?.[1] ?? 'NaN'),
    );
}

describe('ballot — keyboard only', () => {
  /**
   * THE ACCESSIBILITY TEST.
   *
   * Not one pointer event is dispatched. If this test ever has to be relaxed
   * to make it pass, the correct response is to fix the ballot, not the test.
   */
  it('completes a whole ballot — add, reorder, remove — with no pointer events', async () => {
    const pointerEvents: string[] = [];
    const record = (event: Event): void => {
      pointerEvents.push(event.type);
    };
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
      document.addEventListener(type, record, true);
    }

    try {
      const user = userEvent.setup();
      await renderBallot();

      // --- add three entries, reaching every control by tabbing -------------
      await pressByName(user, /^add entry 01 to your ballot at position 1$/i);
      await pressByName(user, /^add entry 02 to your ballot at position 2$/i);
      await pressByName(user, /^add entry 04 to your ballot at position 3$/i);

      expect(rankedOrder()).toEqual(['Entry 01', 'Entry 02', 'Entry 04']);

      // --- reorder: move the third entry to the top -------------------------
      await pressByName(user, /^move entry 04 up to position 2$/i);
      await pressByName(user, /^move entry 04 up to position 1$/i);

      expect(rankedOrder()).toEqual(['Entry 04', 'Entry 01', 'Entry 02']);

      // --- remove the middle one -------------------------------------------
      await pressByName(user, /^remove entry 01 from your ballot$/i);

      expect(rankedOrder()).toEqual(['Entry 04', 'Entry 02']);

      // --- and it saves, still without a pointer ----------------------------
      await waitFor(
        () => expect(mockApi.saveBallot).toHaveBeenCalledWith(['e4', 'e2']),
        AUTOSAVE_WAIT,
      );

      expect(pointerEvents).toEqual([]);
    } finally {
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
        document.removeEventListener(type, record, true);
      }
    }
  });

  /**
   * "One voice" means one thing NARRATING BALLOT CHANGES, not one live region
   * on the page. The countdown legitimately owns a second polite region on a
   * completely different cadence. What must not happen is dnd-kit announcing
   * the same mutation a second time over the top — so that is what is checked.
   */
  it('narrates changes itself and leaves dnd-kit’s announcer silent', async () => {
    const user = userEvent.setup();
    await renderBallot();

    await pressByName(user, /^add entry 01 to your ballot at position 1$/i);

    const ballotRegion = document.querySelector('p[aria-live="polite"][aria-atomic="true"]');
    expect(ballotRegion).not.toBeNull();
    await waitFor(() =>
      expect(ballotRegion?.textContent ?? '').toMatch(
        /entry 01 added to your ballot at position 1/i,
      ),
    );

    // dnd-kit renders its region unconditionally; the app suppresses every
    // announcement, so it must stay empty rather than double-speaking.
    const dndRegion = document.querySelector('[id^="DndLiveRegion"]');
    expect(dndRegion?.textContent ?? '').toBe('');
  });
});

describe('ballot — ranks stay contiguous', () => {
  it('renumbers 1..N when an entry in the middle is removed', async () => {
    const user = userEvent.setup();
    mockApi.myBallot.mockResolvedValue(['e1', 'e2', 'e4', 'e5']);
    await renderBallot();

    await waitFor(() => expect(rankedOrder()).toEqual(['Entry 01', 'Entry 02', 'Entry 04', 'Entry 05']));

    await pressByName(user, /^remove entry 02 from your ballot$/i);

    expect(rankedOrder()).toEqual(['Entry 01', 'Entry 04', 'Entry 05']);

    // No hole at position 2: the rows renumber with the list, 1, 2, 3 — and
    // there are exactly three of them, not four with one blanked out.
    expect(slotPositions()).toEqual([1, 2, 3]);

    // And the ranking sent upstream is the contiguous one.
    await waitFor(
      () => expect(mockApi.saveBallot).toHaveBeenCalledWith(['e1', 'e4', 'e5']),
      AUTOSAVE_WAIT,
    );
  });
});

describe('ballot — a partial ballot is a real ballot', () => {
  it('saves two of five without any error or "incomplete" framing', async () => {
    const user = userEvent.setup();
    await renderBallot();

    await pressByName(user, /^add entry 01 to your ballot at position 1$/i);
    await pressByName(user, /^add entry 02 to your ballot at position 2$/i);

    await waitFor(
      () => expect(mockApi.saveBallot).toHaveBeenCalledWith(['e1', 'e2']),
      AUTOSAVE_WAIT,
    );

    expect(await screen.findByText(/^saved/i)).toBeInTheDocument();

    // Nothing calls it unfinished.
    expect(screen.queryByText(/incomplete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/a partial ballot is valid and is counted/i)).toBeInTheDocument();
  });

  it('describes empty positions neutrally, not as an error', async () => {
    await renderBallot();
    expect(screen.getAllByText(/empty\. drag an entry here/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/you must rank/i)).not.toBeInTheDocument();
  });
});

describe('ballot — no duplicates', () => {
  it('takes a ranked entry out of the pool so it cannot be added twice', async () => {
    const user = userEvent.setup();
    await renderBallot();

    await pressByName(user, /^add entry 01 to your ballot at position 1$/i);

    // The only remaining control naming Entry 01 is the one that removes it.
    expect(screen.queryByRole('button', { name: /^add entry 01 to your ballot/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^remove entry 01 from your ballot$/i })).toBeInTheDocument();
    expect(rankedOrder()).toEqual(['Entry 01']);
  });

  it('de-duplicates a ranking the server handed back with a repeat in it', async () => {
    mockApi.myBallot.mockResolvedValue(['e1', 'e2', 'e1', 'e4']);
    await renderBallot();

    await waitFor(() => expect(rankedOrder()).toEqual(['Entry 01', 'Entry 02', 'Entry 04']));
  });
});

describe('ballot — autosave', () => {
  it('debounces a burst of edits into one save and shows a saved indicator', async () => {
    const user = userEvent.setup({ delay: null });
    await renderBallot();

    await pressByName(user, /^add entry 01 to your ballot at position 1$/i);
    await pressByName(user, /^add entry 02 to your ballot at position 2$/i);
    await pressByName(user, /^add entry 04 to your ballot at position 3$/i);

    // Debounced: not fired yet, and only ever once for the settled value.
    expect(mockApi.saveBallot).not.toHaveBeenCalled();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();

    await waitFor(
      () => expect(mockApi.saveBallot).toHaveBeenCalledWith(['e1', 'e2', 'e4']),
      AUTOSAVE_WAIT,
    );
    expect(mockApi.saveBallot).toHaveBeenCalledTimes(1);

    expect(await screen.findByText(/^saved/i)).toBeInTheDocument();
  });

  it('surfaces a retry — and keeps the edit — when a save fails', async () => {
    const user = userEvent.setup();
    mockApi.saveBallot.mockRejectedValue(
      new ApiClientError('INTERNAL', 'The server had a problem saving that.', 500),
    );

    await renderBallot();
    await pressByName(user, /^add entry 01 to your ballot at position 1$/i);

    expect(await screen.findByText(/not saved\./i, undefined, AUTOSAVE_WAIT)).toBeInTheDocument();
    expect(screen.getByText(/the server had a problem saving that\./i)).toBeInTheDocument();

    // The change is NOT rolled back behind the voter's back.
    expect(screen.getByText(/your ranking is still here — nothing was lost\./i)).toBeInTheDocument();
    expect(rankedOrder()).toEqual(['Entry 01']);

    // And the retry is a real, working control.
    const retry = screen.getByRole('button', { name: /try again/i });
    mockApi.saveBallot.mockResolvedValue(undefined);
    await user.click(retry);

    await waitFor(() => expect(mockApi.saveBallot).toHaveBeenCalledTimes(2), AUTOSAVE_WAIT);
    expect(await screen.findByText(/^saved/i)).toBeInTheDocument();
  });
});

describe('ballot — voting closed', () => {
  it('is a read-only receipt with no disabled drag handles', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('CLOSED'));
    mockApi.myBallot.mockResolvedValue(['e2', 'e1']);

    renderWithProviders(<Ballot />, { route: '/ballot' });

    expect(await screen.findByText(/your final ballot/i)).toBeInTheDocument();
    expect(screen.getByText(/voting has closed\./i)).toBeInTheDocument();

    // The ranking is still legible…
    const list = screen.getByRole('list');
    expect(within(list).getByText('Entry 02')).toBeInTheDocument();
    expect(within(list).getByText('Entry 01')).toBeInTheDocument();

    // …and every editing affordance is GONE, not greyed out. A disabled drag
    // handle is a promise the page can no longer keep.
    expect(screen.queryByRole('button', { name: /reorder entry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /move entry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove entry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add entry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();

    // Nothing disabled is left lying around at all.
    const disabled = document.querySelectorAll('button[disabled], [aria-disabled="true"]');
    expect(disabled.length).toBe(0);

    expect(mockApi.saveBallot).not.toHaveBeenCalled();
  });

  it('does not open the ballot before voting starts', async () => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('SUBMISSIONS_OPEN'));
    renderWithProviders(<Ballot />, { route: '/ballot' });

    expect(await screen.findByText(/voting has not opened yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add entry/i })).toBeNull();
  });
});

/**
 * Focus a control by TABBING to it, then activate it with Enter.
 *
 * Deliberately not `element.focus()` — walking the tab order is the point.
 * Reaching the control at all is half of what is being asserted.
 */
async function pressByName(user: UserEvent, name: RegExp): Promise<void> {
  const target = screen.getByRole('button', { name });

  for (let i = 0; i < 80 && document.activeElement !== target; i += 1) {
    await user.tab();
  }

  if (document.activeElement !== target) {
    throw new Error(
      `Could not reach "${target.getAttribute('aria-label') ?? target.textContent}" by tabbing — ` +
        'it is not in the keyboard tab order.',
    );
  }

  await user.keyboard('{Enter}');
}
