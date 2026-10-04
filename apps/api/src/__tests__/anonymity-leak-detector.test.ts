/**
 * SELF-TEST FOR THE LEAK DETECTOR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A privacy suite that passes against a broken app is worse than no suite at
 * all: it converts "nobody checked" into "somebody checked and it was fine".
 * Every assertion in the other anonymity files routes through
 * `assertNoIdentityLeak`, so that function is the single point of failure for
 * the entire suite. If it silently stopped detecting anything, all six
 * guarantee files would go green and stay green.
 *
 * These tests feed it the leaks it exists to catch and assert that it THROWS.
 * They are the permanent, always-on version of the one-off leak injections
 * used to validate the suite during development.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  assertNoIdentityLeak,
  assertNoIdentityLeakInText,
  findIdentityLeaks,
  collectKeys,
} from './support/identity-leak.js';

const CALLER = {
  uids: ['u-sam-1'],
  emails: ['sam.rivera@google.com'],
  displayNames: ['Sam Rivera'],
};

const FOREIGN = {
  uids: ['u-priya-2'],
  emails: ['priya.venkataraman@google.com'],
  displayNames: ['Priya Venkataraman'],
};

/** A clean public submission, exactly as `toPublicDto` builds one. */
const CLEAN_ENTRY = {
  id: 'sub-bravo',
  alias: 'Entry 01',
  thumbUrl: 'https://example.invalid/o/submissions%2Fnorth7%2Fuuid%2Fthumb.webp',
  displayUrl: 'https://example.invalid/o/submissions%2Fnorth7%2Fuuid%2Fdisplay.webp',
  width: 1024,
  height: 1024,
  isMine: false,
};

// ===========================================================================
// It does not cry wolf
// ===========================================================================

describe('the detector accepts genuinely clean payloads', () => {
  it('passes a clean gallery response', () => {
    expect(() =>
      assertNoIdentityLeak({ submissions: [CLEAN_ENTRY, { ...CLEAN_ENTRY, id: 'sub-alpha', isMine: true }] }, {
        ...CALLER,
        foreign: FOREIGN,
      }),
    ).not.toThrow();
  });

  it('passes aggregate counts under identity- and ballot-shaped keys', () => {
    // `eligibleVoters: 12` is a count, not a voter. Flagging it would make the
    // detector unusable and somebody would switch it off.
    expect(() =>
      assertNoIdentityLeak(
        { eligibleVoters: 12, ballotsCast: 9, totalBallots: 9, exhaustedBallots: 0, iHaveVoted: true },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).not.toThrow();
  });

  it('passes the caller\u2019s own identity when the path is allowlisted', () => {
    expect(() =>
      assertNoIdentityLeak(
        { uid: 'u-sam-1', email: 'sam.rivera@google.com', displayName: 'Sam Rivera', role: 'member' },
        { ...CALLER, keys: ['uid', 'email', 'displayName'], foreign: FOREIGN },
      ),
    ).not.toThrow();
  });
});

// ===========================================================================
// It catches what it claims to
// ===========================================================================

describe('the detector catches an identity-shaped KEY', () => {
  const LEAKY_KEYS: Array<[string, Record<string, unknown>]> = [
    ['ownerUid', { ...CLEAN_ENTRY, ownerUid: 'u-priya-2' }],
    ['ownerEmail', { ...CLEAN_ENTRY, ownerEmail: 'priya.venkataraman@google.com' }],
    ['ownerDisplayName', { ...CLEAN_ENTRY, ownerDisplayName: 'Priya Venkataraman' }],
    // The names nobody thought to ban — the whole reason the check is a
    // pattern rather than a list.
    ['uploadedBy', { ...CLEAN_ENTRY, uploaderId: 'u-priya-2' }],
    ['submittedBy', { ...CLEAN_ENTRY, submitterName: 'Priya Venkataraman' }],
    ['authorEmail', { ...CLEAN_ENTRY, authorEmail: 'priya.venkataraman@google.com' }],
    ['createdByUid', { ...CLEAN_ENTRY, createdByUid: 'u-priya-2' }],
    ['voterUid', { ...CLEAN_ENTRY, voterUid: 'u-priya-2' }],
  ];

  it.each(LEAKY_KEYS)('throws on a %s field', (_label, entry) => {
    expect(() => assertNoIdentityLeak({ submissions: [entry] }, { ...CALLER, foreign: FOREIGN })).toThrow(
      /IDENTITY LEAK/,
    );
  });

  it('throws even when the leak is nested several levels deep', () => {
    expect(() =>
      assertNoIdentityLeak(
        { results: { rounds: [{ detail: { meta: { ownerUid: 'u-priya-2' } } }] } },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).toThrow(/IDENTITY LEAK/);
  });
});

describe('the detector catches an identity smuggled under an INNOCENT key', () => {
  // This is the class of leak a name-based check cannot see at all.
  it('throws on an email inside a title', () => {
    expect(() =>
      assertNoIdentityLeak(
        { submissions: [{ ...CLEAN_ENTRY, title: 'draft by priya.venkataraman@google.com' }] },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).toThrow(/priya\.venkataraman@google\.com/);
  });

  it('throws on a uid inside a storage URL', () => {
    expect(() =>
      assertNoIdentityLeak(
        { submissions: [{ ...CLEAN_ENTRY, thumbUrl: 'https://x.invalid/u-priya-2/thumb.webp' }] },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).toThrow(/u-priya-2/);
  });

  it('throws on a uid hidden by percent-encoding', () => {
    // `encodeURIComponent` is not anonymisation, and a signed URL is full of
    // it. The scanner decodes before matching.
    expect(() =>
      assertNoIdentityLeak(
        { submissions: [{ ...CLEAN_ENTRY, displayUrl: 'https://x.invalid/o/logos%2Fu-priya-2%2Fdisplay.webp' }] },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).toThrow(/u-priya-2/);
  });

  it('throws on another member\u2019s display name in a description', () => {
    expect(() =>
      assertNoIdentityLeak(
        { submissions: [{ ...CLEAN_ENTRY, description: 'A mark for Priya Venkataraman' }] },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).toThrow(/Priya Venkataraman/);
  });

  it('throws on any email-shaped string, even an unknown address', () => {
    // Defence against a leak from a person not in the test cast at all.
    expect(() =>
      assertNoIdentityLeak(
        { submissions: [{ ...CLEAN_ENTRY, note: 'contact someone.else@google.com' }] },
        { ...CALLER, foreign: FOREIGN },
      ),
    ).toThrow(/someone\.else@google\.com/);
  });
});

describe('the detector distinguishes a ballot COUNT from ballot CONTENT', () => {
  it('throws on a ranking array', () => {
    expect(() =>
      assertNoIdentityLeak({ rows: [{ ranking: ['sub-a', 'sub-b'] }] }, { ...CALLER, foreign: FOREIGN }),
    ).toThrow(/ballot content/);
  });

  it('throws on a ballot object', () => {
    expect(() =>
      assertNoIdentityLeak({ ballot: { ranking: ['sub-a'] } }, { ...CALLER, foreign: FOREIGN }),
    ).toThrow(/ballot content/);
  });

  it('does not throw on a ballot count', () => {
    expect(() => assertNoIdentityLeak({ ballotsCast: 9 }, { ...CALLER, foreign: FOREIGN })).not.toThrow();
  });
});

describe('the detector works on non-JSON bodies', () => {
  it('throws on a CSV row carrying an email', () => {
    expect(() =>
      assertNoIdentityLeakInText('ballot_id,rank_1\r\nB001,priya.venkataraman@google.com\r\n', {
        ...CALLER,
        foreign: FOREIGN,
      }),
    ).toThrow(/IDENTITY LEAK/);
  });

  it('throws on a CSV row carrying a uid', () => {
    expect(() =>
      assertNoIdentityLeakInText('ballot_id,rank_1\r\nnorth7_u-priya-2,Entry 01\r\n', {
        ...CALLER,
        foreign: FOREIGN,
      }),
    ).toThrow(/u-priya-2/);
  });

  it('passes a properly anonymised CSV', () => {
    expect(() =>
      assertNoIdentityLeakInText('ballot_id,rank_1,rank_2\r\nB001,Entry 03,Entry 01\r\nB002,Entry 02,\r\n', {
        ...CALLER,
        foreign: FOREIGN,
      }),
    ).not.toThrow();
  });
});

describe('detector mechanics', () => {
  it('reports every finding, not just the first', () => {
    const leaks = findIdentityLeaks(
      { submissions: [{ ownerUid: 'u-priya-2', ownerEmail: 'priya.venkataraman@google.com' }] },
      { ...CALLER, foreign: FOREIGN },
    );
    expect(leaks.length).toBeGreaterThanOrEqual(3);
  });

  it('names the path of each finding, so a failure is actionable', () => {
    const leaks = findIdentityLeaks({ a: { b: [{ ownerUid: 'x' }] } }, CALLER);
    expect(leaks[0]?.path).toBe('a.b[0].ownerUid');
  });

  it('normalises array indices when matching the allowlist', () => {
    expect(() =>
      assertNoIdentityLeak({ rows: [{ email: 'sam.rivera@google.com' }, { email: 'sam.rivera@google.com' }] }, {
        ...CALLER,
        keys: ['rows[].email'],
      }),
    ).not.toThrow();
  });

  it('collectKeys walks the whole tree', () => {
    expect([...collectKeys({ a: 1, b: { c: [{ d: 2 }] } })].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('an empty allowlist is the default, so a new route starts at zero tolerance', () => {
    expect(() => assertNoIdentityLeak({ ownerUid: 'anything' })).toThrow(/IDENTITY LEAK/);
  });
});
