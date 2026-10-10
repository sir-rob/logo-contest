/**
 * DTO fixtures for the web suite.
 *
 * These mirror the shapes in `@contest/shared` exactly — they are typed as the
 * real DTOs, so the day a field is added or renamed these stop compiling
 * rather than quietly testing a shape the server no longer sends.
 *
 * Nothing here invents a field the anonymous projection does not have. In
 * particular `PublicSubmissionDto` has NO uploader field, and the gallery test
 * that asserts no identity leaks depends on that staying true.
 */

import type {
  ContestPublicDto,
  ContestPhase,
  DashboardDto,
  MeDto,
  PublicSubmissionDto,
  ResultsDto,
  StandingEntryDto,
} from '@contest/shared';

export const NOW_ISO = '2026-03-10T12:00:00.000Z';

const iso = (offsetMinutes: number): string =>
  new Date(Date.parse(NOW_ISO) + offsetMinutes * 60_000).toISOString();

export function makeContest(overrides: Partial<ContestPublicDto> = {}): ContestPublicDto {
  return {
    id: 'contest-1',
    title: 'North 7 Logo Contest',
    description: 'Design a logo for the team.',
    phase: 'VOTING_OPEN',
    submissionsOpenAt: iso(-60 * 24 * 14),
    submissionsCloseAt: iso(-60 * 24 * 7),
    votingOpensAt: iso(-60 * 24),
    votingClosesAt: iso(60 * 24 * 3),
    maxRanks: 5,
    allowSelfVote: true,
    showLiveStandings: true,
    serverNow: NOW_ISO,
    ...overrides,
  };
}

/** Windows consistent with a phase, so `derivePhase` agrees with `phase`. */
export function makeContestInPhase(
  phase: ContestPhase,
  overrides: Partial<ContestPublicDto> = {},
): ContestPublicDto {
  const windows: Record<ContestPhase, Partial<ContestPublicDto>> = {
    SETUP: {
      submissionsOpenAt: iso(60 * 24),
      submissionsCloseAt: iso(60 * 24 * 8),
      votingOpensAt: iso(60 * 24 * 9),
      votingClosesAt: iso(60 * 24 * 12),
    },
    SUBMISSIONS_OPEN: {
      submissionsOpenAt: iso(-60 * 24),
      submissionsCloseAt: iso(60 * 24 * 7),
      votingOpensAt: iso(60 * 24 * 8),
      votingClosesAt: iso(60 * 24 * 11),
    },
    VOTING_OPEN: {
      submissionsOpenAt: iso(-60 * 24 * 14),
      submissionsCloseAt: iso(-60 * 24 * 7),
      votingOpensAt: iso(-60 * 24),
      votingClosesAt: iso(60 * 24 * 3),
    },
    CLOSED: {
      submissionsOpenAt: iso(-60 * 24 * 21),
      submissionsCloseAt: iso(-60 * 24 * 14),
      votingOpensAt: iso(-60 * 24 * 10),
      votingClosesAt: iso(-60 * 24),
    },
    RESULTS_PUBLISHED: {
      submissionsOpenAt: iso(-60 * 24 * 21),
      submissionsCloseAt: iso(-60 * 24 * 14),
      votingOpensAt: iso(-60 * 24 * 10),
      votingClosesAt: iso(-60 * 24 * 2),
    },
  };

  return makeContest({ phase, ...windows[phase], ...overrides });
}

export function makeEntry(
  id: string,
  overrides: Partial<PublicSubmissionDto> = {},
): PublicSubmissionDto {
  const n = id.replace(/\D/g, '').padStart(2, '0');
  return {
    id,
    alias: `Entry ${n}`,
    title: `Mark ${n}`,
    thumbUrl: `https://cdn.example.test/${id}-thumb.png`,
    displayUrl: `https://cdn.example.test/${id}.png`,
    width: 1200,
    height: 1200,
    isMine: false,
    ...overrides,
  };
}

/** Six entries; `e3` belongs to the viewer. */
export const ENTRIES: PublicSubmissionDto[] = [
  makeEntry('e1'),
  makeEntry('e2'),
  makeEntry('e3', { isMine: true }),
  makeEntry('e4'),
  makeEntry('e5'),
  makeEntry('e6'),
];

export function makeMe(overrides: Partial<MeDto> = {}): MeDto {
  return {
    uid: 'uid-viewer',
    email: 'viewer@google.com',
    displayName: 'Viewer',
    role: 'member',
    registeredContestIds: ['contest-1'],
    mySubmission: null,
    myBallot: null,
    ...overrides,
  };
}

export function makeStanding(
  submissionId: string,
  overrides: Partial<StandingEntryDto> = {},
): StandingEntryDto {
  return {
    submissionId,
    alias: `Entry ${submissionId.replace(/\D/g, '').padStart(2, '0')}`,
    thumbUrl: `https://cdn.example.test/${submissionId}-thumb.png`,
    votes: 4,
    share: 0.25,
    eliminated: false,
    eliminatedRound: null,
    ...overrides,
  };
}

export function makeDashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    phase: 'VOTING_OPEN',
    eligibleVoters: 40,
    submissionCount: 6,
    ballotsCast: 17,
    iHaveSubmitted: true,
    iHaveVoted: false,
    closesAt: iso(60 * 24 * 3),
    serverNow: NOW_ISO,
    standings: [
      makeStanding('e1', { votes: 8, share: 0.5 }),
      makeStanding('e2', { votes: 5, share: 0.3125 }),
      makeStanding('e4', { votes: 3, share: 0.1875 }),
      makeStanding('e5', { votes: 0, share: 0, eliminated: true, eliminatedRound: 1 }),
    ],
    standingsHiddenReason: null,
    ...overrides,
  };
}

/**
 * A three-round count over four candidates, 20 ballots, 3 of them exhausted by
 * the end. The numbers are internally consistent so the results model has
 * nothing to paper over.
 */
export function makeResults(overrides: Partial<ResultsDto> = {}): ResultsDto {
  const entries = [makeEntry('e1'), makeEntry('e2'), makeEntry('e4'), makeEntry('e5')];

  return {
    snapshot: {
      contestId: 'contest-1',
      winnerSubmissionId: 'e1',
      totalBallots: 20,
      exhaustedFinal: 3,
      eliminationOrder: ['e5', 'e4', 'e2', 'e1'],
      tieBreakSeed: 'seed-4f2a',
      computedAt: NOW_ISO,
      published: true,
      isProjection: false,
      rounds: [
        {
          round: 1,
          tallies: { e1: 7, e2: 6, e4: 4, e5: 3 },
          activeBallots: 20,
          exhaustedBallots: 0,
          eliminated: 'e5',
          transfer: { from: 'e5', to: { e1: 1, e2: 1 }, exhausted: 1 },
          tieBreak: null,
          winner: null,
        },
        {
          round: 2,
          tallies: { e1: 8, e2: 7, e4: 4 },
          activeBallots: 19,
          exhaustedBallots: 1,
          eliminated: 'e4',
          transfer: { from: 'e4', to: { e1: 2 }, exhausted: 2 },
          tieBreak: null,
          winner: null,
        },
        {
          round: 3,
          tallies: { e1: 10, e2: 7 },
          activeBallots: 17,
          exhaustedBallots: 3,
          eliminated: null,
          transfer: null,
          tieBreak: null,
          winner: 'e1',
        },
      ],
    },
    entries,
    winner: entries[0] ?? null,
    winnerCredit: null,
    ...overrides,
  };
}
