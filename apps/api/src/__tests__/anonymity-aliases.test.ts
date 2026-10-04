/**
 * ADVERSARIAL SUITE — GUARANTEE F: aliases leak neither order nor identity.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 01-SPEC.md §4:
 *
 *   "Each entry gets a stable anonymous alias: 'Entry 07' style, assigned by
 *    shuffled order at the close of submissions so numbering doesn't leak
 *    upload time."
 *
 * THE ATTACK THIS DEFENDS AGAINST. If aliases were handed out in upload order,
 * the number would be a timestamp in disguise. "Entry 01" is whoever posted
 * first; "Entry 24" is the person who threw something together at the
 * deadline. Anyone who watched the gallery fill up — or who simply knows that
 * a particular colleague always submits the moment a thing opens — could read
 * identities straight off the labels. The shuffle is the entire mitigation,
 * and a refactor that "simplified" it into `orderBy('createdAt')` would look
 * perfectly innocent in review.
 *
 * MEASURING "the order differs" HONESTLY. A shuffle can legitimately, by pure
 * chance, return something close to the input order, so a single-sample test
 * would be flaky. Two things make these assertions sound:
 *
 *   • the seed is FIXED, so each assertion is deterministic — it either holds
 *     or it does not, forever, with no flake;
 *   • the field is large (40 entries) and the property is also checked across
 *     200 independent seeds, where systematic order-preservation would show up
 *     as a population effect rather than a coincidence.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase.js', async () => (await import('./support/firebase-mock.js')).firebaseModule);

import type { FastifyInstance } from 'fastify';
import { formatAlias } from '@contest/shared';
import { seededShuffle } from '../services/aliases.js';
import {
  CONTEST_ID,
  buildTestApp,
  call,
  resetTestState,
  seedContest,
  seedPerson,
  seedSubmission,
  setupTestEnv,
  TIE_BREAK_SEED,
} from './support/harness.js';

/** Big enough that an accidental identity ordering is not a coincidence. */
const FIELD_SIZE = 40;

let app: FastifyInstance;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Spearman's rank correlation between two equal-length rankings.
 *
 * +1 means the alias order reproduces the creation order exactly (a total
 * leak), -1 means it exactly reverses it (equally a leak — just read the list
 * backwards), and 0 means they are unrelated.
 */
function spearman(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const sumDiffSquared = a.reduce((acc, value, index) => {
    const delta = value - (b[index] ?? 0);
    return acc + delta * delta;
  }, 0);
  return 1 - (6 * sumDiffSquared) / (n * (n * n - 1));
}

/** How many items kept their original position. */
function fixedPoints(a: readonly number[], b: readonly number[]): number {
  return a.reduce((acc, value, index) => acc + (value === b[index] ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Seed a field whose CREATION ORDER is known and whose ids sort into that
 * same order.
 *
 * The id ordering matters: `assignAliasesIfDue` sorts by id to get a canonical
 * input before shuffling. Making id order == creation order is the WORST case
 * for the guarantee — if the shuffle were dropped, the alias order would come
 * out exactly equal to the upload order and the tests below would catch it.
 */
function seedField(size: number): string[] {
  const ids: string[] = [];
  const base = Date.UTC(2026, 3, 1, 8, 0, 0);
  for (let i = 0; i < size; i += 1) {
    const id = `entry-${String(i).padStart(3, '0')}`;
    ids.push(id);
    seedPerson({ uid: `u-${id}`, email: `person${i}@google.com`, displayName: `Person Number ${i}` });
    seedSubmission({
      id,
      ownerUid: `u-${id}`,
      alias: null,
      createdAt: new Date(base + i * 60_000),
    });
  }
  return ids;
}

/** Trigger assignment (the gallery read does it) and read the labels back. */
async function assignedAliases(token: string): Promise<Map<string, string>> {
  const res = await call(app, { url: '/api/submissions', token });
  expect(res.status).toBe(200);
  const entries = (res.json as { submissions: Array<{ id: string; alias: string }> }).submissions;
  return new Map(entries.map((e) => [e.id, e.alias]));
}

beforeEach(() => {
  setupTestEnv();
  resetTestState();
  // Submissions have closed and voting is open, so aliases are due; and
  // `aliasesAssignedAt` is null so the assignment actually runs.
  seedContest({ aliasesAssignedAt: null });
});

// ===========================================================================
// F16 — alias number does not correlate with creation time
// ===========================================================================

describe('F16 — alias numbers do not encode upload order', () => {
  it('assigns a unique, contiguous label to every active entry', async () => {
    const ids = seedField(FIELD_SIZE);
    app = await buildTestApp();
    const viewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });

    const aliases = await assignedAliases(viewer.token);
    expect(aliases.size).toBe(ids.length);

    const labels = [...aliases.values()].sort();
    const expected = Array.from({ length: ids.length }, (_, i) => formatAlias(i + 1)).sort();
    expect(labels).toEqual(expected);
    await app.close();
  });

  it('the alias ordering is NOT the creation ordering', async () => {
    const ids = seedField(FIELD_SIZE);
    app = await buildTestApp();
    const viewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });
    const aliases = await assignedAliases(viewer.token);

    // `ids` is in creation order; read out each one's alias number.
    const aliasNumbers = ids.map((id) => Number((aliases.get(id) ?? 'Entry 0').replace('Entry ', '')));
    const creationRanks = ids.map((_, i) => i + 1);

    // The blunt assertion: they are simply not the same sequence. With 40
    // entries, a shuffle reproducing creation order has probability 1/40!,
    // which is about 1 in 8e47.
    expect(aliasNumbers).not.toEqual(creationRanks);
    // Nor the exact reverse, which would leak just as much.
    expect(aliasNumbers).not.toEqual([...creationRanks].reverse());

    // And the statistical one: essentially no rank correlation. A fixed seed
    // makes this deterministic, so the bound is a real assertion rather than
    // a flaky threshold.
    const rho = spearman(creationRanks, aliasNumbers);
    expect(Math.abs(rho), `alias order correlates with upload order (rho=${rho.toFixed(3)})`).toBeLessThan(0.5);

    // Very few entries should keep their original position.
    expect(fixedPoints(creationRanks, aliasNumbers)).toBeLessThan(FIELD_SIZE / 4);
    await app.close();
  });

  it('the earliest uploader is not Entry 01, and the latest is not Entry 40', async () => {
    // The specific, human version of the attack: the two positions an observer
    // is most likely to guess.
    const ids = seedField(FIELD_SIZE);
    app = await buildTestApp();
    const viewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });
    const aliases = await assignedAliases(viewer.token);

    expect(aliases.get(ids[0]!)).not.toBe(formatAlias(1));
    expect(aliases.get(ids[ids.length - 1]!)).not.toBe(formatAlias(FIELD_SIZE));
    await app.close();
  });

  it('is deterministic: the same seed reproduces the same labels', async () => {
    // A label that moves between runs is its own problem — people discuss
    // "Entry 07" — so the shuffle must be seeded, not random.
    seedField(FIELD_SIZE);
    app = await buildTestApp();
    const viewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });
    const first = await assignedAliases(viewer.token);
    // A second gallery read must NOT reshuffle: `aliasesAssignedAt` is set.
    const second = await assignedAliases(viewer.token);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
    await app.close();

    // A fresh contest with the same seed and the same ids reproduces it too.
    resetTestState();
    seedContest({ aliasesAssignedAt: null });
    seedField(FIELD_SIZE);
    const rerunApp = await buildTestApp();
    const rerunViewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });
    const rerun = await call(rerunApp, { url: '/api/submissions', token: rerunViewer.token });
    const rerunAliases = new Map(
      (rerun.json as { submissions: Array<{ id: string; alias: string }> }).submissions.map((e) => [e.id, e.alias]),
    );
    expect([...rerunAliases.entries()].sort()).toEqual([...first.entries()].sort());
    await rerunApp.close();
  });

  it('withdrawn and disqualified entries burn no label, leaving no telltale gap', async () => {
    // A gap in the numbering advertises "somebody pulled out", and combined
    // with a bit of gossip that is most of the way to naming them.
    seedField(6);
    seedSubmission({ id: 'entry-900', ownerUid: 'u-withdrawn', alias: null, status: 'withdrawn' });
    seedSubmission({ id: 'entry-901', ownerUid: 'u-disqualified', alias: null, status: 'disqualified' });

    app = await buildTestApp();
    const viewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });
    const aliases = await assignedAliases(viewer.token);

    expect(aliases.size).toBe(6);
    expect([...aliases.values()].sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => formatAlias(i + 1)).sort(),
    );
    await app.close();
  });

  it('the gallery is ordered by alias, so its order leaks nothing either', async () => {
    // Sorting the response by alias is safe precisely BECAUSE the alias is
    // already shuffled. Sorting by createdAt would hand back the upload order
    // the aliases were designed to hide.
    const ids = seedField(12);
    app = await buildTestApp();
    const viewer = seedPerson({ uid: 'u-viewer', email: 'viewer@google.com', displayName: 'Viewer Person' });
    await assignedAliases(viewer.token);

    const res = await call(app, { url: '/api/submissions', token: viewer.token });
    const ordered = (res.json as { submissions: Array<{ id: string; alias: string }> }).submissions;

    expect(ordered.map((e) => e.alias)).toEqual([...ordered.map((e) => e.alias)].sort());
    // The response order must not be the creation order.
    expect(ordered.map((e) => e.id)).not.toEqual(ids);
    await app.close();
  });
});

// ===========================================================================
// F16 — the shuffle itself, across many seeds
// ===========================================================================

describe('F16 — seededShuffle does not systematically preserve order', () => {
  const SIZE = 20;
  const SEEDS = 200;
  const identity = Array.from({ length: SIZE }, (_, i) => i);

  it('never returns the input order across 200 independent seeds', () => {
    // One sample proves nothing; a population is the honest way to state
    // "the shuffle really shuffles". If someone replaced the body of
    // `seededShuffle` with `items.slice()`, this fails 200 times over.
    let identical = 0;
    for (let s = 0; s < SEEDS; s += 1) {
      if (seededShuffle(identity, `seed-${s}`).join(',') === identity.join(',')) identical += 1;
    }
    expect(identical).toBe(0);
  });

  it('has near-zero mean rank correlation with the input order', () => {
    let total = 0;
    for (let s = 0; s < SEEDS; s += 1) {
      const shuffled = seededShuffle(identity, `seed-${s}`);
      total += spearman(identity, shuffled);
    }
    const mean = total / SEEDS;
    expect(Math.abs(mean), `mean rho over ${SEEDS} seeds was ${mean.toFixed(4)}`).toBeLessThan(0.1);
  });

  it('moves every position to a variety of destinations', () => {
    // If position 0 always landed in the same place, the "shuffle" would be a
    // fixed relabelling and an observer could invert it once and for all.
    const destinationsOfFirst = new Set<number>();
    for (let s = 0; s < SEEDS; s += 1) {
      destinationsOfFirst.add(seededShuffle(identity, `seed-${s}`).indexOf(0));
    }
    expect(destinationsOfFirst.size).toBeGreaterThan(SIZE / 2);
  });

  it('is a permutation — nothing lost, nothing duplicated', () => {
    for (let s = 0; s < 25; s += 1) {
      const shuffled = seededShuffle(identity, `seed-${s}`);
      expect([...shuffled].sort((a, b) => a - b)).toEqual(identity);
    }
  });

  it('does not mutate its input', () => {
    const input = [...identity];
    seededShuffle(input, TIE_BREAK_SEED);
    expect(input).toEqual(identity);
  });

  it('depends on the seed — a different seed gives a different permutation', () => {
    const a = seededShuffle(identity, `${TIE_BREAK_SEED}-a`);
    const b = seededShuffle(identity, `${TIE_BREAK_SEED}-b`);
    expect(a).not.toEqual(b);
  });

  it('is stable for the contest seed this deployment uses', () => {
    expect(seededShuffle(identity, TIE_BREAK_SEED)).toEqual(seededShuffle(identity, TIE_BREAK_SEED));
    expect(CONTEST_ID).toBe('north7');
  });
});
