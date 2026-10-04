/**
 * Unit tests for the pure validation helpers behind the submission routes.
 *
 * The author-name check is the one with two failure modes that hurt in
 * opposite directions:
 *   • a MISS de-anonymises an entrant permanently, in public;
 *   • a FALSE POSITIVE rejects an innocent title with an accusation the
 *     entrant cannot argue with, and they will simply stop trying.
 *
 * So the truth table below is deliberately lopsided toward the awkward
 * near-misses ("Samurai", "Sample", "Assam") rather than the easy cases.
 */

import { describe, expect, it } from 'vitest';
import { authorIdentityTokens, parseBooleanField, titleIdentifiesAuthor } from './submissions.js';
import { sniffMimeType } from '../services/images.js';

const NAME = 'Sam Rivera';
const EMAIL = 'sam.rivera@google.com';

const identifies = (title: string): boolean => titleIdentifiesAuthor(title, NAME, EMAIL);

// ---------------------------------------------------------------------------
// titleIdentifiesAuthor — must trip
// ---------------------------------------------------------------------------

describe('titleIdentifiesAuthor — catches the author', () => {
  const shouldTrip: Array<[string, string]> = [
    ['Sam', 'the bare first name'],
    ['sam', 'lower case'],
    ['SAM', 'upper case'],
    ["sam's logo", 'possessive apostrophe is a word boundary'],
    ['by_sam', 'underscore folded to a separator'],
    ['by-sam', 'hyphen folded to a separator'],
    ['by.sam', 'dot folded to a separator'],
    ['Logo by Sam Rivera', 'full name inside a sentence'],
    ['Rivera', 'the surname alone'],
    ['RIVERA MARK', 'surname, upper case'],
    ['sam.rivera', 'the email local part verbatim'],
    ['sam rivera', 'the folded local part'],
    ['A mark by SAM', 'trailing name'],
    ["rivera's crest", 'surname possessive'],
    ['The Sam Concept', 'name in the middle'],
    ['sam-rivera-final', 'hyphenated filename style'],
    ['Design (Sam)', 'parenthesised'],
    ['north 7 / rivera', 'slash separated'],
    ['Concept 3 — Sam', 'em dash separated'],
    ['   sam   ', 'surrounded by whitespace'],
  ];

  it.each(shouldTrip)('rejects %j — %s', (title) => {
    expect(identifies(title)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// titleIdentifiesAuthor — must NOT trip
// ---------------------------------------------------------------------------

describe('titleIdentifiesAuthor — does not cry wolf', () => {
  const shouldPass: Array<[string, string]> = [
    ['Samurai', 'name is a prefix of a longer word'],
    ['Samurai Crest', 'same, with context'],
    ['Sample Logo', '"sam" inside "sample"'],
    ['Samba Nights', '"sam" inside "samba"'],
    ['Assam Tea Mark', '"sam" inside "assam", mid-word'],
    ['Flotsam', '"sam" at the end of a word'],
    ['Riveras', 'surname with a trailing letter'],
    ['Riveradale Heights', 'surname as a prefix'],
    ['Riverbank Blue', 'shares a prefix but is not the name'],
    ['North 7 Bold', 'ordinary title'],
    ['Seven Peaks', 'ordinary title'],
    ['Crimson Tide', 'ordinary title'],
    ['Moguls in Motion', 'ordinary title'],
    ['The Media Mark', 'ordinary title'],
    ['', 'empty string'],
    ['   ', 'whitespace only'],
    ['A geometric monogram in two weights', 'a long, innocent description'],
  ];

  it.each(shouldPass)('accepts %j — %s', (title) => {
    expect(identifies(title)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Other identities
// ---------------------------------------------------------------------------

describe('titleIdentifiesAuthor — other identity shapes', () => {
  it('catches an email local part that is not a real name', () => {
    expect(titleIdentifiesAuthor('jsnow concept', 'Jon Snow', 'jsnow@google.com')).toBe(true);
    expect(titleIdentifiesAuthor('Winter Snow', 'Jon Snow', 'jsnow@google.com')).toBe(true);
    expect(titleIdentifiesAuthor('Snowdonia Peaks', 'Jon Snow', 'jsnow@google.com')).toBe(false);
  });

  it('catches a three-part display name on any of its words', () => {
    const name = 'Maria De Luca';
    const email = 'mdeluca@google.com';
    expect(titleIdentifiesAuthor('a mark for maria', name, email)).toBe(true);
    expect(titleIdentifiesAuthor('luca blue', name, email)).toBe(true);
    expect(titleIdentifiesAuthor('Lucas Bright', name, email)).toBe(false);
    expect(titleIdentifiesAuthor('Marigold', name, email)).toBe(false);
  });

  it('ignores tokens of two characters or fewer', () => {
    // Documented trade-off: a two-letter token matches far too much ordinary
    // English to be usable as a filter. "Al" would reject "Al Dente Type".
    expect(titleIdentifiesAuthor("Al's Big Idea", 'Al', 'al@google.com')).toBe(false);
    expect(authorIdentityTokens('Al', 'al@google.com')).toEqual([]);
    // The middle initial in "Jo X Smith" must not become a live token.
    expect(authorIdentityTokens('Jo X Smith', 'jo@google.com')).not.toContain('x');
  });

  it('handles a display name that is just the email local part', () => {
    expect(titleIdentifiesAuthor('srivera mark', 'srivera', 'srivera@google.com')).toBe(true);
    expect(titleIdentifiesAuthor('clean concept', 'srivera', 'srivera@google.com')).toBe(false);
  });

  it('treats regex metacharacters in an identity as literal text', () => {
    // '+' is a quantifier. Unescaped, the token "a+b" would compile to
    // "one-or-more a, then b" and match the innocent title "ab mark" — and,
    // worse, "aaab". It must match only a literal "a+b".
    const email = 'a+b@google.com';
    expect(titleIdentifiesAuthor('ab mark', 'Dana Quill', email)).toBe(false);
    expect(titleIdentifiesAuthor('aaab mark', 'Dana Quill', email)).toBe(false);
    expect(titleIdentifiesAuthor('a+b mark', 'Dana Quill', email)).toBe(true);
  });

  it('folds a dotted display name into a matchable phrase', () => {
    // "A.B" folds to the phrase "a b", which is a real identity token.
    expect(titleIdentifiesAuthor('the a b mark', 'A.B', 'ab@google.com')).toBe(true);
    expect(titleIdentifiesAuthor('axb concept', 'A.B', 'ab@google.com')).toBe(false);
  });

  it('does not mine a plus-addressing suffix for tokens', () => {
    // Only '.', '_' and '-' are separators. "tag" in "sam+tag" is mail
    // routing, not a name, and must not become a filter word.
    expect(authorIdentityTokens('Sam Rivera', 'sam.rivera+contest@google.com')).not.toContain('tag');
    expect(titleIdentifiesAuthor('a contest entry', 'Dana Quill', 'dana+contest@google.com')).toBe(false);
  });
});

describe('authorIdentityTokens', () => {
  it('derives whole and split forms of the name and the email local part', () => {
    const tokens = authorIdentityTokens(NAME, EMAIL);
    expect(tokens).toContain('sam');
    expect(tokens).toContain('rivera');
    expect(tokens).toContain('sam rivera');
  });

  it('never emits a token shorter than three characters', () => {
    for (const token of authorIdentityTokens('Bo Jo Li Ann', 'bo.jo@google.com')) {
      expect(token.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('drops the domain — a whole team shares it', () => {
    // "google" must never become an identity token, or every title mentioning
    // the company would be rejected for everyone.
    expect(authorIdentityTokens(NAME, EMAIL)).not.toContain('google.com');
    expect(authorIdentityTokens(NAME, EMAIL)).not.toContain('google');
    expect(titleIdentifiesAuthor('A Google-scale mark', NAME, EMAIL)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseBooleanField
// ---------------------------------------------------------------------------

describe('parseBooleanField', () => {
  it('treats the string "false" as false', () => {
    // The whole reason this function exists: z.coerce.boolean() is Boolean(x),
    // so "false" would coerce to TRUE and silently opt someone in to credit.
    expect(parseBooleanField('false')).toBe(false);
    expect(parseBooleanField('0')).toBe(false);
    expect(parseBooleanField('off')).toBe(false);
    expect(parseBooleanField('no')).toBe(false);
  });

  it('accepts the affirmative spellings a form might send', () => {
    expect(parseBooleanField('true')).toBe(true);
    expect(parseBooleanField('TRUE')).toBe(true);
    expect(parseBooleanField(' on ')).toBe(true);
    expect(parseBooleanField('1')).toBe(true);
    expect(parseBooleanField('yes')).toBe(true);
  });

  it('defaults to false when the field is absent or junk', () => {
    // Opting in to being publicly named must be an explicit act.
    expect(parseBooleanField(undefined)).toBe(false);
    expect(parseBooleanField('')).toBe(false);
    expect(parseBooleanField('maybe')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sniffMimeType — the upload allowlist decision
// ---------------------------------------------------------------------------

describe('sniffMimeType at the route boundary', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x20, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'latin1'),
    Buffer.alloc(32),
  ]);

  it('accepts the three allowlisted formats', () => {
    expect(sniffMimeType(png)).toBe('image/png');
    expect(sniffMimeType(jpeg)).toBe('image/jpeg');
    expect(sniffMimeType(webp)).toBe('image/webp');
  });

  it('names SVG so it can be refused explicitly', () => {
    // SVG is executable markup. It is excluded from ALLOWED_MIME_TYPES on
    // purpose, and the declared Content-Type must never be able to smuggle it in.
    expect(sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8'))).toBe('image/svg+xml');
    expect(sniffMimeType(Buffer.from('<?xml version="1.0"?><svg width="10"/>', 'utf8'))).toBe('image/svg+xml');
  });

  it('names other non-allowlisted binaries rather than guessing', () => {
    expect(sniffMimeType(Buffer.from('%PDF-1.4\n' + ' '.repeat(32), 'latin1'))).toBe('application/pdf');
    expect(sniffMimeType(Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(32)]))).toBe('image/bmp');
    expect(sniffMimeType(Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(32)]))).toBe('image/tiff');
  });

  it('returns null rather than a wrong guess', () => {
    expect(sniffMimeType(Buffer.from('just some prose, no magic bytes here', 'utf8'))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('a WebP-looking RIFF that is not WEBP is not accepted as one', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
      Buffer.alloc(32),
    ]);
    expect(sniffMimeType(wav)).toBeNull();
  });
});
