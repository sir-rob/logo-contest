/**
 * Ballot validation tests.
 *
 * These exercise `validateRanking` directly — it is pure, so every rule can be
 * pinned down without a Firestore emulator, and the route is left with nothing
 * but plumbing. What is asserted here is not just "it rejected the ballot" but
 * WHICH code came back: the client shows a different message for "that entry
 * was withdrawn" than for "that entry does not exist", and a regression that
 * swaps them is invisible to a test that only checks for failure.
 *
 * The ORDER of the checks is part of the contract too — an empty ballot must
 * report BALLOT_EMPTY, not whatever the next check happens to notice.
 */

import { describe, expect, it } from 'vitest';
import { ApiError, MAX_RANKS, type ErrorCode } from '@contest/shared';
import { assertRankingShape, validateRanking } from './ballots.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRY_A = 'sub_aaaaaaaa';
const ENTRY_B = 'sub_bbbbbbbb';
const ENTRY_C = 'sub_cccccccc';
const ENTRY_D = 'sub_dddddddd';
const ENTRY_E = 'sub_eeeeeeee';

/** The voter's own entry. Nothing in the rules treats it specially. */
const MY_OWN_ENTRY = 'sub_mine0001';

/** Known to the contest, but withdrawn by its author. */
const WITHDRAWN_ENTRY = 'sub_withdrawn';

/** Known to the contest, but disqualified by an admin. */
const DISQUALIFIED_ENTRY = 'sub_disqualified';

const ALL_KNOWN = [
  ENTRY_A,
  ENTRY_B,
  ENTRY_C,
  ENTRY_D,
  ENTRY_E,
  MY_OWN_ENTRY,
  WITHDRAWN_ENTRY,
  DISQUALIFIED_ENTRY,
] as const;

/** Everything above except the two that are not `active`. */
const ALL_ACTIVE = [ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D, ENTRY_E, MY_OWN_ENTRY] as const;

function opts(overrides: { maxRanks?: number } = {}): {
  maxRanks: number;
  knownIds: ReadonlySet<string>;
  activeIds: ReadonlySet<string>;
} {
  return {
    maxRanks: overrides.maxRanks ?? MAX_RANKS,
    knownIds: new Set<string>(ALL_KNOWN),
    activeIds: new Set<string>(ALL_ACTIVE),
  };
}

/** Assert that `fn` throws an `ApiError` with exactly this code and status. */
function expectApiError(fn: () => void, code: ErrorCode, status: number): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }

  expect(thrown, `expected ${code} to be thrown`).toBeInstanceOf(ApiError);
  const apiError = thrown as ApiError;
  expect(apiError.code).toBe(code);
  expect(apiError.status).toBe(status);
  expect(apiError.message.length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

describe('validateRanking — rejections', () => {
  it('rejects an empty ballot with BALLOT_EMPTY', () => {
    expectApiError(() => validateRanking([], opts()), 'BALLOT_EMPTY', 422);
  });

  it('rejects more entries than the contest allows with BALLOT_TOO_MANY_RANKS', () => {
    expectApiError(
      () => validateRanking([ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D, ENTRY_E, MY_OWN_ENTRY], opts()),
      'BALLOT_TOO_MANY_RANKS',
      422,
    );
  });

  it('honours a contest-specific maxRanks lower than MAX_RANKS', () => {
    // e.g. a contest with only three entries.
    expectApiError(
      () => validateRanking([ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D], opts({ maxRanks: 3 })),
      'BALLOT_TOO_MANY_RANKS',
      422,
    );
    expect(() => validateRanking([ENTRY_A, ENTRY_B, ENTRY_C], opts({ maxRanks: 3 }))).not.toThrow();
  });

  it('rejects a repeated entry with BALLOT_DUPLICATE_RANKS', () => {
    expectApiError(
      () => validateRanking([ENTRY_A, ENTRY_B, ENTRY_A], opts()),
      'BALLOT_DUPLICATE_RANKS',
      422,
    );
  });

  it('rejects an id that is not a submission in this contest with BALLOT_UNKNOWN_SUBMISSION', () => {
    expectApiError(
      () => validateRanking([ENTRY_A, 'sub_does_not_exist'], opts()),
      'BALLOT_UNKNOWN_SUBMISSION',
      422,
    );
  });

  it('rejects a withdrawn entry with BALLOT_INACTIVE_SUBMISSION, not UNKNOWN', () => {
    // The distinction matters to the client: "that entry no longer exists" and
    // "the author pulled that entry" are different stories for the voter.
    expectApiError(
      () => validateRanking([ENTRY_A, WITHDRAWN_ENTRY], opts()),
      'BALLOT_INACTIVE_SUBMISSION',
      422,
    );
  });

  it('rejects a disqualified entry with BALLOT_INACTIVE_SUBMISSION', () => {
    expectApiError(
      () => validateRanking([DISQUALIFIED_ENTRY], opts()),
      'BALLOT_INACTIVE_SUBMISSION',
      422,
    );
  });
});

// ---------------------------------------------------------------------------
// Acceptances
// ---------------------------------------------------------------------------

describe('validateRanking — acceptances', () => {
  it('accepts a single-entry ballot (a partial ballot is valid)', () => {
    expect(() => validateRanking([ENTRY_A], opts())).not.toThrow();
  });

  it('accepts a full five-entry ballot', () => {
    const full = [ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D, ENTRY_E];
    expect(full).toHaveLength(MAX_RANKS);
    expect(() => validateRanking(full, opts())).not.toThrow();
  });

  it('accepts a self-vote at rank 1 — a deliberate product decision', () => {
    // 01-SPEC.md §5: self-voting is allowed at any position, rank 1 included.
    // If this test ever starts failing, someone has added a rule that must not
    // exist; fix the rule, not the test.
    expect(() => validateRanking([MY_OWN_ENTRY], opts())).not.toThrow();
    expect(() => validateRanking([MY_OWN_ENTRY, ENTRY_A, ENTRY_B], opts())).not.toThrow();
  });

  it('accepts a self-vote at a lower rank', () => {
    expect(() => validateRanking([ENTRY_A, ENTRY_B, MY_OWN_ENTRY], opts())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Check ordering — the first problem reported must be the most explanatory one
// ---------------------------------------------------------------------------

describe('validateRanking — ordering of checks', () => {
  it('reports an empty ballot as BALLOT_EMPTY even when maxRanks is 0', () => {
    expectApiError(() => validateRanking([], opts({ maxRanks: 0 })), 'BALLOT_EMPTY', 422);
  });

  it('reports over-length before duplicates', () => {
    expectApiError(
      () => validateRanking([ENTRY_A, ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D, ENTRY_E], opts()),
      'BALLOT_TOO_MANY_RANKS',
      422,
    );
  });

  it('reports over-length before unknown ids', () => {
    expectApiError(
      () => validateRanking([ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D, ENTRY_E, 'sub_nope'], opts()),
      'BALLOT_TOO_MANY_RANKS',
      422,
    );
  });

  it('reports duplicates before unknown ids', () => {
    expectApiError(
      () => validateRanking([ENTRY_A, ENTRY_A, 'sub_nope'], opts()),
      'BALLOT_DUPLICATE_RANKS',
      422,
    );
  });

  it('reports an unknown id before an inactive one', () => {
    expectApiError(
      () => validateRanking(['sub_nope', WITHDRAWN_ENTRY], opts()),
      'BALLOT_UNKNOWN_SUBMISSION',
      422,
    );
  });
});

// ---------------------------------------------------------------------------
// The structural subset used by the route before it spends any reads
// ---------------------------------------------------------------------------

describe('assertRankingShape', () => {
  it('applies the same empty / over-length / duplicate rules', () => {
    expectApiError(() => assertRankingShape([], MAX_RANKS), 'BALLOT_EMPTY', 422);
    expectApiError(
      () => assertRankingShape([ENTRY_A, ENTRY_B, ENTRY_C], 2),
      'BALLOT_TOO_MANY_RANKS',
      422,
    );
    expectApiError(
      () => assertRankingShape([ENTRY_A, ENTRY_A], MAX_RANKS),
      'BALLOT_DUPLICATE_RANKS',
      422,
    );
  });

  it('says nothing about which entries exist — that needs the database', () => {
    expect(() => assertRankingShape(['sub_nope'], MAX_RANKS)).not.toThrow();
  });

  it('reports the contest limit in the message, not the global one', () => {
    let thrown: unknown;
    try {
      assertRankingShape([ENTRY_A, ENTRY_B, ENTRY_C], 2);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as ApiError).message).toContain('2');
  });
});
