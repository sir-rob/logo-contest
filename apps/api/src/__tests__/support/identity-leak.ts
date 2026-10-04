/**
 * The identity-leak scanner.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE SINGLE HIGHEST-VALUE THING IN THE ANONYMITY SUITE.
 *
 * Hand-written assertions (`expect(dto.ownerUid).toBeUndefined()`) protect
 * exactly the field names somebody thought of on the day. The leak that
 * actually happens is the one nobody named: a `submittedBy` added next
 * quarter, a `User` entity spread into a DTO, an uploader's address
 * accidentally interpolated into a storage path, a debug field on an error
 * body. None of those trip a named assertion.
 *
 * So this scanner works from the other direction. It walks the SERIALISED
 * response and fails on:
 *
 *   1. ANY key whose name smells of authorship — /owner|uploader|author|
 *      email|uid|voter|submitter|creator|actor|ballot|ranking/i — unless the
 *      exact path is on an explicit allowlist;
 *   2. ANY string value anywhere that contains another person's uid, email
 *      address or display name, whatever key it hides under;
 *   3. ANY email-shaped string at all that is not the caller's own.
 *
 * Rule 2 is what catches the smuggled leak: `thumbUrl` is a perfectly
 * innocent key, and a signed URL containing `.../sam.rivera@google.com/...`
 * is a total de-anonymisation. Rule 1 alone would wave it through.
 *
 * The allowlist is deliberately PATH-based and not name-based. `/api/me`
 * legitimately returns the caller's own `uid` and `email`; that permission is
 * granted to `me.uid`, not to "any key called uid anywhere in the tree".
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Key names that must never appear in a member-facing payload.
 *
 * `name` alone is NOT here: `displayName` is caught by the explicit alternate
 * below, while a bare `name` is common on innocent things (a phase name, a
 * file name) and would generate noise without catching anything rule 2 does
 * not already catch by value.
 */
export const IDENTITY_KEY_PATTERN =
  /(owner|uploader|author|submitter|creator|voter|actor|email|uid|displayname)/i;

/**
 * Keys that name ballot CONTENT.
 *
 * Handled separately from the identity keys because the distinction the spec
 * draws is between a COUNT and a CONTENT: "the admin dashboard shows who has
 * voted ... but never what they voted". `ballotsCast: 12`, `totalBallots: 6`
 * and `exhaustedBallots: 0` are aggregate counts and are explicitly part of
 * the design; `ranking: ["sub-a", "sub-b"]` is a vote. So a ballot-shaped key
 * is a finding only when its value is STRUCTURED — an array, an object or a
 * string. A number or a boolean under such a key is a tally, not a ballot.
 */
export const BALLOT_KEY_PATTERN = /(ballot|ranking|vote[sd]?for|preference)/i;

/** Anything that looks like an email address, however it is embedded. */
const EMAIL_SHAPED = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export interface AllowedIdentity {
  /**
   * uids that may legitimately appear — in practice only ever the CALLER's
   * own, on `/api/me`.
   */
  uids?: readonly string[];
  emails?: readonly string[];
  displayNames?: readonly string[];
  /**
   * Dotted paths at which an identity-shaped KEY is expected, e.g.
   * `'uid'`, `'email'` for `/api/me`, or `'rows[].email'` for the admin
   * turnout roster. Array indices are normalised to `[]`.
   */
  keys?: readonly string[];
}

/** Identities belonging to OTHER people. Any appearance of these is a leak. */
export interface ForeignIdentities {
  uids?: readonly string[];
  emails?: readonly string[];
  displayNames?: readonly string[];
}

export interface LeakScanOptions extends AllowedIdentity {
  /** Where this payload came from; used only to make failures readable. */
  context?: string;
  /** Identities that must NOT appear. Usually every non-caller in the test. */
  foreign?: ForeignIdentities;
}

export interface Leak {
  path: string;
  reason: string;
  sample: string;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const truncate = (value: string): string => (value.length > 120 ? `${value.slice(0, 117)}...` : value);

/** Collapse `rows[3].email` to `rows[].email` so allowlists stay short. */
const normalisePath = (path: string): string => path.replace(/\[\d+\]/g, '[]');

/**
 * Find every identity leak in a payload. Returns them all rather than
 * throwing on the first, because "which fields leak" is the useful answer
 * when a projection regresses.
 */
export function findIdentityLeaks(payload: unknown, options: LeakScanOptions = {}): Leak[] {
  const allowedKeys = new Set((options.keys ?? []).map(normalisePath));
  const allowedUids = new Set(options.uids ?? []);
  const allowedEmails = new Set((options.emails ?? []).map((e) => e.toLowerCase()));
  const allowedNames = new Set((options.displayNames ?? []).map((n) => n.toLowerCase()));

  const foreignUids = (options.foreign?.uids ?? []).filter((u) => !allowedUids.has(u));
  const foreignEmails = (options.foreign?.emails ?? []).filter((e) => !allowedEmails.has(e.toLowerCase()));
  const foreignNames = (options.foreign?.displayNames ?? []).filter((n) => !allowedNames.has(n.toLowerCase()));

  const leaks: Leak[] = [];

  const visit = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return;

    if (typeof node === 'string') {
      checkString(node, path);
      return;
    }
    if (typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path.length === 0 ? key : `${path}.${key}`;

      const allowedHere = allowedKeys.has(normalisePath(childPath));

      /**
       * A scalar number/boolean/null under an identity- or ballot-shaped key
       * is an AGGREGATE, not an identity: `eligibleVoters: 12`,
       * `ballotsCast: 6`, `iHaveVoted: false`, `totalBallots: 6`. Those are
       * explicitly part of the design (spec §6: the admin dashboard shows who
       * has voted, and §7's dashboard is all counts). Identities and ballots
       * are strings, arrays and objects, and those are what get flagged.
       */
      const isAggregate = typeof value === 'number' || typeof value === 'boolean' || value === null;

      // ── Rule 1: the key itself names an identity concept. ──────────────
      if (IDENTITY_KEY_PATTERN.test(key) && !isAggregate && !allowedHere) {
        leaks.push({
          path: childPath,
          reason: `key "${key}" names an identity concept and is not on the allowlist`,
          sample: truncate(JSON.stringify(value) ?? String(value)),
        });
      }

      // ── Rule 1b: a ballot-shaped key carrying STRUCTURE, not a count. ───
      if (BALLOT_KEY_PATTERN.test(key) && !isAggregate && !allowedHere) {
        leaks.push({
          path: childPath,
          reason: `key "${key}" carries ballot content (a count would be a number; this is ${
            Array.isArray(value) ? 'an array' : typeof value
          })`,
          sample: truncate(JSON.stringify(value) ?? String(value)),
        });
      }

      visit(value, childPath);
    }
  };

  const checkString = (value: string, path: string): void => {
    // ── Rule 3: an email address, anywhere, under any key. ───────────────
    for (const match of value.match(EMAIL_SHAPED) ?? []) {
      if (allowedEmails.has(match.toLowerCase())) continue;
      leaks.push({ path, reason: `contains the email address ${match}`, sample: truncate(value) });
    }

    // ── Rule 2: another person's uid or display name, under any key. ─────
    // URL-decoded too: a path segment survives `encodeURIComponent` intact
    // as far as a human reader is concerned, so it must not survive the scan.
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      /* not percent-encoded; the raw value is checked either way */
    }
    const haystacks = decoded === value ? [value] : [value, decoded];

    for (const uid of foreignUids) {
      if (haystacks.some((h) => h.includes(uid))) {
        leaks.push({ path, reason: `contains another member's uid ${uid}`, sample: truncate(value) });
      }
    }
    for (const email of foreignEmails) {
      if (haystacks.some((h) => h.toLowerCase().includes(email.toLowerCase()))) {
        leaks.push({ path, reason: `contains another member's email ${email}`, sample: truncate(value) });
      }
    }
    for (const name of foreignNames) {
      if (haystacks.some((h) => h.toLowerCase().includes(name.toLowerCase()))) {
        leaks.push({ path, reason: `contains another member's display name "${name}"`, sample: truncate(value) });
      }
    }
  };

  visit(payload, '');
  return leaks;
}

/**
 * Throw unless the payload is free of identity leaks.
 *
 * Deliberately a plain `throw` rather than an `expect` so it can be used both
 * as an assertion AND as the subject of a `expect(...).toThrow()` in the
 * self-test that proves the scanner actually detects what it claims to.
 */
export function assertNoIdentityLeak(payload: unknown, options: LeakScanOptions = {}): void {
  const leaks = findIdentityLeaks(payload, options);
  if (leaks.length === 0) return;
  const where = options.context ?? 'response';
  const detail = leaks.map((leak) => `  • ${leak.path || '<root>'}: ${leak.reason}\n      value: ${leak.sample}`);
  throw new Error(
    `IDENTITY LEAK in ${where} — ${leaks.length} finding(s):\n${detail.join('\n')}\n\n` +
      `Full payload:\n${truncate(JSON.stringify(payload) ?? 'undefined')}`,
  );
}

/**
 * Same scan, applied to a non-JSON body (a CSV export, a log line, a raw
 * buffer decoded as text). Only the value rules apply — there are no keys.
 */
export function assertNoIdentityLeakInText(text: string, options: LeakScanOptions = {}): void {
  assertNoIdentityLeak({ body: text }, { ...options, keys: [...(options.keys ?? []), 'body'] });
}

/** Every key name present anywhere in a payload — handy for diagnostics. */
export function collectKeys(payload: unknown, into: Set<string> = new Set()): Set<string> {
  if (payload === null || typeof payload !== 'object') return into;
  if (Array.isArray(payload)) {
    for (const item of payload) collectKeys(item, into);
    return into;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    into.add(key);
    collectKeys(value, into);
  }
  return into;
}
