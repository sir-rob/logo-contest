import { describe, expect, it } from 'vitest';

import { MAX_RANKS, derivePhase, formatAlias, validateContestDates } from '@contest/shared';

import {
  EXHAUSTING_SHORT_BALLOT_SHARE,
  PRESETS,
  SEED_PHASES,
  assertTieGuaranteed,
  assignAliases,
  countShortBallots,
  generateBallots,
  generateContestDates,
  generateSubmissionContents,
  generateUsers,
  makeRng,
  renderLogoPixels,
  simulateIrv,
  titleCollidesWithIdentity,
  uuidFrom,
  type SeedBallot,
  type SeedPhase,
  type SeedUser,
} from './seed-data.js';

/** The phase each `--phase` value must derive to, per @contest/shared. */
const EXPECTED_PHASE: Record<SeedPhase, string> = {
  setup: 'SETUP',
  submissions: 'SUBMISSIONS_OPEN',
  voting: 'VOTING_OPEN',
  closed: 'CLOSED',
  results: 'RESULTS_PUBLISHED',
};

function fixture(users: number, seed = 'test-seed'): { users: SeedUser[]; ids: string[] } {
  const rng = makeRng(seed);
  const generated = generateUsers(users, rng);
  return { users: generated, ids: generated.map(() => uuidFrom(rng)) };
}

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng('abc');
    const b = makeRng('abc');
    const left = Array.from({ length: 32 }, () => a());
    const right = Array.from({ length: 32 }, () => b());
    expect(left).toEqual(right);
  });

  it('differs between seeds', () => {
    const a = Array.from({ length: 32 }, makeRng('abc'));
    const b = Array.from({ length: 32 }, makeRng('abd'));
    expect(a).not.toEqual(b);
  });

  it('stays inside [0, 1)', () => {
    const rng = makeRng('range');
    for (let i = 0; i < 5_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateContestDates', () => {
  // This is the test that actually protects the --phase flag: the seed sets
  // real dates and lets derivePhase do the rest, so the two must agree.
  for (const phase of SEED_PHASES) {
    it(`--phase=${phase} derives ${EXPECTED_PHASE[phase]}`, () => {
      const now = new Date('2026-05-04T12:00:00.000Z');
      const dates = generateContestDates(phase, now);
      expect(derivePhase({ ...dates, phaseOverride: null }, now)).toBe(EXPECTED_PHASE[phase]);
    });

    it(`--phase=${phase} produces coherent windows`, () => {
      const dates = generateContestDates(phase, new Date('2026-05-04T12:00:00.000Z'));
      expect(validateContestDates(dates)).toEqual([]);
    });
  }

  it('still derives the requested phase against a live clock', () => {
    for (const phase of SEED_PHASES) {
      const now = new Date();
      expect(derivePhase({ ...generateContestDates(phase, now), phaseOverride: null }, now)).toBe(
        EXPECTED_PHASE[phase],
      );
    }
  });
});

describe('generateUsers', () => {
  it('produces unique uids and @google.com addresses', () => {
    const { users } = fixture(25);
    expect(new Set(users.map((u) => u.uid)).size).toBe(25);
    expect(new Set(users.map((u) => u.email)).size).toBe(25);
    expect(users.every((u) => u.email.endsWith('@google.com'))).toBe(true);
    expect(users[0]?.role).toBe('admin');
    expect(users.slice(1).every((u) => u.role === 'member')).toBe(true);
  });

  it('is reproducible for a seed', () => {
    expect(generateUsers(10, makeRng('s'))).toEqual(generateUsers(10, makeRng('s')));
  });
});

describe('generateSubmissionContents', () => {
  it('never puts a seeded identity in a title', () => {
    const { users } = fixture(20);
    const contents = generateSubmissionContents(users, makeRng('content'));
    expect(contents).toHaveLength(20);
    for (const content of contents) {
      expect(titleCollidesWithIdentity(content.title, users)).toBe(false);
    }
  });

  it('varies titles, descriptions and credit opt-in', () => {
    const { users } = fixture(20);
    const contents = generateSubmissionContents(users, makeRng('content'));
    expect(new Set(contents.map((c) => c.title)).size).toBe(20);
    expect(new Set(contents.map((c) => c.description)).size).toBeGreaterThan(5);
    expect(new Set(contents.map((c) => c.creditOptIn)).size).toBe(2);
  });

  it('flags a title that contains a member name', () => {
    const { users } = fixture(5);
    const name = users[0]?.displayName.split(' ')[0] ?? '';
    expect(titleCollidesWithIdentity(`${name} Mark II`, users)).toBe(true);
  });
});

describe('assignAliases', () => {
  it('hands out one Entry NN per submission', () => {
    const { ids } = fixture(12);
    const aliases = assignAliases(ids, makeRng('alias'));
    expect(aliases.size).toBe(12);
    expect(new Set(aliases.values()).size).toBe(12);
    expect([...aliases.values()].sort()).toEqual(
      Array.from({ length: 12 }, (_u, i) => formatAlias(i + 1)).sort(),
    );
  });
});

describe('generateBallots', () => {
  for (const preset of PRESETS) {
    it(`${preset}: respects MAX_RANKS, no duplicate ranks, only real entries`, () => {
      const { users, ids } = fixture(20, `ballots-${preset}`);
      const voters = users.slice(0, 18);
      const ballots = generateBallots(preset, voters, ids, makeRng(`rng-${preset}`));

      expect(ballots).toHaveLength(18);
      const idSet = new Set(ids);
      for (const ballot of ballots) {
        expect(ballot.ranking.length).toBeGreaterThanOrEqual(1);
        expect(ballot.ranking.length).toBeLessThanOrEqual(MAX_RANKS);
        expect(new Set(ballot.ranking).size).toBe(ballot.ranking.length);
        for (const id of ballot.ranking) expect(idSet.has(id)).toBe(true);
      }
      expect(new Set(ballots.map((b) => b.voterUid)).size).toBe(18);
    });

    it(`${preset}: is reproducible for a seed`, () => {
      const { users, ids } = fixture(14, `repeat-${preset}`);
      const a = generateBallots(preset, users, ids, makeRng('x'));
      const b = generateBallots(preset, users, ids, makeRng('x'));
      expect(a).toEqual(b);
    });
  }

  it('caps rankings at the number of entries when the field is tiny', () => {
    const { users, ids } = fixture(3, 'tiny');
    const ballots = generateBallots('normal', users, ids.slice(0, 3), makeRng('tiny'));
    expect(Math.max(...ballots.map((b) => b.ranking.length))).toBeLessThanOrEqual(3);
  });

  it('landslide gives one entry a first-round majority', () => {
    const { users, ids } = fixture(20, 'landslide');
    const ballots = generateBallots('landslide', users, ids, makeRng('landslide'));
    const first = new Map<string, number>();
    for (const b of ballots) {
      const top = b.ranking[0] ?? '';
      first.set(top, (first.get(top) ?? 0) + 1);
    }
    const best = Math.max(...first.values());
    expect(best * 2).toBeGreaterThan(ballots.length);
    expect(simulateIrv(ballots, ids).rounds).toBe(1);
  });

  it('normal has no first-round majority and runs several rounds of transfers', () => {
    const { users, ids } = fixture(20, 'normal');
    const ballots = generateBallots('normal', users.slice(0, 18), ids, makeRng('normal'));
    const result = simulateIrv(ballots, ids);
    expect(result.rounds).toBeGreaterThan(3);
    expect(result.winner).not.toBeNull();
  });

  it('exhausting produces the expected share of short ballots', () => {
    for (const n of [12, 18, 25]) {
      const { users, ids } = fixture(n, `exhaust-${n}`);
      const ballots = generateBallots('exhausting', users, ids, makeRng(`exhaust-${n}`));
      const expected = Math.round(n * EXHAUSTING_SHORT_BALLOT_SHARE);
      expect(countShortBallots(ballots)).toBe(expected);
      // …and those short ballots really do drop out of the count.
      expect(simulateIrv(ballots, ids).exhaustedAtEnd).toBeGreaterThan(0);
    }
  });
});

describe('the tie preset', () => {
  // The point of the whole exercise: a fixture that ties every time, not most
  // of the time. Run it across voter counts and seeds rather than once.
  for (const voters of [8, 9, 10, 12, 15, 18, 20, 23, 25]) {
    it(`ties with ${voters} voters`, () => {
      const { users, ids } = fixture(Math.max(voters, 6), `tie-${voters}`);
      const ballots = generateBallots('tie', users.slice(0, voters), ids, makeRng(`tie-${voters}`));
      expect(() => assertTieGuaranteed(ballots, ids)).not.toThrow();

      const result = simulateIrv(ballots, ids);
      expect(result.winner).toBeNull();
      expect(result.finalTie?.candidates).toHaveLength(2);
      expect(result.eliminationTies.filter((t) => t.remaining > 2).length).toBeGreaterThan(0);
    });
  }

  it('ties regardless of the PRNG seed', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { users, ids } = fixture(17, seed);
      const ballots = generateBallots('tie', users.slice(0, 15), ids, makeRng(seed));
      expect(() => assertTieGuaranteed(ballots, ids)).not.toThrow();
    }
  });

  it('refuses rather than silently failing when there are too few voters', () => {
    const { users, ids } = fixture(10, 'too-few');
    expect(() => generateBallots('tie', users.slice(0, 4), ids, makeRng('too-few'))).toThrow(
      /at least 8 voters/,
    );
  });
});

describe('assertTieGuaranteed', () => {
  it('throws on a fixture with a clear winner', () => {
    const { users, ids } = fixture(20, 'not-tied');
    const ballots = generateBallots('landslide', users, ids, makeRng('not-tied'));
    expect(() => assertTieGuaranteed(ballots, ids)).toThrow(/final-round tie/);
  });

  it('throws on a hand-made two-candidate walkover', () => {
    const ids = ['alpha', 'beta'];
    const ballots: SeedBallot[] = [
      { voterUid: 'u1', ranking: ['alpha'] },
      { voterUid: 'u2', ranking: ['alpha'] },
      { voterUid: 'u3', ranking: ['beta'] },
    ];
    expect(() => assertTieGuaranteed(ballots, ids)).toThrow();
  });

  it('throws when the last two tie but nothing tied mid-count', () => {
    // 2 v 2 in a two-horse race: a final tie, but the elimination tie-break
    // chain never ran, so this is not the fixture the admin UI needs.
    const ids = ['alpha', 'beta'];
    const ballots: SeedBallot[] = [
      { voterUid: 'u1', ranking: ['alpha'] },
      { voterUid: 'u2', ranking: ['alpha'] },
      { voterUid: 'u3', ranking: ['beta'] },
      { voterUid: 'u4', ranking: ['beta'] },
    ];
    expect(() => assertTieGuaranteed(ballots, ids)).toThrow(/mid-count/);
  });
});

describe('simulateIrv', () => {
  it('declares a majority winner in the first round when one exists', () => {
    const ids = ['a', 'b', 'c'];
    const ballots: SeedBallot[] = [
      { voterUid: '1', ranking: ['a', 'b'] },
      { voterUid: '2', ranking: ['a', 'c'] },
      { voterUid: '3', ranking: ['b'] },
    ];
    const result = simulateIrv(ballots, ids);
    expect(result.winner).toBe('a');
    expect(result.rounds).toBe(1);
  });

  it('transfers votes from an eliminated candidate', () => {
    const ids = ['a', 'b', 'c'];
    const ballots: SeedBallot[] = [
      { voterUid: '1', ranking: ['a'] },
      { voterUid: '2', ranking: ['a'] },
      { voterUid: '3', ranking: ['b'] },
      { voterUid: '4', ranking: ['b'] },
      { voterUid: '5', ranking: ['c', 'b'] },
    ];
    const result = simulateIrv(ballots, ids);
    expect(result.winner).toBe('b');
    expect(result.rounds).toBeGreaterThan(1);
  });
});

describe('renderLogoPixels', () => {
  it('is deterministic per index', () => {
    expect(renderLogoPixels(3).data).toEqual(renderLogoPixels(3).data);
  });

  it('produces visibly different artwork for different entries', () => {
    const a = renderLogoPixels(0).data;
    const b = renderLogoPixels(1).data;
    let differing = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
    expect(differing / a.length).toBeGreaterThan(0.2);
  });

  it('fills the whole canvas', () => {
    const img = renderLogoPixels(7);
    expect(img.data).toHaveLength(img.width * img.height * 3);
    expect(img.data.some((v) => v !== 0)).toBe(true);
  });
});
