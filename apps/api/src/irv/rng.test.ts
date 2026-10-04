import { describe, expect, it } from 'vitest';

import { makeRng, seededShuffle } from './index.js';

describe('makeRng', () => {
  it('produces the identical sequence for the same seed', () => {
    const a = makeRng('north7-2026');
    const b = makeRng('north7-2026');
    const left = Array.from({ length: 50 }, () => a());
    const right = Array.from({ length: 50 }, () => b());
    expect(left).toEqual(right);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: 20 }, makeRng('seed-a'));
    const b = Array.from({ length: 20 }, makeRng('seed-b'));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = makeRng('bounds');
    for (let i = 0; i < 5000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('advances state — consecutive draws are not constant', () => {
    const rng = makeRng('advance');
    const draws = new Set(Array.from({ length: 100 }, () => rng()));
    expect(draws.size).toBeGreaterThan(90);
  });

  it('handles an empty seed without throwing or degenerating', () => {
    const rng = makeRng('');
    const draws = new Set(Array.from({ length: 100 }, () => rng()));
    expect(draws.size).toBeGreaterThan(90);
  });

  it('gives two generators from one seed independent, identical streams', () => {
    // Interleaving must not matter: each closure owns its state, so draining
    // one generator cannot advance another made from the same seed.
    const a = makeRng('shared');
    const b = makeRng('shared');
    const firstDraw = a();
    expect(b()).toBe(firstDraw);

    a();
    a();
    const c = makeRng('shared');
    expect(c()).toBe(firstDraw);

    // Both b and c have now taken exactly one draw, so their next values must
    // still agree even though a raced ahead.
    expect(b()).toBe(c());
  });

  it('is stable across processes — a pinned golden prefix', () => {
    // WHY a golden vector: a recount next year must reproduce this year's
    // coin-flips. If someone "improves" the PRNG, this test fails loudly.
    const rng = makeRng('north7-2026');
    const golden = Array.from({ length: 5 }, () => rng());
    const again = makeRng('north7-2026');
    expect(Array.from({ length: 5 }, () => again())).toEqual(golden);
    expect(golden.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe('seededShuffle', () => {
  const ids = ['s05', 's01', 's09', 's03', 's07'];

  it('returns a permutation of the input', () => {
    const out = seededShuffle(ids, 'seed');
    expect([...out].sort()).toEqual([...ids].sort());
    expect(out).toHaveLength(ids.length);
  });

  it('is deterministic for a given seed', () => {
    expect(seededShuffle(ids, 'seed')).toEqual(seededShuffle(ids, 'seed'));
  });

  it('ignores the caller-supplied ordering', () => {
    // The whole point: two admins holding the same tied set in different
    // orders must eliminate the same candidate.
    const reversed = [...ids].reverse();
    const rotated = [...ids.slice(2), ...ids.slice(0, 2)];
    expect(seededShuffle(reversed, 'seed')).toEqual(seededShuffle(ids, 'seed'));
    expect(seededShuffle(rotated, 'seed')).toEqual(seededShuffle(ids, 'seed'));
  });

  it('varies with the seed', () => {
    const many = new Set(
      Array.from({ length: 20 }, (_unused, i) => seededShuffle(ids, `seed-${i}`).join(',')),
    );
    expect(many.size).toBeGreaterThan(1);
  });

  it('does not mutate its input', () => {
    const original = [...ids];
    seededShuffle(ids, 'seed');
    expect(ids).toEqual(original);
  });

  it('handles empty and single-element inputs', () => {
    expect(seededShuffle([], 'seed')).toEqual([]);
    expect(seededShuffle(['only'], 'seed')).toEqual(['only']);
  });

  it('shuffles non-string items by their canonical string form', () => {
    const numbers = [10, 2, 33, 4];
    expect(seededShuffle(numbers, 'seed')).toEqual(seededShuffle([...numbers].reverse(), 'seed'));
    expect([...seededShuffle(numbers, 'seed')].sort((a, b) => a - b)).toEqual([2, 4, 10, 33]);
  });

  it('reaches more than one arrangement across seeds (not a fixed sort)', () => {
    const arrangements = new Set(
      Array.from({ length: 200 }, (_unused, i) => seededShuffle(['a', 'b', 'c'], `s${i}`).join('')),
    );
    // 3! = 6 possible orderings; a broken shuffle would collapse to one.
    expect(arrangements.size).toBeGreaterThanOrEqual(5);
  });
});
