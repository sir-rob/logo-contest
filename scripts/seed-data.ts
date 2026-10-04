/**
 * Pure fixture generators for the local seed.
 *
 * Everything in this file is deterministic and side-effect free: no Firestore,
 * no filesystem, no `Math.random()`, no `Date.now()`. The only entropy is the
 * injected PRNG, and the only clock is the `now` argument. That is what makes
 * the interesting parts — above all the guaranteed-tie ballot construction —
 * unit-testable without an emulator.
 *
 * `scripts/seed.ts` is the I/O shell that calls into here.
 */

import { MAX_RANKS, formatAlias } from '@contest/shared';

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

/**
 * xfnv1a string hash → four 32-bit seeds, consumed by mulberry32.
 *
 * `Math.random()` is deliberately unavailable to every generator below: a seed
 * script that produces a different contest on every run is impossible to write
 * a bug report against ("it tied for me").
 */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for fixtures, and reproducible. */
export function makeRng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Array access that fails loudly instead of handing back `undefined`. */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`seed-data: index ${index} out of range (length ${items.length})`);
  }
  return value;
}

/** Integer in [0, max). */
function randInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max) % Math.max(1, max);
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const a = at(out, i);
    const b = at(out, j);
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Largest-remainder apportionment: split `total` into integer counts following
 * `weights` exactly, with no drift. Used so first-preference distributions are
 * an arithmetic fact rather than an emergent property of sampling.
 */
export function allocateByWeight(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map((v) => Math.floor(v));
  let assigned = counts.reduce((acc, c) => acc + c, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((x, y) => (y.frac === x.frac ? x.i - y.i : y.frac - x.frac));

  let k = 0;
  while (assigned < total && order.length > 0) {
    const idx = at(order, k % order.length).i;
    counts[idx] = at(counts, idx) + 1;
    assigned++;
    k++;
  }
  return counts;
}

/** UUID-v4-shaped identifier drawn from the injected PRNG (so: reproducible). */
export function uuidFrom(rng: () => number): string {
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) hex.push(randInt(rng, 16).toString(16));
  hex[12] = '4';
  hex[16] = (8 + randInt(rng, 4)).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface SeedUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin';
}

/**
 * Obviously-fake names. Kept clear of the entry-title vocabulary below so a
 * title can never read like somebody's name — the API rejects titles that
 * match the uploader's display name or email local-part.
 */
const FIRST_NAMES = [
  'Avery', 'Bertie', 'Casimir', 'Delphine', 'Emeric', 'Fenella', 'Gideon', 'Halcyon',
  'Isolde', 'Jarrah', 'Kestrel', 'Lachlan', 'Mirabel', 'Norbert', 'Ottoline', 'Percival',
  'Quilla', 'Rosalind', 'Sorrel', 'Tobias', 'Ulric', 'Verity', 'Wilhelmina', 'Xanthe',
  'Yolanda', 'Zephyrine', 'Amaranth', 'Bramwell', 'Corliss', 'Dorothea',
] as const;

const LAST_NAMES = [
  'Ashdown', 'Braithwaite', 'Cadwallader', 'Dunmore', 'Ellerby', 'Fairweather', 'Glendenning',
  'Harkness', 'Inglethorpe', 'Jessop', 'Kirkbride', 'Lorrimer', 'Morecombe', 'Netherfield',
  'Ollerenshaw', 'Pemberton', 'Quennell', 'Ravensworth', 'Standish', 'Thorogood', 'Underhill',
  'Vandeleur', 'Wetherby', 'Yarborough', 'Ziegenfuss', 'Applewhaite', 'Beddingfield',
  'Carmichael', 'Drinkwater', 'Etherington',
] as const;

/** `Avery Ashdown` → `avery.ashdown`. */
function emailLocal(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

/**
 * N distinct members. Index 0 is the admin — `seed.ts` overwrites its email
 * with `BOOTSTRAP_ADMIN_EMAIL` so the operator can actually sign in as one.
 */
export function generateUsers(n: number, rng: () => number): SeedUser[] {
  if (n < 1) throw new Error('generateUsers: need at least one user');
  if (n > FIRST_NAMES.length * 2) {
    throw new Error(`generateUsers: ${n} exceeds the fixture name pool (${FIRST_NAMES.length * 2})`);
  }

  const firsts = shuffle(FIRST_NAMES, rng);
  const lasts = shuffle(LAST_NAMES, rng);
  const used = new Set<string>();
  const users: SeedUser[] = [];

  for (let i = 0; i < n; i++) {
    const first = at(firsts, i % firsts.length);
    const last = at(lasts, (i * 7 + Math.floor(i / lasts.length)) % lasts.length);
    const displayName = `${first} ${last}`.slice(0, 40);

    let local = emailLocal(displayName);
    let suffix = 2;
    while (used.has(local)) local = `${emailLocal(displayName)}${suffix++}`;
    used.add(local);

    users.push({
      uid: `seeduser-${String(i + 1).padStart(2, '0')}`,
      email: `${local}@google.com`,
      displayName,
      role: i === 0 ? 'admin' : 'member',
    });
  }
  return users;
}

// ---------------------------------------------------------------------------
// Contest dates / phases
// ---------------------------------------------------------------------------

export const SEED_PHASES = ['setup', 'submissions', 'voting', 'closed', 'results'] as const;
export type SeedPhase = (typeof SEED_PHASES)[number];

export function isSeedPhase(value: string): value is SeedPhase {
  return (SEED_PHASES as readonly string[]).includes(value);
}

/**
 * Fixed, never generated. The tie-break chain ends in a seeded shuffle, so a
 * varying seed would make two runs of the same fixture break a tie differently
 * — exactly the non-reproducibility the stored seed exists to prevent.
 */
export const FIXED_TIE_BREAK_SEED = 'north7-tiebreak-2026-fixed';

export interface ContestDates {
  submissionsOpenAt: Date;
  submissionsCloseAt: Date;
  votingOpensAt: Date;
  votingClosesAt: Date;
  resultsPublishedAt: Date | null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const offset = (now: Date, ms: number): Date => new Date(now.getTime() + ms);

/**
 * Real dates, positioned around the real clock, chosen so `derivePhase` returns
 * the requested phase without any fake-clock help. Doing it this way means the
 * seeded app behaves *normally* — countdowns tick, windows really are open —
 * instead of only looking right to code that remembers to call `now(config)`.
 *
 * `FAKE_NOW` + `ALLOW_FAKE_CLOCK=true` remain available for the opposite trick:
 * freezing one seeded dataset and walking it through every phase.
 *
 * The windows are sequential and `votingOpensAt >= submissionsCloseAt`, which
 * is what `validateContestDates` in @contest/shared insists on.
 */
export function generateContestDates(phase: SeedPhase, now: Date): ContestDates {
  switch (phase) {
    // Everything still ahead of us → derivePhase falls through to SETUP.
    case 'setup':
      return {
        submissionsOpenAt: offset(now, 2 * DAY),
        submissionsCloseAt: offset(now, 9 * DAY),
        votingOpensAt: offset(now, 9 * DAY),
        votingClosesAt: offset(now, 16 * DAY),
        resultsPublishedAt: null,
      };
    case 'submissions':
      return {
        submissionsOpenAt: offset(now, -2 * DAY),
        submissionsCloseAt: offset(now, 5 * DAY),
        votingOpensAt: offset(now, 5 * DAY),
        votingClosesAt: offset(now, 12 * DAY),
        resultsPublishedAt: null,
      };
    case 'voting':
      return {
        submissionsOpenAt: offset(now, -9 * DAY),
        submissionsCloseAt: offset(now, -2 * DAY),
        votingOpensAt: offset(now, -1 * DAY),
        votingClosesAt: offset(now, 6 * DAY),
        resultsPublishedAt: null,
      };
    case 'closed':
      return {
        submissionsOpenAt: offset(now, -16 * DAY),
        submissionsCloseAt: offset(now, -9 * DAY),
        votingOpensAt: offset(now, -8 * DAY),
        votingClosesAt: offset(now, -1 * DAY),
        resultsPublishedAt: null,
      };
    // Same windows as `closed`, plus a publication stamp in the past, which
    // derivePhase treats as beating the clock outright.
    case 'results':
      return {
        submissionsOpenAt: offset(now, -18 * DAY),
        submissionsCloseAt: offset(now, -11 * DAY),
        votingOpensAt: offset(now, -10 * DAY),
        votingClosesAt: offset(now, -3 * DAY),
        resultsPublishedAt: offset(now, -12 * HOUR),
      };
  }
}

/** Aliases are revealed when submissions close, i.e. from voting onwards. */
export function phaseHasAliases(phase: SeedPhase): boolean {
  return phase === 'voting' || phase === 'closed' || phase === 'results';
}

/** Ballots only exist once voting has opened. */
export function phaseHasBallots(phase: SeedPhase): boolean {
  return phase === 'voting' || phase === 'closed' || phase === 'results';
}

/** Shuffled alias assignment, so "Entry 01" leaks nothing about upload order. */
export function assignAliases(submissionIds: readonly string[], rng: () => number): Map<string, string> {
  const shuffled = shuffle(submissionIds, rng);
  const map = new Map<string, string>();
  shuffled.forEach((id, i) => map.set(id, formatAlias(i + 1)));
  return map;
}

// ---------------------------------------------------------------------------
// Submission text
// ---------------------------------------------------------------------------

export interface SeedSubmissionContent {
  title: string;
  description: string | undefined;
  creditOptIn: boolean;
}

const TITLE_HEADS = [
  'Seven', 'North', 'Meridian', 'Signal', 'Beacon', 'Compass', 'Lantern', 'Harbour',
  'Summit', 'Anchor', 'Prism', 'Circuit', 'Aurora', 'Cobalt', 'Ember', 'Quartz',
] as const;

const TITLE_TAILS = [
  'Mark', 'Point', 'Field', 'Arc', 'Grid', 'Wave', 'Crest', 'Line',
  'Block', 'Ring', 'Type', 'Sketch', 'Study', 'Draft', 'Proof', 'Cut',
] as const;

const DESCRIPTIONS = [
  'A single bold mark that still reads at favicon size.',
  'Geometry first: one circle, one diagonal, nothing else to argue about.',
  'Built on a 12-column grid so it lines up with the deck template.',
  'Two-colour, so it survives a black-and-white print run.',
  'The negative space does the work here.',
  'Deliberately flat — no gradients, no bevels, no 2009.',
  'Wordmark and glyph are separable; use whichever fits the slide.',
  'Heavier weight than my first pass, which vanished on a projector.',
  'Inspired by old broadcast idents, minus the chrome.',
  'Corner radius is the only soft thing about it.',
  'Scales cleanly from a sticker to a stage backdrop.',
  'Colour is doing the heavy lifting; the shape is intentionally quiet.',
  undefined,
  'Third attempt. The first two were fussy.',
  undefined,
  'Monospace numerals, because the seven should feel technical.',
] as const;

/**
 * True if a title would trip the API's self-identification rule. The server
 * rejects a title matching the uploader's display name or email local-part; we
 * check *containment* of any seeded identity token, which is stricter, because
 * a fixture that gets rejected on read is a bad fixture.
 */
export function titleCollidesWithIdentity(title: string, users: readonly SeedUser[]): boolean {
  const haystack = title.toLowerCase();
  for (const user of users) {
    const local = user.email.split('@')[0] ?? '';
    const tokens = [user.displayName, local, ...user.displayName.split(/\s+/), ...local.split('.')];
    for (const token of tokens) {
      const t = token.trim().toLowerCase();
      if (t.length >= 3 && haystack.includes(t)) return true;
    }
  }
  return false;
}

/** One title/description/credit triple per user, varied and collision-checked. */
export function generateSubmissionContents(
  users: readonly SeedUser[],
  rng: () => number,
): SeedSubmissionContent[] {
  const heads = shuffle(TITLE_HEADS, rng);
  const tails = shuffle(TITLE_TAILS, rng);

  const pool: string[] = [];
  for (let i = 0; i < heads.length; i++) {
    for (let j = 0; j < tails.length; j++) {
      pool.push(`${at(heads, i)} ${at(tails, (i + j) % tails.length)}`);
    }
  }

  const out: SeedSubmissionContent[] = [];
  let cursor = 0;
  for (let i = 0; i < users.length; i++) {
    let title: string | null = null;
    while (cursor < pool.length) {
      const candidate = at(pool, cursor++);
      if (!titleCollidesWithIdentity(candidate, users)) {
        title = candidate;
        break;
      }
    }
    if (title === null) {
      throw new Error('generateSubmissionContents: ran out of identity-safe titles');
    }
    out.push({
      title,
      description: DESCRIPTIONS[i % DESCRIPTIONS.length],
      // Roughly two thirds opt in, deterministically.
      creditOptIn: rng() < 0.66,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ballots
// ---------------------------------------------------------------------------

export const PRESETS = ['normal', 'tie', 'landslide', 'exhausting'] as const;
export type Preset = (typeof PRESETS)[number];

export function isPreset(value: string): value is Preset {
  return (PRESETS as readonly string[]).includes(value);
}

export interface SeedBallot {
  voterUid: string;
  /** Ordered, index 0 = first preference. Distinct submission ids, ≤ MAX_RANKS. */
  ranking: string[];
}

/** Share of `exhausting` ballots that rank only one or two entries. */
export const EXHAUSTING_SHORT_BALLOT_SHARE = 0.7;

/** A ballot that ranks ≤ 2 entries is very likely to exhaust before the end. */
export function countShortBallots(ballots: readonly SeedBallot[]): number {
  return ballots.filter((b) => b.ranking.length <= 2).length;
}

/**
 * Popularity profile: candidate at popularity rank r gets weight 1/(r + 1.5).
 * Chosen because it puts the front-runner around 40% of first preferences with
 * a realistic field — short of the 50% needed to win outright, so the count
 * actually has to run several rounds of transfers.
 */
function popularityWeights(count: number): number[] {
  return Array.from({ length: count }, (_unused, r) => 1 / (r + 1.5));
}

/** Sample `k` distinct ids, probability proportional to weight. Pure. */
function weightedSampleWithout(
  pool: readonly string[],
  weightOf: ReadonlyMap<string, number>,
  k: number,
  rng: () => number,
): string[] {
  const remaining = [...pool];
  const picked: string[] = [];
  while (picked.length < k && remaining.length > 0) {
    let total = 0;
    for (const id of remaining) total += weightOf.get(id) ?? 1;
    let target = rng() * total;
    let chosen = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      target -= weightOf.get(at(remaining, i)) ?? 1;
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    picked.push(at(remaining, chosen));
    remaining.splice(chosen, 1);
  }
  return picked;
}

interface DistributionOptions {
  /** Extra first-preference weight for the front-runner (landslide). */
  frontRunnerShare?: number;
  /** Ballot lengths, sampled uniformly at random from this list. */
  lengths: readonly number[];
  /** Exact number of ballots forced to length 1 or 2 (exhausting). */
  shortBallots?: number;
}

/**
 * Shared machinery for the non-tie presets: apportion first preferences
 * arithmetically (never by sampling, so the headline shape of the fixture is
 * guaranteed), then fill the lower ranks by weighted draw.
 */
function generateDistributedBallots(
  voters: readonly SeedUser[],
  submissionIds: readonly string[],
  rng: () => number,
  options: DistributionOptions,
): SeedBallot[] {
  const byPopularity = shuffle(submissionIds, rng);
  const weights = popularityWeights(byPopularity.length);

  if (options.frontRunnerShare !== undefined) {
    // Hand the front-runner an outright first-round majority.
    const rest = weights.slice(1).reduce((acc, w) => acc + w, 0);
    weights[0] = (rest * options.frontRunnerShare) / (1 - options.frontRunnerShare);
  }

  const weightOf = new Map<string, number>();
  byPopularity.forEach((id, r) => weightOf.set(id, at(weights, r)));

  const firstPrefCounts = allocateByWeight(weights, voters.length);
  const firstPrefs: string[] = [];
  byPopularity.forEach((id, r) => {
    for (let i = 0; i < at(firstPrefCounts, r); i++) firstPrefs.push(id);
  });
  // `allocateByWeight` is exact, so this is belt-and-braces only.
  while (firstPrefs.length < voters.length) firstPrefs.push(at(byPopularity, 0));
  const assigned = shuffle(firstPrefs, rng);

  const shortTarget = options.shortBallots ?? 0;
  const shortSlots = new Set(shuffle(voters.map((_u, i) => i), rng).slice(0, shortTarget));
  const maxRanks = Math.min(MAX_RANKS, submissionIds.length);

  return voters.map((voter, i) => {
    const first = at(assigned, i);
    const wanted = shortSlots.has(i)
      ? (rng() < 0.5 ? 1 : 2)
      : at(options.lengths, randInt(rng, options.lengths.length));
    const length = Math.max(1, Math.min(maxRanks, wanted));
    const rest = weightedSampleWithout(
      submissionIds.filter((id) => id !== first),
      weightOf,
      length - 1,
      rng,
    );
    return { voterUid: voter.uid, ranking: [first, ...rest] };
  });
}

/** The `tie` preset needs five distinct candidates and enough voters to split. */
export const MIN_TIE_VOTERS = 8;
export const MIN_TIE_SUBMISSIONS = 5;

/**
 * THE GUARANTEED TIE.
 *
 * Ties are not an exotic edge case at 10–25 voters, they are a Tuesday. The
 * deterministic tie-break chain and the admin-override UI are first-class code
 * paths, so they need a fixture that ties *by construction*, not by luck.
 *
 * Five candidates matter; every other entry gets zero first preferences and is
 * eliminated harmlessly at the bottom of the count.
 *
 *   A ×a   ballots  [A, …]        — survives to the end
 *   B ×a   ballots  [B, …]        — survives to the end, same size as A
 *   C ×m   ballots  [C, A, …]     — transfers to A when C goes
 *   D ×m   ballots  [D, B, …]     — transfers to B when D goes
 *   G ×g   ballots  [G]           — single rank, exhausts when G goes
 *
 * with `m < a`, `m < g`, `g < a + m`, and `a + a + 2m + g = V`.
 *
 * The count then runs:
 *   1. zero-vote entries are eliminated from the bottom (no effect);
 *   2. C and D are the joint lowest at `m` votes each → an ELIMINATION TIE
 *      mid-count, which is the case the tie-break chain exists for;
 *   3. whichever of C/D loses the tie-break transfers to its partner (A or B),
 *      then the other follows — so A and B both gain exactly `m`;
 *   4. G is now the lowest and is eliminated; its ballots EXHAUST, shrinking
 *      the active denominator to exactly 2(a + m);
 *   5. A and B hold a + m each — precisely 50% apiece. Never "more than 50%",
 *      so no majority winner: a FINAL-ROUND TIE, unbreakable except by the
 *      admin override.
 *
 * `g > m` is what buys step 4 its margin: without those exhausting ballots the
 * leader would sit at exactly 50% one round earlier, which a counting engine
 * using `>=` instead of `>` would misread as a win.
 */
export interface TieBlockSizes {
  /** Ballots for each of the two candidates that finish level. */
  a: number;
  /** Ballots for each of the two candidates that tie for elimination. */
  m: number;
  /** Single-rank ballots that exhaust, absorbing parity. */
  g: number;
}

/**
 * Pick block sizes satisfying, for V voters:
 *   2a + 2m + g = V,  m ≥ 1,  g ≥ 1,  a > m,  g < a + m.
 *
 * `a > m` keeps A and B out of the elimination firing line; `g < a + m` means
 * the exhausting block is always eliminated before them, so the last two
 * standing really are A and B.
 */
export function solveTieBlocks(V: number): TieBlockSizes | null {
  for (let m = Math.max(1, Math.floor(V * 0.12)); m >= 1; m--) {
    for (const g of [m + 1, m, m + 2, 1, 2]) {
      if (g < 1) continue;
      const remainder = V - 2 * m - g;
      if (remainder < 2 || remainder % 2 !== 0) continue;
      const a = remainder / 2;
      if (a > m && g < a + m) return { a, m, g };
    }
  }
  return null;
}

function generateTieBallots(
  voters: readonly SeedUser[],
  submissionIds: readonly string[],
  rng: () => number,
): SeedBallot[] {
  const V = voters.length;
  if (V < MIN_TIE_VOTERS) {
    throw new Error(`preset "tie" needs at least ${MIN_TIE_VOTERS} voters, got ${V}`);
  }
  if (submissionIds.length < MIN_TIE_SUBMISSIONS) {
    throw new Error(
      `preset "tie" needs at least ${MIN_TIE_SUBMISSIONS} submissions, got ${submissionIds.length}`,
    );
  }

  const order = shuffle(submissionIds, rng);
  const A = at(order, 0);
  const B = at(order, 1);
  const C = at(order, 2);
  const D = at(order, 3);
  const G = at(order, 4);
  const filler = order.slice(5);

  // Solve for the block sizes. A and B must end up EXACTLY equal, so the pot
  // they split has to be even; parity is absorbed by the exhausting G block,
  // which by construction cannot affect the final two. The search walks the
  // intended tie size down until the arithmetic closes, so small voter counts
  // degrade to a smaller tie rather than to no tie.
  const sizes = solveTieBlocks(V);
  if (sizes === null) {
    throw new Error(
      `preset "tie": cannot build a balanced split for ${V} voters. Try --ballots=12 or more.`,
    );
  }
  const { a, m, g } = sizes;

  const pickFiller = (count: number, exclude: readonly string[]): string[] =>
    weightedSampleWithout(
      filler.filter((id) => !exclude.includes(id)),
      new Map(filler.map((id) => [id, 1])),
      count,
      rng,
    );

  const rankings: string[][] = [];
  // Lower preferences on the A/B blocks are inert — neither is ever eliminated —
  // so they exist purely to make the fixture look like real ballots.
  for (let i = 0; i < a; i++) rankings.push([A, C, ...pickFiller(2, [A, B, C, D, G])]);
  for (let i = 0; i < a; i++) rankings.push([B, D, ...pickFiller(2, [A, B, C, D, G])]);
  for (let i = 0; i < m; i++) rankings.push([C, A, ...pickFiller(1, [A, B, C, D, G])]);
  for (let i = 0; i < m; i++) rankings.push([D, B, ...pickFiller(1, [A, B, C, D, G])]);
  for (let i = 0; i < g; i++) rankings.push([G]);

  if (rankings.length !== V) {
    throw new Error(`preset "tie": built ${rankings.length} ballots for ${V} voters`);
  }

  const shuffledRankings = shuffle(rankings, rng);
  const ballots = voters.map((voter, i) => ({
    voterUid: voter.uid,
    ranking: at(shuffledRankings, i).slice(0, MAX_RANKS),
  }));

  // Defence in depth: a `tie` preset that quietly fails to tie is worse than no
  // preset at all, so verify before anyone can write it to Firestore.
  assertTieGuaranteed(ballots, submissionIds);
  return ballots;
}

export function generateBallots(
  preset: Preset,
  voters: readonly SeedUser[],
  submissionIds: readonly string[],
  rng: () => number,
): SeedBallot[] {
  if (voters.length === 0 || submissionIds.length === 0) return [];

  switch (preset) {
    case 'tie':
      return generateTieBallots(voters, submissionIds, rng);
    case 'landslide':
      return generateDistributedBallots(voters, submissionIds, rng, {
        frontRunnerShare: 0.62,
        lengths: [3, 4, 5, 5],
      });
    case 'exhausting':
      return generateDistributedBallots(voters, submissionIds, rng, {
        lengths: [4, 5],
        shortBallots: Math.round(voters.length * EXHAUSTING_SHORT_BALLOT_SHARE),
      });
    case 'normal':
      return generateDistributedBallots(voters, submissionIds, rng, {
        lengths: [2, 3, 3, 4, 4, 5, 5, 5],
      });
  }
}

// ---------------------------------------------------------------------------
// Independent IRV check
// ---------------------------------------------------------------------------

/**
 * A small, self-contained instant-runoff count used ONLY to verify fixtures.
 *
 * Deliberately NOT the production engine (which is a separate work item): a
 * fixture verified by the same code it is meant to test proves nothing. The
 * rules follow 01-SPEC §5 — strict majority of the non-exhausted vote wins,
 * otherwise the lowest tally is eliminated and ballots transfer to their next
 * surviving preference.
 */
export interface EliminationTie {
  round: number;
  candidates: string[];
  votes: number;
  remaining: number;
}

export interface IrvCheck {
  rounds: number;
  winner: string | null;
  /** Two survivors with identical tallies and no majority: an unbreakable tie. */
  finalTie: { candidates: string[]; votes: number } | null;
  /** Rounds where ≥2 live candidates shared the lowest non-zero tally. */
  eliminationTies: EliminationTie[];
  exhaustedAtEnd: number;
}

export function simulateIrv(
  ballots: readonly SeedBallot[],
  submissionIds: readonly string[],
): IrvCheck {
  const remaining = new Set(submissionIds);
  const eliminationTies: EliminationTie[] = [];
  let round = 0;
  let exhausted = 0;

  // Every round removes exactly one candidate, so this cannot spin forever.
  while (round < submissionIds.length + 2) {
    round++;

    const tally = new Map<string, number>();
    for (const id of remaining) tally.set(id, 0);
    exhausted = 0;
    for (const ballot of ballots) {
      const top = ballot.ranking.find((id) => remaining.has(id));
      if (top === undefined) exhausted++;
      else tally.set(top, (tally.get(top) ?? 0) + 1);
    }
    const active = ballots.length - exhausted;

    const live = [...remaining].sort();
    if (live.length <= 1) {
      return {
        rounds: round,
        winner: live[0] ?? null,
        finalTie: null,
        eliminationTies,
        exhaustedAtEnd: exhausted,
      };
    }

    let best = at(live, 0);
    for (const id of live) if ((tally.get(id) ?? 0) > (tally.get(best) ?? 0)) best = id;
    // Strictly more than half of the ACTIVE vote, per spec. `>=` would hand a
    // 50/50 split to whoever happened to be first.
    if (active > 0 && (tally.get(best) ?? 0) * 2 > active) {
      return { rounds: round, winner: best, finalTie: null, eliminationTies, exhaustedAtEnd: exhausted };
    }

    let low = Infinity;
    for (const id of live) low = Math.min(low, tally.get(id) ?? 0);
    const lowest = live.filter((id) => (tally.get(id) ?? 0) === low);

    if (live.length === 2 && lowest.length === 2 && low > 0) {
      return {
        rounds: round,
        winner: null,
        finalTie: { candidates: lowest, votes: low },
        eliminationTies,
        exhaustedAtEnd: exhausted,
      };
    }
    // Zero-vote entries tie trivially; only a shared NON-zero low is the case
    // the tie-break chain actually has to adjudicate.
    if (lowest.length > 1 && low > 0) {
      eliminationTies.push({ round, candidates: lowest, votes: low, remaining: live.length });
    }

    remaining.delete(at(lowest, 0));
  }

  throw new Error('simulateIrv: count did not terminate — fixture is malformed');
}

/**
 * Throws unless the ballot set produces BOTH ties the admin tooling needs:
 * a mid-count elimination tie (≥3 candidates still standing) and a final-round
 * tie between the last two. Called by the `tie` preset itself and by the tests.
 */
export function assertTieGuaranteed(
  ballots: readonly SeedBallot[],
  submissionIds: readonly string[],
): void {
  const result = simulateIrv(ballots, submissionIds);

  if (result.finalTie === null) {
    throw new Error(
      `assertTieGuaranteed: expected a final-round tie, got ` +
        `${result.winner === null ? 'no winner and no tie' : `a clear winner (${result.winner})`} ` +
        `after ${result.rounds} rounds.`,
    );
  }
  const midCount = result.eliminationTies.filter((t) => t.remaining > 2);
  if (midCount.length === 0) {
    throw new Error(
      'assertTieGuaranteed: final-round tie present, but no mid-count elimination tie — ' +
        'the elimination tie-break chain would never be exercised.',
    );
  }
}

// ---------------------------------------------------------------------------
// Placeholder logo artwork
// ---------------------------------------------------------------------------

/**
 * Real, distinguishable images matter more here than they look like they
 * should: a gallery of twenty identical grey squares makes it impossible to
 * tell whether ranking, aliasing and thumbnailing are wired up correctly.
 *
 * The artwork is painted as a small raster by hand — a coloured field, a
 * geometric mark and a big letter from a built-in 5×7 bitmap font — then
 * upscaled with a nearest-neighbour kernel by the caller. No SVG, no system
 * fonts, no network: the painter is a pure function of the entry index, so the
 * same entry always yields byte-identical pixels and re-seeding is idempotent.
 */
export interface RawImage {
  width: number;
  height: number;
  channels: 3;
  data: Uint8Array;
}

/** Logical canvas; the caller upscales by an integer factor. */
export const LOGO_TILE = 144;
/** Nearest-neighbour upscale factor → 1728×1728 originals. */
export const LOGO_SCALE = 12;
export const LOGO_ORIGINAL_SIZE = LOGO_TILE * LOGO_SCALE;

type Rgb = readonly [number, number, number];

const PALETTE: readonly { bg: Rgb; mark: Rgb; ink: Rgb }[] = [
  { bg: [18, 32, 64], mark: [92, 148, 255], ink: [244, 248, 255] },
  { bg: [244, 241, 232], mark: [214, 78, 54], ink: [34, 30, 28] },
  { bg: [20, 62, 58], mark: [126, 214, 168], ink: [246, 255, 250] },
  { bg: [58, 26, 74], mark: [212, 132, 255], ink: [252, 246, 255] },
  { bg: [250, 214, 76], mark: [32, 32, 34], ink: [32, 32, 34] },
  { bg: [30, 30, 32], mark: [255, 148, 60], ink: [255, 250, 244] },
  { bg: [226, 240, 248], mark: [26, 96, 148], ink: [12, 34, 52] },
  { bg: [96, 20, 38], mark: [244, 176, 140], ink: [255, 244, 238] },
  { bg: [10, 84, 96], mark: [250, 226, 128], ink: [250, 252, 252] },
  { bg: [238, 232, 244], mark: [102, 60, 200], ink: [26, 18, 56] },
  { bg: [44, 54, 26], mark: [186, 226, 92], ink: [248, 252, 236] },
  { bg: [252, 246, 240], mark: [16, 132, 118], ink: [18, 42, 40] },
];

const MOTIFS = ['disc', 'diamond', 'ring', 'bars', 'grid', 'chevron'] as const;

/** 5×7 bitmap font. Only A–Z; entries are labelled with a single letter. */
const FONT_5X7: Readonly<Record<string, string>> = {
  A: '01110/10001/10001/11111/10001/10001/10001',
  B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01110/10001/10000/10000/10000/10001/01110',
  D: '11110/10001/10001/10001/10001/10001/11110',
  E: '11111/10000/10000/11110/10000/10000/11111',
  F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01110/10001/10000/10111/10001/10001/01111',
  H: '10001/10001/10001/11111/10001/10001/10001',
  I: '11111/00100/00100/00100/00100/00100/11111',
  J: '00111/00010/00010/00010/00010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001',
  L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001',
  N: '10001/11001/10101/10011/10001/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110',
  P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10010/01101',
  R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110',
  T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110',
  V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/11011/10001',
  X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100',
  Z: '11111/00001/00010/00100/01000/10000/11111',
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function put(img: RawImage, x: number, y: number, c: Rgb): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 3;
  img.data[o] = c[0];
  img.data[o + 1] = c[1];
  img.data[o + 2] = c[2];
}

function rect(img: RawImage, x0: number, y0: number, w: number, h: number, c: Rgb): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(img, x, y, c);
}

function disc(img: RawImage, cx: number, cy: number, r: number, c: Rgb, inner = 0): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= r * r && d2 >= inner * inner) put(img, x, y, c);
    }
  }
}

function diamond(img: RawImage, cx: number, cy: number, r: number, c: Rgb): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= r) put(img, x, y, c);
    }
  }
}

function glyph(img: RawImage, letter: string, cx: number, cy: number, scale: number, c: Rgb): void {
  const rows = (FONT_5X7[letter] ?? FONT_5X7['A'] ?? '').split('/');
  const w = 5 * scale;
  const h = rows.length * scale;
  const x0 = cx - Math.floor(w / 2);
  const y0 = cy - Math.floor(h / 2);
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      if (row[rx] === '1') rect(img, x0 + rx * scale, y0 + ry * scale, scale, scale, c);
    }
  });
}

/**
 * Paint entry `index`. Deterministic in the index alone — no PRNG — so the
 * artwork for "the third entry" is stable no matter what else changes.
 */
export function renderLogoPixels(index: number): RawImage {
  const img: RawImage = {
    width: LOGO_TILE,
    height: LOGO_TILE,
    channels: 3,
    data: new Uint8Array(LOGO_TILE * LOGO_TILE * 3),
  };
  const theme = at(PALETTE, index % PALETTE.length);
  const motif = at(MOTIFS, index % MOTIFS.length);
  const c = Math.floor(LOGO_TILE / 2);

  rect(img, 0, 0, LOGO_TILE, LOGO_TILE, theme.bg);

  switch (motif) {
    case 'disc':
      disc(img, c, c, 56, theme.mark);
      break;
    case 'ring':
      disc(img, c, c, 60, theme.mark, 44);
      break;
    case 'diamond':
      diamond(img, c, c, 62, theme.mark);
      break;
    case 'bars':
      for (let i = 0; i < 3; i++) rect(img, 16, 28 + i * 34, LOGO_TILE - 32, 22, theme.mark);
      break;
    case 'grid':
      for (let gy = 0; gy < 4; gy++) {
        for (let gx = 0; gx < 4; gx++) {
          if ((gx + gy) % 2 === 0) rect(img, 12 + gx * 30, 12 + gy * 30, 26, 26, theme.mark);
        }
      }
      break;
    case 'chevron':
      for (let i = 0; i < LOGO_TILE; i++) {
        rect(img, Math.max(0, i - 10), i, 20, 1, theme.mark);
        rect(img, Math.max(0, LOGO_TILE - i - 10), i, 20, 1, theme.mark);
      }
      break;
  }

  // A quiet frame keeps the mark from bleeding into a white gallery background.
  rect(img, 0, 0, LOGO_TILE, 4, theme.ink);
  rect(img, 0, LOGO_TILE - 4, LOGO_TILE, 4, theme.ink);
  rect(img, 0, 0, 4, LOGO_TILE, theme.ink);
  rect(img, LOGO_TILE - 4, 0, 4, LOGO_TILE, theme.ink);

  // Solid plate behind the letter, then the letter knocked out of it in the
  // background colour. Without the plate the glyph turns to mud over the
  // busier motifs at thumbnail size; with it, every entry stays legible at
  // 640px and the plate is invisible where the motif is already solid.
  const glyphScale = 8;
  const plateW = 5 * glyphScale + 12;
  const plateH = 7 * glyphScale + 12;
  rect(img, c - Math.floor(plateW / 2), c - Math.floor(plateH / 2), plateW, plateH, theme.mark);
  glyph(img, at([...ALPHABET], index % ALPHABET.length), c, c, glyphScale, theme.bg);

  return img;
}
