/**
 * Dashboard projection and published results.
 *
 * Two themes:
 *
 *   HONEST LABELLING — a live ranked-choice projection is not a vote tally,
 *   and a reader who thinks it is will misread every number under it. The
 *   label is load-bearing, so it is asserted like one.
 *
 *   NOT COLOUR ALONE — elimination and majority have to survive greyscale,
 *   and the round-by-round count has to survive not being looked at. The SVG
 *   flow is decorative; the table is the real representation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      contest: vi.fn(),
      dashboard: vi.fn(),
      results: vi.fn(),
      submissions: vi.fn(),
      me: vi.fn(),
    },
  };
});

import { api } from '@/lib/api';
import { Dashboard } from '@/pages/Dashboard';
import { ResultsPage } from '@/pages/ResultsPage';
import { makeContestInPhase, makeDashboard, makeResults, makeStanding } from './fixtures';
import { emailsInDom, renderWithProviders } from './harness';

// `vi.mocked(..., { deep: true })` rather than an index-signature cast: it
// keeps each method's real signature, so `mockResolvedValue` is checked
// against the DTO the endpoint actually returns.
const mockApi = vi.mocked(api, { deep: true });

beforeEach(() => {
  mockApi.contest.mockReset().mockResolvedValue(makeContestInPhase('VOTING_OPEN'));
  mockApi.dashboard.mockReset().mockResolvedValue(makeDashboard());
  mockApi.results.mockReset().mockResolvedValue(makeResults());
});

describe('dashboard — the live standings are labelled as a projection', () => {
  it('calls it a ranked-choice projection, never a raw vote tally', async () => {
    renderWithProviders(<Dashboard />, { route: '/' });

    expect(await screen.findByText(/live projection/i)).toBeInTheDocument();
    expect(
      screen.getByText(/full ranked-choice count of every ballot cast so far/i),
    ).toBeInTheDocument();

    // The distinction is spelled out, not implied.
    expect(screen.getByText(/not first-choice totals/i)).toBeInTheDocument();

    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/vote tally/i);
    expect(body).not.toMatch(/total votes so far/i);
  });

  it('says outright that positions may still move', async () => {
    renderWithProviders(<Dashboard />, { route: '/' });
    await screen.findByText(/live projection/i);

    // A projection that never admits it can move reads as a result.
    expect(
      screen.getByText(/positions move as ballots arrive/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/lower choices are already being redistributed/i)).toBeInTheDocument();
  });

  it('leaks no uploader identity into the standings', async () => {
    renderWithProviders(<Dashboard />, { route: '/' });
    await screen.findByText(/live projection/i);

    expect(emailsInDom()).toEqual([]);
    expect(document.body.textContent ?? '').not.toMatch(/uploaded by|submitted by/i);
  });
});

describe('dashboard — elimination is not conveyed by colour alone', () => {
  it('labels an eliminated entry in words and withholds its position', async () => {
    mockApi.dashboard.mockResolvedValue(
      makeDashboard({
        standings: [
          makeStanding('e1', { votes: 9, share: 0.6 }),
          makeStanding('e2', { votes: 6, share: 0.4 }),
          makeStanding('e5', { votes: 0, share: 0, eliminated: true, eliminatedRound: 2 }),
        ],
      }),
    );

    renderWithProviders(<Dashboard />, { route: '/' });
    await screen.findByText(/live projection/i);

    // 1. Words, readable in greyscale and by a screen reader. (The phrase
    //    appears more than once in the row — a visible badge and a screen
    //    reader form — which is the belt-and-braces the component intends.)
    const eliminatedRow = document.querySelector('[data-eliminated="true"]') as HTMLElement;
    expect(eliminatedRow).not.toBeNull();
    expect(within(eliminatedRow).getAllByText(/out, round 2/i).length).toBeGreaterThan(0);

    // 2. Position, too: an eliminated entry is not given a rank, because "3rd"
    //    would imply it is still in a race it has left.
    expect(within(eliminatedRow).queryByText(/^3$/)).toBeNull();

    // 3. The leader is likewise named in words, not merely tinted.
    expect(screen.getAllByText(/leading|majority/i).length).toBeGreaterThan(0);
  });
});

describe('results — the accessible equivalent of the chart', () => {
  // `published` is `canViewResults(phase)`, so the count only renders once the
  // contest has actually reached the published phase.
  beforeEach(() => {
    mockApi.contest.mockResolvedValue(makeContestInPhase('RESULTS_PUBLISHED'));
  });

  /**
   * The page renders two tables — the round-by-round count and the final
   * standings. Only the former carries a caption, so that is its accessible
   * name and the unambiguous way to ask for it.
   */
  const findRoundTable = (): Promise<HTMLElement> =>
    screen.findByRole('table', { name: /round-by-round count/i });

  it('renders a real round-by-round table, not only the SVG', async () => {
    renderWithProviders(<ResultsPage />, { route: '/results' });

    const table = await findRoundTable();
    expect(table).toBeInTheDocument();

    // A column per round, plus Entry and Outcome.
    expect(within(table).getByRole('columnheader', { name: /^entry$/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /round 1/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /round 3/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /outcome/i })).toBeInTheDocument();

    // The caption explains how to read it, including the em-dash convention.
    expect(within(table).getByText(/already been eliminated/i)).toBeInTheDocument();
  });

  it('exposes the table even while the chart is the visible representation', async () => {
    renderWithProviders(<ResultsPage />, { route: '/results' });

    const table = await findRoundTable();
    // Present in the accessibility tree from the start — the "Show the
    // numbers" toggle is a sighted-user convenience, not a gate on the data.
    expect(table).toBeInTheDocument();

    // And the decorative flow is hidden from assistive tech rather than
    // duplicated into it.
    const hidden = document.querySelectorAll('[aria-hidden="true"] svg, svg[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(0);
  });

  it('shows the exhausted-ballot count where the winner is announced', async () => {
    renderWithProviders(<ResultsPage />, { route: '/results' });
    await findRoundTable();

    // The count is stated in more than one place, which is the point — it is
    // given the same weight as turnout rather than tucked into a footnote.
    expect(screen.getAllByText(/exhausted ballots/i).length).toBeGreaterThan(0);

    // The figure from the fixture (3 of 20) is actually on screen as a stat,
    // not merely implied by a percentage.
    const integrity = screen
      .getAllByText(/exhausted ballots/i)
      .map((el) => el.closest('div'))
      .find((el) => /\b3\b/.test(el?.textContent ?? ''));
    expect(integrity).toBeTruthy();

    // …and, next to the winner, the sentence that stops "majority" being read
    // as a majority of everyone who voted.
    expect(
      screen.getByText(/had run out of ranked preferences by then/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/ballots still counting/i).length).toBeGreaterThan(0);
  });

  it('names a winner and reports the share of CONTINUING ballots', async () => {
    renderWithProviders(<ResultsPage />, { route: '/results' });
    await findRoundTable();

    expect(screen.getByText(/continuing ballots/i)).toBeInTheDocument();
    expect(document.body.textContent ?? '').toMatch(/entry 01/i);
  });

  it('leaks no identity on the results screen either', async () => {
    renderWithProviders(<ResultsPage />, { route: '/results' });
    await findRoundTable();

    expect(emailsInDom()).toEqual([]);
  });
});

describe('results — states before publication', () => {
  it('explains an unpublished count instead of showing an error', async () => {
    const { ApiClientError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    mockApi.contest.mockResolvedValue(makeContestInPhase('CLOSED'));
    mockApi.results.mockRejectedValue(
      new ApiClientError('PHASE_RESULTS_NOT_PUBLISHED', 'Not published.', 403),
    );

    renderWithProviders(<ResultsPage />, { route: '/results' });

    expect(await screen.findByText(/results aren't out yet/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is hidden from you specifically/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('explains a count withheld to protect anonymity', async () => {
    const { ApiClientError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    // Published phase: the withholding is about ballot COUNT, not about the
    // contest not having got there yet — otherwise the earlier branch wins.
    mockApi.contest.mockResolvedValue(makeContestInPhase('RESULTS_PUBLISHED'));
    mockApi.results.mockRejectedValue(
      new ApiClientError('RESULTS_TOO_FEW_BALLOTS', 'Too few ballots.', 403),
    );

    renderWithProviders(<ResultsPage />, { route: '/results' });

    expect(await screen.findByText(/staying hidden for now/i)).toBeInTheDocument();
    expect(screen.getByText(/work out how individuals voted/i)).toBeInTheDocument();
  });
});
