/**
 * ADVERSARIAL SUITE — GUARANTEE C: authorisation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Anonymity here is protected by exactly four gates (plugins/auth.ts):
 *
 *   1. a Bearer ID token firebase-admin can verify;
 *   2. `email_verified === true`;
 *   3. the FULL-domain allowlist;
 *   4. the Firestore role, for admin routes.
 *
 * Every one of them is a single `if`. The tests below attack each in the ways
 * that actually get past a hand-rolled check: the near-miss domains
 * (`notgoogle.com`, `google.com.evil.com`, `sub.google.com`), a token that is
 * valid but unverified, a token with no email at all, and an admin route whose
 * guard somebody forgot.
 *
 * C8 is enumerated from the router rather than hand-listed, so an admin route
 * added later is refused-a-member-token by default, not by remembering.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../firebase.js', async () => (await import('./support/firebase-mock.js')).firebaseModule);

import type { FastifyInstance } from 'fastify';
import { MAGIC_LINK_IP_RATE_LIMIT, MAGIC_LINK_RATE_LIMIT } from '@contest/shared';
import { ENTRY_DEVON, seedCast, type Cast } from './support/cast.js';
import { EXPIRED_TOKEN, INVALID_TOKEN, REVOKED_TOKEN } from './support/firebase-mock.js';
import {
  buildTestApp,
  call,
  errorCode,
  registeredRoutes,
  resetTestState,
  seedContest,
  setupTestEnv,
  tokenFor,
  type RegisteredRoute,
} from './support/harness.js';

let app: FastifyInstance;
let cast: Cast;

/** Routes that are anonymous on purpose, and the liveness probes. */
const PUBLIC_ROUTES = new Set(['/healthz', '/readyz', '/api/auth/magic-link']);

/** A concrete URL for a parameterised route, so it can actually be called. */
function concreteUrl(route: RegisteredRoute): string {
  return route.url.replace(':id', ENTRY_DEVON).replace(':uid', 'u-someone');
}

/** A plausible body, so a route fails on AUTH and not on validation. */
function bodyFor(route: RegisteredRoute): unknown {
  if (route.url.endsWith('/role')) return { role: 'member' };
  if (route.url.endsWith('/disqualify')) return { reason: 'test' };
  if (route.url.endsWith('/phase')) return { phase: null };
  if (route.url.endsWith('/resolve-tie')) return { tiedCandidates: ['a', 'b'], eliminate: 'a' };
  if (route.url === '/api/admin/contest') return { title: 'Renamed' };
  if (route.url === '/api/ballot') return { ranking: [ENTRY_DEVON] };
  if (route.url === '/api/me') return { displayName: 'Someone' };
  return {};
}

beforeEach(async () => {
  setupTestEnv();
  resetTestState();
  seedContest();
  cast = seedCast();
  app = await buildTestApp();
});

// ===========================================================================
// C8 — every /api/admin/** route refuses a valid non-admin token
// ===========================================================================

describe('C8 — admin routes refuse a valid member token', () => {
  function adminRoutes(): RegisteredRoute[] {
    return registeredRoutes(app).filter((r) => r.url.startsWith('/api/admin') && r.method !== 'HEAD');
  }

  it('the enumeration finds the admin routes we know exist', () => {
    const urls = new Set(adminRoutes().map((r) => r.url));
    // A sanity anchor. If `registeredRoutes` ever stops reconstructing nested
    // paths, this fails loudly instead of the sweep below silently shrinking.
    for (const expected of [
      '/api/admin/users',
      '/api/admin/users/:uid/role',
      '/api/admin/contest',
      '/api/admin/contest/phase',
      '/api/admin/submissions',
      '/api/admin/submissions/:id/disqualify',
      '/api/admin/submissions/:id/reinstate',
      '/api/admin/turnout',
      '/api/admin/audit',
      '/api/admin/results/compute',
      '/api/admin/results/publish',
      '/api/admin/results/unpublish',
      '/api/admin/results/resolve-tie',
      '/api/admin/export/ballots.csv',
    ]) {
      expect(urls.has(expected), `route ${expected} was not enumerated`).toBe(true);
    }
    expect(adminRoutes().length).toBeGreaterThanOrEqual(14);
  });

  it('EVERY enumerated admin route answers a member with ADMIN_REQUIRED', async () => {
    for (const route of adminRoutes()) {
      const res = await call(app, {
        method: route.method as 'GET',
        url: concreteUrl(route),
        token: cast.sam.token,
        payload: route.method === 'GET' ? undefined : bodyFor(route),
      });

      expect(res.status, `${route.method} ${route.url} let a member in (${res.status})`).toBe(403);
      expect(errorCode(res), `${route.method} ${route.url}`).toBe('ADMIN_REQUIRED');
    }
  });

  it('the refusal happens BEFORE any work, so nothing leaks in the error body', async () => {
    for (const route of adminRoutes()) {
      const res = await call(app, {
        method: route.method as 'GET',
        url: concreteUrl(route),
        token: cast.sam.token,
        payload: route.method === 'GET' ? undefined : bodyFor(route),
      });
      for (const person of [cast.priya, cast.devon, cast.mo]) {
        expect(res.raw, `${route.url} named ${person.email}`).not.toContain(person.email);
        expect(res.raw, `${route.url} named ${person.uid}`).not.toContain(person.uid);
      }
    }
  });

  it('a member cannot promote themselves', async () => {
    const res = await call(app, {
      method: 'POST',
      url: `/api/admin/users/${cast.sam.uid}/role`,
      token: cast.sam.token,
      payload: { role: 'admin' },
    });
    expect(errorCode(res)).toBe('ADMIN_REQUIRED');

    // And the attempt did not quietly take effect.
    const me = await call(app, { url: '/api/me', token: cast.sam.token });
    expect((me.json as { role: string }).role).toBe('member');
  });

  it('an `admin: true` custom claim does NOT override the Firestore role', async () => {
    // The claim is mirrored FROM Firestore, never the other way round. A token
    // minted with the claim set — which is what a stale or forged token would
    // look like — must still be refused, because the role in the database is
    // authoritative.
    const liar = tokenFor({
      uid: cast.sam.uid,
      email: cast.sam.email,
      email_verified: true,
      name: cast.sam.displayName,
      admin: true,
    });
    const res = await call(app, { url: '/api/admin/submissions', token: liar });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('ADMIN_REQUIRED');
  });

  it('an admin token IS accepted — so the test above is refusing for the right reason', async () => {
    const res = await call(app, { url: '/api/admin/submissions', token: cast.mo.token });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// C9 — every authenticated route refuses a missing/invalid/expired token
// ===========================================================================

describe('C9 — authenticated routes refuse a bad token', () => {
  function guardedRoutes(): RegisteredRoute[] {
    return registeredRoutes(app).filter((r) => !PUBLIC_ROUTES.has(r.url) && r.method !== 'HEAD');
  }

  const BAD_TOKENS: Array<[string, string | null, string]> = [
    ['no Authorization header', null, 'AUTH_REQUIRED'],
    ['a token firebase-admin cannot decode', INVALID_TOKEN, 'AUTH_INVALID_TOKEN'],
    ['an expired token', EXPIRED_TOKEN, 'AUTH_LINK_EXPIRED'],
    ['a revoked token', REVOKED_TOKEN, 'AUTH_INVALID_TOKEN'],
  ];

  it.each(BAD_TOKENS)('every guarded route rejects %s', async (_label, token, expectedCode) => {
    const routes = guardedRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(15);

    for (const route of routes) {
      const res = await call(app, {
        method: route.method as 'GET',
        url: concreteUrl(route),
        token,
        payload: route.method === 'GET' ? undefined : bodyFor(route),
      });
      expect(res.status, `${route.method} ${route.url} answered ${res.status}`).toBe(401);
      expect(errorCode(res), `${route.method} ${route.url}`).toBe(expectedCode);
    }
  });

  it('a malformed Authorization header is not a bearer token', async () => {
    for (const header of ['', 'Basic abc', 'Bearer', 'Bearer    ', 'Token abc', cast.sam.token]) {
      const res = await call(app, { url: '/api/me', headers: { authorization: header } });
      expect(res.status, `header ${JSON.stringify(header)}`).toBe(401);
    }
  });

  it('`Bearer` is matched case-insensitively, as RFC 6750 requires', async () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      const res = await call(app, {
        url: '/api/me',
        headers: { authorization: `${scheme} ${cast.sam.token}` },
      });
      expect(res.status, `scheme ${scheme}`).toBe(200);
    }
  });

  it('the only anonymous route is the magic-link request', async () => {
    const anonymouslyReachable: string[] = [];
    for (const route of registeredRoutes(app).filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS')) {
      const res = await call(app, {
        method: route.method as 'GET',
        url: concreteUrl(route),
        payload: route.method === 'GET' ? undefined : bodyFor(route),
      });
      if (res.status !== 401) anonymouslyReachable.push(`${route.method} ${route.url}`);
    }
    expect(anonymouslyReachable.sort()).toEqual(['GET /healthz', 'GET /readyz', 'POST /api/auth/magic-link']);
  });
});

// ===========================================================================
// C10 — the domain allowlist, including the near-misses
// ===========================================================================

describe('C10 — the domain gate, and the near-misses that beat a naive check', () => {
  /** Try an address at both the API front door and a guarded route. */
  async function attempt(email: string | undefined): Promise<{ token: number; magic: number; tokenCode: string | null; magicCode: string | null }> {
    const token = tokenFor({ uid: `u-${String(email)}`, email, email_verified: true, name: 'Someone' });
    const withToken = await call(app, { url: '/api/me', token });
    const magicLink =
      email === undefined
        ? { status: 400, raw: '', json: undefined, headers: {} }
        : await call(app, {
            method: 'POST',
            url: '/api/auth/magic-link',
            payload: { email },
            // A distinct IP per attempt, so the per-IP limiter does not turn a
            // domain test into a rate-limit test.
            headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
          });
    return {
      token: withToken.status,
      magic: magicLink.status,
      tokenCode: errorCode(withToken),
      magicCode: errorCode(magicLink),
    };
  }

  it('accepts the allowed domain', async () => {
    const result = await attempt('newcomer@google.com');
    expect(result.token).toBe(200);
    expect(result.magic).toBe(200);
  });

  it('accepts GOOGLE.COM — the domain match is case-insensitive', async () => {
    // An address is case-insensitive in its domain part, and treating
    // `Someone@GOOGLE.COM` as a stranger would lock out a real colleague
    // whose mail client happened to capitalise.
    const result = await attempt('Someone@GOOGLE.COM');
    expect(result.token, 'GOOGLE.COM must be accepted').toBe(200);
    expect(result.magic, 'GOOGLE.COM must be accepted at the front door too').toBe(200);
  });

  it('rejects notgoogle.com — a suffix match would wave this through', async () => {
    const result = await attempt('attacker@notgoogle.com');
    expect(result.tokenCode).toBe('AUTH_DOMAIN_NOT_ALLOWED');
    expect(result.magicCode).toBe('AUTH_DOMAIN_NOT_ALLOWED');
  });

  it('rejects google.com.evil.com — a substring match would wave this through', async () => {
    const result = await attempt('attacker@google.com.evil.com');
    expect(result.tokenCode).toBe('AUTH_DOMAIN_NOT_ALLOWED');
    expect(result.magicCode).toBe('AUTH_DOMAIN_NOT_ALLOWED');
  });

  it('rejects sub.google.com — a subdomain is a different domain', async () => {
    const result = await attempt('contractor@sub.google.com');
    expect(result.tokenCode).toBe('AUTH_DOMAIN_NOT_ALLOWED');
    expect(result.magicCode).toBe('AUTH_DOMAIN_NOT_ALLOWED');
  });

  it.each([
    ['an embedded at-sign', 'someone@evil.com@google.com'],
    ['a leading dot', 'someone@.google.com'],
    ['whitespace inside the address', 'some one@google.com'],
    ['a lookalike unicode domain', 'someone@go\u0585gle.com'],
    ['an empty domain', 'someone@'],
    ['a bare local part', 'someone'],
    ['a domain-only string', '@google.com'],
  ])('rejects %s', async (label, email) => {
    const result = await attempt(email);
    expect(result.token, `${label} was accepted`).not.toBe(200);
  });

  it('normalises the fully-qualified trailing dot rather than admitting a stranger', async () => {
    // `google.com.` is the FQDN spelling of `google.com`, so the domain gate
    // treats them as the same domain (it strips the dot on purpose). The
    // request still does not succeed — `MeSchema` validates the stored address
    // and rejects the odd spelling — but crucially it is NOT a sign-in as some
    // other domain.
    const result = await attempt('someone@google.com.');
    expect(result.tokenCode).not.toBe('AUTH_DOMAIN_NOT_ALLOWED');
    expect(result.token).not.toBe(200);
  });

  it('rejects a token with no email at all', async () => {
    const result = await attempt(undefined);
    // A tokenless identity fails at the email gate, one step before the domain
    // gate — there is no address to compare. `AUTH_EMAIL_UNVERIFIED` is a 403.
    expect(result.token).toBe(403);
    expect(result.tokenCode).toBe('AUTH_EMAIL_UNVERIFIED');
  });

  it('rejects an empty-string email', async () => {
    const token = tokenFor({ uid: 'u-empty', email: '', email_verified: true });
    const res = await call(app, { url: '/api/me', token });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('AUTH_EMAIL_UNVERIFIED');
  });

  it('rejects a whitespace-only email', async () => {
    const token = tokenFor({ uid: 'u-blank', email: '   ', email_verified: true });
    const res = await call(app, { url: '/api/me', token });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('AUTH_EMAIL_UNVERIFIED');
  });

  it('an off-domain caller creates no user record on the way out', async () => {
    await attempt('attacker@notgoogle.com');
    // If the domain check ran AFTER `loadOrCreateUser`, a stranger would
    // appear in the admin roster and the turnout list.
    const roster = await call(app, { url: '/api/admin/users', token: cast.mo.token });
    expect(roster.raw).not.toContain('notgoogle.com');
  });

  it('the domain gate runs on EVERY request, not only at sign-in', async () => {
    // A token minted before the allowlist tightened must stop working at once.
    const stranger = tokenFor({ uid: 'u-stranger', email: 'x@elsewhere.com', email_verified: true });
    for (const url of ['/api/me', '/api/submissions', '/api/contest', '/api/ballot', '/api/dashboard']) {
      const res = await call(app, { url, token: stranger });
      expect(errorCode(res), url).toBe('AUTH_DOMAIN_NOT_ALLOWED');
    }
  });
});

// ===========================================================================
// C11 — email_verified
// ===========================================================================

describe('C11 — an unverified address is refused even on the allowed domain', () => {
  it.each([
    ['false', false],
    ['absent', undefined],
    ['the string "true"', 'true' as unknown as boolean],
    ['the number 1', 1 as unknown as boolean],
  ])('email_verified = %s is refused', async (_label, value) => {
    // The strict `!== true` comparison matters: a truthy-but-not-true claim
    // ("true", 1) is exactly what a hand-rolled token forger produces, and
    // `if (!decoded.email_verified)` would let both through.
    const token = tokenFor({
      uid: 'u-unverified',
      email: 'unverified@google.com',
      ...(value === undefined ? {} : { email_verified: value }),
      name: 'Unverified Person',
    });
    const res = await call(app, { url: '/api/me', token });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('AUTH_EMAIL_UNVERIFIED');
  });

  it('an unverified caller cannot reach a single guarded route', async () => {
    const token = tokenFor({ uid: 'u-unverified', email: 'unverified@google.com', email_verified: false });
    for (const url of ['/api/me', '/api/submissions', '/api/ballot', '/api/dashboard', '/api/admin/turnout']) {
      const res = await call(app, { url, token });
      expect(res.status, url).toBe(403);
      expect(errorCode(res), url).toBe('AUTH_EMAIL_UNVERIFIED');
    }
  });

  it('an unverified caller creates no user record', async () => {
    const token = tokenFor({ uid: 'u-unverified', email: 'unverified@google.com', email_verified: false });
    await call(app, { url: '/api/me', token });
    const roster = await call(app, { url: '/api/admin/users', token: cast.mo.token });
    expect(roster.raw).not.toContain('unverified@google.com');
  });
});

// ===========================================================================
// C12 — magic-link rate limits
// ===========================================================================

describe('C12 — magic-link requests are rate-limited per email and per IP', () => {
  /** A fresh IP per test, so the per-IP limiter does not bleed between them. */
  let ipCounter = 0;
  const nextIp = (): string => `198.51.100.${(ipCounter += 1) % 250}`;

  async function requestLink(email: string, ip: string): ReturnType<typeof call> {
    return call(app, {
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
      headers: { 'x-forwarded-for': ip },
    });
  }

  it(`allows ${MAGIC_LINK_RATE_LIMIT.max} requests for one address, then refuses`, async () => {
    const email = `per-email-${Date.now()}@google.com`;

    for (let i = 0; i < MAGIC_LINK_RATE_LIMIT.max; i += 1) {
      const res = await requestLink(email, nextIp());
      expect(res.status, `request ${i + 1} should be allowed`).toBe(200);
    }

    const blocked = await requestLink(email, nextIp());
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe('AUTH_RATE_LIMITED');
    // A real countdown, never `Retry-After: 0` — which invites an immediate
    // retry that is guaranteed to fail again.
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('the per-email limit is keyed on the normalised address, not its capitalisation', async () => {
    // Otherwise an attacker gets `max` requests per spelling, which is no
    // limit at all: Sam@, SAM@, sAm@ ... all hit the same mailbox.
    const stem = `case-${Date.now()}`;
    const spellings = [`${stem}@google.com`, `${stem.toUpperCase()}@GOOGLE.COM`, `${stem}@Google.Com`];

    for (let i = 0; i < MAGIC_LINK_RATE_LIMIT.max; i += 1) {
      const res = await requestLink(spellings[i % spellings.length] ?? spellings[0]!, nextIp());
      expect(res.status, `spelling ${i} should be allowed`).toBe(200);
    }
    const blocked = await requestLink(spellings[0]!.toUpperCase(), nextIp());
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe('AUTH_RATE_LIMITED');
  });

  it('a different address is unaffected by another address being throttled', async () => {
    const victim = `victim-${Date.now()}@google.com`;
    for (let i = 0; i < MAGIC_LINK_RATE_LIMIT.max; i += 1) {
      expect((await requestLink(victim, nextIp())).status).toBe(200);
    }
    expect((await requestLink(victim, nextIp())).status).toBe(429);

    const bystander = `bystander-${Date.now()}@google.com`;
    expect((await requestLink(bystander, nextIp())).status).toBe(200);
  });

  it(`refuses a single IP after ${MAGIC_LINK_IP_RATE_LIMIT.max} requests, however many addresses it rotates through`, async () => {
    // The attack: inbox-bombing the whole team from one host by using a fresh
    // address each time, which the per-email limit alone would never notice.
    //
    // NOTE the assertion counts EXPLICIT 200s and explicit refusals rather
    // than "not 200". An earlier draft of this test counted any non-200 as
    // "throttled" and passed — against a server that was answering 500. A
    // rate-limit test that accepts a crash as evidence of rate limiting is
    // worse than no test, so the budget is checked precisely.
    const ip = '203.0.113.77';
    const statuses: number[] = [];
    for (let i = 0; i < MAGIC_LINK_IP_RATE_LIMIT.max + 3; i += 1) {
      statuses.push((await requestLink(`flood-${Date.now()}-${i}@google.com`, ip)).status);
    }

    const allowed = statuses.filter((s) => s === 200).length;
    expect(allowed, 'the IP budget must cap accepted requests').toBe(MAGIC_LINK_IP_RATE_LIMIT.max);
    expect(statuses.length - allowed, 'requests past the budget must be refused').toBe(3);
    // Whatever the status code is, nothing past the budget succeeded.
    expect(statuses.slice(MAGIC_LINK_IP_RATE_LIMIT.max).every((s) => s !== 200)).toBe(true);
  });

  it('the per-IP budget is consumed even by requests the allowlist refuses', async () => {
    // If a rejected address did not consume the budget, an attacker could
    // enumerate which domains are allowed at unlimited speed. Measured via
    // the remaining-budget header so the assertion does not depend on the
    // status code of the refusal.
    const ip = '203.0.113.99';
    const remaining: number[] = [];
    for (let i = 0; i < MAGIC_LINK_IP_RATE_LIMIT.max; i += 1) {
      const res = await requestLink(`probe-${i}@notgoogle.com`, ip);
      expect(res.status, 'an off-domain probe is refused').toBe(403);
      remaining.push(Number(res.headers['x-ratelimit-remaining']));
    }
    // 9, 8, 7 ... 0 — strictly decreasing, so refusals are counted.
    expect(remaining[0]).toBe(MAGIC_LINK_IP_RATE_LIMIT.max - 1);
    expect(remaining[remaining.length - 1]).toBe(0);
    expect(remaining.every((v, i) => i === 0 || v < (remaining[i - 1] ?? Infinity))).toBe(true);

    // And once spent, the endpoint stops answering the question at all.
    const over = await requestLink('probe-final@notgoogle.com', ip);
    expect(over.status).not.toBe(403);
    expect(over.status).not.toBe(200);
  });

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * KNOWN DEFECT — deliberately recorded as an expected failure.
   *
   * Exhausting EITHER rate limiter answers `500 INTERNAL` instead of
   * `429 RATE_LIMITED`. Verified for both the global limiter (300/min, on
   * `/api/contest`) and the magic-link per-IP limiter (10/hour), so the fault
   * is in the shared `errorResponseBuilder` in `apps/api/src/app.ts`, not in
   * one route's override.
   *
   * What is NOT broken, and was measured: the budget is enforced (the
   * remaining-count header walks down to zero and the handler is never
   * reached), and `Retry-After` is set correctly (60 / 3600). So this is not
   * a rate-limit bypass and not an anonymity leak.
   *
   * What IS broken: the only anonymous, internet-facing endpoint in the app
   * answers a throttled caller with an opaque 500 and no machine-readable
   * code, so the UI cannot show the countdown the `Retry-After` header is
   * carrying, and monitoring cannot tell throttling from a real outage.
   *
   * FIXED 2026-09-13. Cause was `toApiError` in `plugins/error-handler.ts`:
   * @fastify/rate-limit passes `errorResponseBuilder`'s RETURN VALUE to the
   * error handler rather than sending it, and that value is a plain
   * `.toBody()` object — not an `ApiError`, no `statusCode` — so every branch
   * missed it and the 429 was flattened to INTERNAL. The handler now
   * recognises anything already shaped like our wire format and rebuilds the
   * `ApiError` from it, retry-after included.
   *
   * This was `it.fails` while the defect stood and went red the moment the fix
   * landed — exactly as designed. Now a normal `it`, guarding regression.
   * ═════════════════════════════════════════════════════════════════════════
   */
  it('an exhausted rate limiter answers 429, not 500', async () => {
    const ip = '203.0.113.123';
    for (let i = 0; i < MAGIC_LINK_IP_RATE_LIMIT.max; i += 1) {
      await requestLink(`defect-${i}@google.com`, ip);
    }
    const over = await requestLink('defect-over@google.com', ip);

    expect(over.status).toBe(429);
    expect(errorCode(over)).toBe('RATE_LIMITED');
  });

  it('the exhausted limiter still sends a usable Retry-After, whatever the status', async () => {
    // The half of the contract that DOES hold today. Pinned separately so the
    // defect above cannot regress into losing the header as well.
    const ip = '203.0.113.124';
    for (let i = 0; i < MAGIC_LINK_IP_RATE_LIMIT.max; i += 1) {
      await requestLink(`retry-${i}@google.com`, ip);
    }
    const over = await requestLink('retry-over@google.com', ip);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('the magic-link response is identical whether or not the account exists', async () => {
    // Any difference turns the front door into an account-existence oracle
    // for the whole allowed domain.
    const existing = await requestLink(cast.sam.email, nextIp());
    const unknown = await requestLink(`nobody-${Date.now()}@google.com`, nextIp());
    expect(existing.status).toBe(unknown.status);
    expect(existing.raw).toBe(unknown.raw);
    expect(existing.raw).toBe('{"ok":true}');
  });

  it('the magic-link response never echoes the address back', async () => {
    const email = `echo-${Date.now()}@google.com`;
    const res = await requestLink(email, nextIp());
    expect(res.raw).not.toContain(email);
  });
});
