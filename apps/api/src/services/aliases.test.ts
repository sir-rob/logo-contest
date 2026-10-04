/**
 * Tests for the alias shuffle.
 *
 * The Firestore transaction in `assignAliasesIfDue` is covered by integration
 * tests against the emulator; what is tested here is everything that decides
 * WHICH label an entry gets, because that is the part with anonymity
 * consequences and it is pure.
 */

import { describe, expect, it } from 'vitest';
import { formatAlias } from '@contest/shared';
import { aliasesAreDue, orderSubmissionsForViewer, seededShuffle } from './aliases.js';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `sub-${String(i).padStart(3, '0')}`);

describe('seededShuffle', () => {
  it('is deterministic for a given seed', () => {
    const input = ids(25);
    const a = seededShuffle(input, 'seed-alpha');
    const b = seededShuffle(input, 'seed-alpha');
    expect(a).toEqual(b);
  });

  it('stays deterministic across many independent calls', () => {
    const input = ids(12);
    const first = seededShuffle(input, 'contest-2026-tiebreak');
    for (let i = 0; i < 50; i += 1) {
      expect(seededShuffle(input, 'contest-2026-tiebreak')).toEqual(first);
    }
  });

  it('produces a different order for a different seed', () => {
    const input = ids(25);
    expect(seededShuffle(input, 'seed-alpha')).not.toEqual(seededShuffle(input, 'seed-beta'));
  });

  it('is a true permutation — nothing lost, nothing duplicated', () => {
    const input = ids(40);
    const out = seededShuffle(input, 'whatever');
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it('does not mutate its input', () => {
    const input = ids(10);
    const snapshot = [...input];
    seededShuffle(input, 'seed');
    expect(input).toEqual(snapshot);
  });

  it('actually reorders a realistic field (not the identity permutation)', () => {
    const input = ids(20);
    expect(seededShuffle(input, 'realistic-seed')).not.toEqual(input);
  });

  it('handles empty and single-element inputs', () => {
    expect(seededShuffle([], 'seed')).toEqual([]);
    expect(seededShuffle(['only'], 'seed')).toEqual(['only']);
  });

  it('works on objects, not just strings', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = seededShuffle(items, 'seed');
    expect(out.map((o) => o.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('distributes positions roughly uniformly across seeds', () => {
    // The anonymity property: over many contests, no entry position is
    // systematically favoured. 10 slots x 2000 seeds = 200 expected hits per
    // cell; a hard floor of 120 catches a genuinely broken PRNG (a biased
    // modulo, a stuck state) without being flaky on ordinary variance.
    const n = 10;
    const trials = 2000;
    const input = ids(n);
    const counts: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

    for (let t = 0; t < trials; t += 1) {
      const out = seededShuffle(input, `seed-${t}`);
      out.forEach((item, position) => {
        const original = input.indexOf(item);
        const row = counts[original];
        if (row !== undefined) row[position] = (row[position] ?? 0) + 1;
      });
    }

    const expected = trials / n;
    for (const row of counts) {
      for (const cell of row) {
        expect(cell).toBeGreaterThan(expected * 0.6);
        expect(cell).toBeLessThan(expected * 1.4);
      }
    }
  });

  it('the first slot is not dominated by any one entry', () => {
    // A design contest's top-left tile is a real advantage; make sure the
    // shuffle is not quietly handing it to the same entry every time.
    const input = ids(8);
    const winners = new Set<string>();
    for (let t = 0; t < 200; t += 1) {
      const out = seededShuffle(input, `s${t}`);
      const top = out[0];
      if (top !== undefined) winners.add(top);
    }
    expect(winners.size).toBe(input.length);
  });

  it('assigns stable labels when applied the way the assigner does', () => {
    // Mirrors assignAliasesIfDue: canonical sort, shuffle, then label.
    const canonical = [...ids(6)].sort();
    const label = (): Record<string, string> => {
      const shuffled = seededShuffle(canonical, 'tie-break-seed');
      return Object.fromEntries(shuffled.map((id, i) => [id, formatAlias(i + 1)]));
    };
    expect(label()).toEqual(label());
    expect(Object.values(label()).sort()).toEqual([
      'Entry 01',
      'Entry 02',
      'Entry 03',
      'Entry 04',
      'Entry 05',
      'Entry 06',
    ]);
  });
});

describe('aliasesAreDue', () => {
  it('is false once aliases have been assigned, whatever the phase', () => {
    const at = new Date('2026-05-01T00:00:00Z');
    for (const phase of ['SETUP', 'SUBMISSIONS_OPEN', 'VOTING_OPEN', 'CLOSED', 'RESULTS_PUBLISHED']) {
      expect(aliasesAreDue(at, phase)).toBe(false);
    }
  });

  it('is false while the field can still change', () => {
    expect(aliasesAreDue(null, 'SETUP')).toBe(false);
    expect(aliasesAreDue(null, 'SUBMISSIONS_OPEN')).toBe(false);
  });

  it('is true once submissions have closed and nothing is assigned yet', () => {
    expect(aliasesAreDue(null, 'VOTING_OPEN')).toBe(true);
    expect(aliasesAreDue(null, 'CLOSED')).toBe(true);
    expect(aliasesAreDue(null, 'RESULTS_PUBLISHED')).toBe(true);
  });
});

describe('orderSubmissionsForViewer', () => {
  const labelled = [
    { id: 'c', alias: 'Entry 03' },
    { id: 'a', alias: 'Entry 01' },
    { id: 'b', alias: 'Entry 02' },
  ];
  const unlabelled = ids(12).map((id) => ({ id, alias: null }));

  it('orders by alias once every entry has one', () => {
    const out = orderSubmissionsForViewer(labelled, 'seed', 'viewer-1');
    expect(out.map((s) => s.alias)).toEqual(['Entry 01', 'Entry 02', 'Entry 03']);
  });

  it('gives every viewer the same order once aliases exist', () => {
    const a = orderSubmissionsForViewer(labelled, 'seed', 'viewer-1');
    const b = orderSubmissionsForViewer(labelled, 'seed', 'viewer-2');
    expect(a).toEqual(b);
  });

  it('does not return entries in upload order before aliases exist', () => {
    // The gallery must never be a chronological list — that is an upload-time
    // oracle. `unlabelled` is already in creation order.
    const out = orderSubmissionsForViewer(unlabelled, 'seed', 'viewer-1');
    expect(out.map((s) => s.id)).not.toEqual(unlabelled.map((s) => s.id));
  });

  it('gives different viewers different orders before aliases exist', () => {
    const a = orderSubmissionsForViewer(unlabelled, 'seed', 'viewer-1');
    const b = orderSubmissionsForViewer(unlabelled, 'seed', 'viewer-2');
    expect(a.map((s) => s.id)).not.toEqual(b.map((s) => s.id));
  });

  it('is stable for one viewer across refreshes', () => {
    const a = orderSubmissionsForViewer(unlabelled, 'seed', 'viewer-1');
    const b = orderSubmissionsForViewer(unlabelled, 'seed', 'viewer-1');
    expect(a).toEqual(b);
  });

  it('ignores the order the database happened to return', () => {
    const shuffledInput = [...unlabelled].reverse();
    const a = orderSubmissionsForViewer(unlabelled, 'seed', 'viewer-1');
    const b = orderSubmissionsForViewer(shuffledInput, 'seed', 'viewer-1');
    expect(a).toEqual(b);
  });

  it('falls back to the shuffle when only some entries are labelled', () => {
    const mixed = [
      { id: 'a', alias: 'Entry 01' },
      { id: 'b', alias: null },
    ];
    const out = orderSubmissionsForViewer(mixed, 'seed', 'viewer-1');
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('handles an empty gallery', () => {
    expect(orderSubmissionsForViewer([], 'seed', 'viewer-1')).toEqual([]);
  });
});
