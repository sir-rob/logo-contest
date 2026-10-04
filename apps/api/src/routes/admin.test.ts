/**
 * Unit tests for the admin route logic.
 *
 * The interesting decisions in `admin.ts` — duplicate detection, timeline
 * coherence, turnout ordering — are pure functions precisely so they can be
 * tested without Firestore, Fastify or an emulator. Importing the module is
 * safe: `getConfig()` and `getDb()` are both lazy, so nothing touches the
 * environment or firebase-admin at import time.
 */

import { describe, expect, it } from 'vitest';
import { ApiError, validateContestDates } from '@contest/shared';
import {
  assertContestDatesValid,
  computeDuplicateGroups,
  diffContestFields,
  mergeContestDates,
  sortTurnout,
  type ContestDateFields,
} from './admin.js';

const iso = (s: string): Date => new Date(s);

/** A coherent baseline: submissions open, close, then voting opens and closes. */
const baseDates = (): ContestDateFields => ({
  submissionsOpenAt: iso('2026-10-01T00:00:00.000Z'),
  submissionsCloseAt: iso('2026-10-10T00:00:00.000Z'),
  votingOpensAt: iso('2026-10-11T00:00:00.000Z'),
  votingClosesAt: iso('2026-10-20T00:00:00.000Z'),
});

// ---------------------------------------------------------------------------
// computeDuplicateGroups
// ---------------------------------------------------------------------------

describe('computeDuplicateGroups', () => {
  it('maps a singleton to an empty array, never to itself', () => {
    const groups = computeDuplicateGroups([{ id: 'a', contentHash: 'h1' }]);
    expect(groups).toEqual({ a: [] });
  });

  it('pairs two entries sharing a hash, each listing only the other', () => {
    const groups = computeDuplicateGroups([
      { id: 'a', contentHash: 'same' },
      { id: 'b', contentHash: 'same' },
    ]);
    expect(groups['a']).toEqual(['b']);
    expect(groups['b']).toEqual(['a']);
  });

  it('lists all other members of a three-way group', () => {
    const groups = computeDuplicateGroups([
      { id: 'a', contentHash: 'same' },
      { id: 'b', contentHash: 'same' },
      { id: 'c', contentHash: 'same' },
    ]);
    expect(groups['a']).toEqual(['b', 'c']);
    expect(groups['b']).toEqual(['a', 'c']);
    expect(groups['c']).toEqual(['a', 'b']);
  });

  it('keeps distinct hashes apart', () => {
    const groups = computeDuplicateGroups([
      { id: 'a', contentHash: 'h1' },
      { id: 'b', contentHash: 'h2' },
      { id: 'c', contentHash: 'h1' },
    ]);
    expect(groups['a']).toEqual(['c']);
    expect(groups['b']).toEqual([]);
    expect(groups['c']).toEqual(['a']);
  });

  it('returns an entry for every submission, and nothing extra', () => {
    const groups = computeDuplicateGroups([
      { id: 'a', contentHash: 'h1' },
      { id: 'b', contentHash: 'h1' },
      { id: 'c', contentHash: 'h2' },
    ]);
    expect(Object.keys(groups).sort()).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty contest', () => {
    expect(computeDuplicateGroups([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// mergeContestDates + validateContestDates
// ---------------------------------------------------------------------------

describe('mergeContestDates', () => {
  it('leaves omitted fields untouched', () => {
    const existing = baseDates();
    const merged = mergeContestDates(existing, {});
    expect(merged).toEqual(existing);
  });

  it('sets a supplied ISO string', () => {
    const merged = mergeContestDates(baseDates(), { votingClosesAt: '2026-10-25T00:00:00.000Z' });
    expect(merged.votingClosesAt?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    // untouched
    expect(merged.submissionsOpenAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('clears a date when null is supplied', () => {
    const merged = mergeContestDates(baseDates(), { votingClosesAt: null });
    expect(merged.votingClosesAt).toBeNull();
  });

  it('distinguishes an absent field from an explicit null', () => {
    const cleared = mergeContestDates(baseDates(), { submissionsOpenAt: null });
    const untouched = mergeContestDates(baseDates(), {});
    expect(cleared.submissionsOpenAt).toBeNull();
    expect(untouched.submissionsOpenAt).not.toBeNull();
  });

  it('rejects an unparseable date with VALIDATION_FAILED / 400', () => {
    try {
      mergeContestDates(baseDates(), { votingOpensAt: 'not-a-date' });
      expect.unreachable('expected mergeContestDates to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('VALIDATION_FAILED');
      expect(apiErr.status).toBe(400);
      expect(apiErr.fields?.['votingOpensAt']).toBeDefined();
    }
  });
});

describe('merged-timeline validation', () => {
  it('REJECTS a patch that only moves votingOpensAt earlier than an existing submissionsCloseAt', () => {
    // The patch touches one field; the field it conflicts with was already
    // stored and is not mentioned in the request at all. Validating only the
    // supplied fields would let this through.
    const merged = mergeContestDates(baseDates(), { votingOpensAt: '2026-10-05T00:00:00.000Z' });

    expect(validateContestDates(merged).length).toBeGreaterThan(0);

    try {
      assertContestDatesValid(merged);
      expect.unreachable('expected an incoherent timeline to be rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('VALIDATION_FAILED');
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toContain('Voting cannot open before submissions close');
      expect(apiErr.fields?.['dates']).toBeTruthy();
    }
  });

  it('accepts a coherent patch', () => {
    const merged = mergeContestDates(baseDates(), { votingClosesAt: '2026-10-30T00:00:00.000Z' });
    expect(validateContestDates(merged)).toEqual([]);
    expect(() => assertContestDatesValid(merged)).not.toThrow();
  });

  it('allows clearing a date to null even when that removes a constraint', () => {
    // Clearing submissionsCloseAt removes the very constraint the earlier
    // votingOpensAt would have violated, so this must be permitted.
    const merged = mergeContestDates(baseDates(), {
      submissionsCloseAt: null,
      votingOpensAt: '2026-10-05T00:00:00.000Z',
    });
    expect(merged.submissionsCloseAt).toBeNull();
    expect(() => assertContestDatesValid(merged)).not.toThrow();
  });

  it('allows clearing every date (a contest back in SETUP)', () => {
    const merged = mergeContestDates(baseDates(), {
      submissionsOpenAt: null,
      submissionsCloseAt: null,
      votingOpensAt: null,
      votingClosesAt: null,
    });
    expect(() => assertContestDatesValid(merged)).not.toThrow();
  });

  it('rejects submissions closing before they open', () => {
    const merged = mergeContestDates(baseDates(), { submissionsCloseAt: '2026-09-01T00:00:00.000Z' });
    expect(() => assertContestDatesValid(merged)).toThrow(ApiError);
  });

  it('rejects voting closing before it opens', () => {
    const merged = mergeContestDates(baseDates(), { votingClosesAt: '2026-10-10T12:00:00.000Z' });
    expect(() => assertContestDatesValid(merged)).toThrow(ApiError);
  });
});

// ---------------------------------------------------------------------------
// sortTurnout
// ---------------------------------------------------------------------------

describe('sortTurnout', () => {
  const row = (displayName: string, hasVoted: boolean) => ({ displayName, hasVoted });

  it('puts non-voters first, then sorts by display name', () => {
    const sorted = sortTurnout([
      row('Alice', true),
      row('Zoe', false),
      row('Bob', true),
      row('Ada', false),
    ]);
    expect(sorted.map((r) => r.displayName)).toEqual(['Ada', 'Zoe', 'Alice', 'Bob']);
  });

  it('sorts by name within a group that has all voted', () => {
    const sorted = sortTurnout([row('Carol', true), row('Alice', true), row('Bob', true)]);
    expect(sorted.map((r) => r.displayName)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('does not mutate the input', () => {
    const rows = [row('Zoe', true), row('Ada', false)];
    const sorted = sortTurnout(rows);
    expect(rows.map((r) => r.displayName)).toEqual(['Zoe', 'Ada']);
    expect(sorted.map((r) => r.displayName)).toEqual(['Ada', 'Zoe']);
  });

  it('handles an empty roster', () => {
    expect(sortTurnout([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// diffContestFields
// ---------------------------------------------------------------------------

describe('diffContestFields', () => {
  it('records only fields that actually changed', () => {
    const changes = diffContestFields(
      { title: 'Old', description: 'same', minBallotsToPublish: 5 },
      { title: 'New', description: 'same', minBallotsToPublish: 5 },
    );
    expect(Object.keys(changes)).toEqual(['title']);
    expect(changes['title']).toEqual({ before: 'Old', after: 'New' });
  });

  it('captures a date being cleared, and one being set', () => {
    const changes = diffContestFields(
      { votingOpensAt: '2026-10-11T00:00:00.000Z', votingClosesAt: null },
      { votingOpensAt: null, votingClosesAt: '2026-10-20T00:00:00.000Z' },
    );
    expect(changes['votingOpensAt']).toEqual({ before: '2026-10-11T00:00:00.000Z', after: null });
    expect(changes['votingClosesAt']).toEqual({ before: null, after: '2026-10-20T00:00:00.000Z' });
  });

  it('records a boolean flipping to false', () => {
    const changes = diffContestFields({ allowSelfVote: true }, { allowSelfVote: false });
    expect(changes['allowSelfVote']).toEqual({ before: 'true', after: 'false' });
  });

  it('returns nothing for a no-op save', () => {
    const fields = { title: 'Same', allowSelfVote: true, votingOpensAt: null };
    expect(diffContestFields(fields, fields)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ApiError contract relied on by the routes
// ---------------------------------------------------------------------------

describe('ApiError codes used by the admin routes', () => {
  it('maps SUBMISSION_NOT_FOUND to 404', () => {
    expect(new ApiError('SUBMISSION_NOT_FOUND').status).toBe(404);
  });

  it('maps ADMIN_REQUIRED to 403', () => {
    expect(new ApiError('ADMIN_REQUIRED').status).toBe(403);
  });

  it('maps VALIDATION_FAILED to 400 and carries field detail', () => {
    const err = new ApiError('VALIDATION_FAILED', 'bad dates', { dates: 'nope' });
    expect(err.status).toBe(400);
    expect(err.toBody().error.fields).toEqual({ dates: 'nope' });
  });
});
