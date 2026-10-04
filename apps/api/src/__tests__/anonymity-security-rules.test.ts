/**
 * ADVERSARIAL SUITE — GUARANTEE E: the database and bucket are closed to clients.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 01-SPEC.md §6:
 *
 *   "The Firestore database and Cloud Storage bucket are locked to the server
 *    identity only — security rules deny all direct client access. The browser
 *    talks exclusively to the API. This means an anonymity bug has to be an
 *    API bug; it can't be a 'someone opened devtools and queried the DB' bug."
 *
 * That sentence is load-bearing for the ENTIRE suite. Every other test here
 * assumes the API is the only way in; if a collection is opened to clients,
 * the careful DTO projections stop being the anonymity boundary and become
 * decoration.
 *
 * This is a STATIC check on the rules text, and that is the right shape for
 * it: no emulator runs in CI, and the failure mode being defended against is
 * not a subtle rule-evaluation bug but the "let me just open this collection
 * for a minute" commit. A parser that fails on any `allow` whose condition is
 * not literally `false` catches that on the pull request.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Repo root, from this file at apps/api/src/__tests__/. */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const RULES_FILES = ['firestore.rules', 'storage.rules'] as const;

function loadRules(name: string): string {
  return readFileSync(`${repoRoot}${name}`, 'utf8');
}

/** Drop `//` and `/* *\/` comments so a commented-out rule is not parsed. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

interface AllowStatement {
  /** The operations granted, e.g. ['read', 'write']. */
  operations: string[];
  /** Everything after `if`, trimmed, without the trailing semicolon. */
  condition: string;
  raw: string;
}

/**
 * Every `allow ... : if ...;` statement in a rules file.
 *
 * A bare `allow read;` with no condition is also matched, because that form
 * grants access unconditionally and is the single most dangerous thing that
 * could appear in one of these files.
 */
function parseAllowStatements(source: string): AllowStatement[] {
  const out: AllowStatement[] = [];
  const pattern = /\ballow\s+([a-z,\s]+?)\s*(?::\s*if\s+([^;]+))?;/gi;
  for (const match of stripComments(source).matchAll(pattern)) {
    const [raw, ops, condition] = match;
    out.push({
      operations: (ops ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      condition: (condition ?? '').trim(),
      raw: raw.trim(),
    });
  }
  return out;
}

// ===========================================================================
// E15
// ===========================================================================

describe.each(RULES_FILES)('E15 — %s denies everything unconditionally', (filename) => {
  const source = loadRules(filename);
  const statements = parseAllowStatements(source);

  it('declares rules_version 2', () => {
    // Version 1 has materially different matching semantics; a silent
    // downgrade would change what `/{document=**}` covers.
    expect(source).toMatch(/rules_version\s*=\s*'2'/);
  });

  it('contains at least one allow statement, so the parser is not vacuous', () => {
    // Without this, deleting the whole file would make every test below pass.
    expect(statements.length).toBeGreaterThan(0);
  });

  it('EVERY allow statement grants nothing but `if false`', () => {
    for (const statement of statements) {
      expect(
        statement.condition,
        `"${statement.raw}" grants access on a condition other than false`,
      ).toBe('false');
    }
  });

  it('has no unconditional allow (an `allow read;` with no `if`)', () => {
    for (const statement of statements) {
      expect(statement.condition.length, `"${statement.raw}" has no condition at all`).toBeGreaterThan(0);
    }
  });

  it('grants nothing to any authenticated or request-derived condition', () => {
    // The realistic regressions: `if request.auth != null`, `if true`,
    // `if request.auth.uid == userId`. None may appear.
    const forbidden = [/request\s*\.\s*auth/i, /\btrue\b/i, /resource\s*\./i, /\bexists\s*\(/i, /\bget\s*\(/i];
    for (const statement of statements) {
      for (const pattern of forbidden) {
        expect(pattern.test(statement.condition), `"${statement.raw}" references ${String(pattern)}`).toBe(false);
      }
    }
  });

  it('covers the whole tree with a recursive wildcard', () => {
    // `allow ...: if false` on one collection is worthless if a sibling
    // collection is simply not matched.
    expect(source).toMatch(/match\s+\/\{[A-Za-z]+=\*\*\}/);
  });

  it('mentions no collection-specific exception', () => {
    // Any `match` other than the service-level root and the recursive
    // wildcard is a carve-out, and a carve-out is how this gets opened.
    //
    // Parsed line-wise: a rules path legitimately contains braces
    // (`/databases/{database}/documents`), so a regex that stops at the first
    // `{` truncates every path and compares garbage.
    const matches = [...stripComments(source).matchAll(/^[ \t]*match[ \t]+(\S+)[ \t]*\{[ \t]*$/gm)].map(
      (m) => m[1] ?? '',
    );
    expect(matches.length, 'no match blocks found — the parser is broken').toBeGreaterThan(0);

    const SERVICE_ROOTS = ['/databases/{database}/documents', '/b/{bucket}/o'];
    const carveOuts = matches.filter((path) => !SERVICE_ROOTS.includes(path) && !/=\*\*\}$/.test(path));
    expect(carveOuts, `unexpected match blocks: ${carveOuts.join(', ')}`).toEqual([]);
  });
});

describe('E15 — the parser itself detects an opened rule', () => {
  /**
   * A scanner that cannot fail is not a scanner. These feed the parser the
   * exact regressions it exists to catch and confirm it reports them — the
   * static check is only worth having if it would go red on the day somebody
   * "temporarily" opens a collection.
   */
  const OPENED = [
    ['a blanket true', "allow read, write: if true;"],
    ['any authenticated user', 'allow read: if request.auth != null;'],
    ['an owner check', 'allow read: if request.auth.uid == userId;'],
    ['an unconditional allow', 'allow read;'],
    ['a read-only carve-out', 'allow read: if request.auth.token.email_verified;'],
  ] as const;

  it.each(OPENED)('flags %s', (_label, snippet) => {
    const statements = parseAllowStatements(snippet);
    expect(statements.length).toBe(1);
    expect(statements[0]?.condition).not.toBe('false');
  });

  it('accepts the real, closed form', () => {
    const statements = parseAllowStatements('allow read, write: if false;');
    expect(statements[0]?.condition).toBe('false');
    expect(statements[0]?.operations).toEqual(['read', 'write']);
  });

  it('does not count a commented-out rule as a live one', () => {
    const statements = parseAllowStatements(`
      // allow read, write: if true;
      /* allow read: if request.auth != null; */
      allow read, write: if false;
    `);
    expect(statements.length).toBe(1);
    expect(statements[0]?.condition).toBe('false');
  });
});
