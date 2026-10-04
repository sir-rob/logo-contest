/**
 * Unit tests for the pure logic behind the auth routes.
 *
 * Scope is deliberate: everything here runs without Firestore, Firebase Auth or
 * a Fastify instance. The route wiring is covered by the integration suite that
 * boots against the emulators; what these tests protect is the arithmetic and
 * the string handling that a reviewer cannot eyeball with confidence — the
 * sliding window in particular, where an off-by-one is the difference between
 * "three links per quarter hour" and "an open relay".
 *
 * The limiter takes an explicit `atMs`, so time is a parameter rather than a
 * global to be faked. No `vi.useFakeTimers()` needed.
 */

import { describe, expect, it } from 'vitest';
import { MAGIC_LINK_RATE_LIMIT } from '@contest/shared';
import { EmailRateLimiter, magicLinkIpKey, normaliseEmail, redactEmail } from './auth.js';

const MINUTE = 60 * 1000;

describe('normaliseEmail', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseEmail('  saurabhma@google.com  ')).toBe('saurabhma@google.com');
  });

  it('lowercases, so one mailbox cannot occupy several rate-limit buckets', () => {
    expect(normaliseEmail('Saurabh.MA@Google.COM')).toBe('saurabh.ma@google.com');
  });

  it('produces the same key for every capitalisation of the same address', () => {
    const variants = ['a@google.com', 'A@google.com', 'a@GOOGLE.com', ' A@Google.Com '];
    const normalised = new Set(variants.map(normaliseEmail));
    expect(normalised.size).toBe(1);
  });

  it('leaves an already-canonical address untouched', () => {
    expect(normaliseEmail('saurabhma@google.com')).toBe('saurabhma@google.com');
  });

  it('does not invent an @ for a malformed value', () => {
    expect(normaliseEmail('  NotAnEmail ')).toBe('notanemail');
  });
});

describe('redactEmail', () => {
  it('keeps the first character of the local part and the whole domain', () => {
    expect(redactEmail('saurabhma@google.com')).toBe('s***@google.com');
  });

  it('does not leak the length of the local part', () => {
    expect(redactEmail('ab@google.com')).toBe('a***@google.com');
    expect(redactEmail('abcdefghijklmnop@google.com')).toBe('a***@google.com');
  });

  it('splits on the LAST @, matching how the allowlist parses a domain', () => {
    expect(redactEmail('we"ird"@thing@google.com')).toBe('w***@google.com');
  });

  it('reveals nothing at all when there is no usable local part', () => {
    expect(redactEmail('@google.com')).toBe('***');
    expect(redactEmail('no-at-sign')).toBe('***');
    expect(redactEmail('')).toBe('***');
  });
});

describe('magicLinkIpKey', () => {
  it('namespaces the key so it cannot collide with the global limiter bucket', () => {
    expect(magicLinkIpKey('203.0.113.7')).toBe('magic-link:ip:203.0.113.7');
  });

  it('keeps distinct addresses distinct, including IPv6', () => {
    expect(magicLinkIpKey('2001:db8::1')).not.toBe(magicLinkIpKey('2001:db8::2'));
  });
});

describe('EmailRateLimiter', () => {
  const makeLimiter = (): EmailRateLimiter => new EmailRateLimiter(3, 15 * MINUTE);

  it('allows exactly `max` requests and blocks the next one', () => {
    const limiter = makeLimiter();
    const t0 = 1_000_000;

    expect(limiter.consume('a@google.com', t0).allowed).toBe(true);
    expect(limiter.consume('a@google.com', t0 + 1).allowed).toBe(true);
    expect(limiter.consume('a@google.com', t0 + 2).allowed).toBe(true);

    const fourth = limiter.consume('a@google.com', t0 + 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('reports `remaining` counting down to zero', () => {
    const limiter = makeLimiter();
    const t0 = 0;
    expect(limiter.consume('a@google.com', t0).remaining).toBe(2);
    expect(limiter.consume('a@google.com', t0).remaining).toBe(1);
    expect(limiter.consume('a@google.com', t0).remaining).toBe(0);
  });

  it('reports a retryAfter that matches when the oldest hit leaves the window', () => {
    const limiter = new EmailRateLimiter(3, 15 * MINUTE);
    const t0 = 500_000;

    limiter.consume('a@google.com', t0); // expires at t0 + 15min
    limiter.consume('a@google.com', t0 + 5 * MINUTE);
    limiter.consume('a@google.com', t0 + 6 * MINUTE);

    // Asking 10 minutes in: the first hit frees up 5 minutes from now.
    const blocked = limiter.consume('a@google.com', t0 + 10 * MINUTE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(5 * 60);
  });

  it('rounds retryAfter up and never returns zero', () => {
    const limiter = new EmailRateLimiter(1, 10_000);
    const t0 = 0;
    limiter.consume('a@google.com', t0);

    // 1 ms short of the window closing -> 1 second, not 0.
    const almost = limiter.consume('a@google.com', t0 + 9_999);
    expect(almost.retryAfterSeconds).toBe(1);

    // 2.5 seconds of window left -> rounded up to 3, never down to 2.
    const partial = limiter.consume('a@google.com', t0 + 7_500);
    expect(partial.retryAfterSeconds).toBe(3);
  });

  it('does not let a blocked attempt push the window forward', () => {
    // An impatient user hammering "resend" must be locked out for the window,
    // not indefinitely — which is what recording rejected attempts would do.
    const limiter = new EmailRateLimiter(2, 10 * MINUTE);
    const t0 = 0;
    limiter.consume('a@google.com', t0);
    limiter.consume('a@google.com', t0);

    for (let i = 1; i <= 20; i += 1) {
      expect(limiter.consume('a@google.com', t0 + i * 1000).allowed).toBe(false);
    }

    // The original hits still expire on their own schedule.
    expect(limiter.consume('a@google.com', t0 + 10 * MINUTE + 1).allowed).toBe(true);
  });

  it('frees a slot once the window slides past the oldest hit', () => {
    const limiter = new EmailRateLimiter(2, 10 * MINUTE);
    const t0 = 0;
    limiter.consume('a@google.com', t0);
    limiter.consume('a@google.com', t0 + 1 * MINUTE);

    expect(limiter.consume('a@google.com', t0 + 2 * MINUTE).allowed).toBe(false);

    // Just past the first hit's expiry: one slot back, but only one.
    expect(limiter.consume('a@google.com', t0 + 10 * MINUTE + 1).allowed).toBe(true);
    expect(limiter.consume('a@google.com', t0 + 10 * MINUTE + 2).allowed).toBe(false);

    // Past the second hit's expiry too: the window is clear again.
    expect(limiter.consume('a@google.com', t0 + 21 * MINUTE).allowed).toBe(true);
  });

  it('slides rather than resetting on a fixed boundary', () => {
    // A fixed window would let 3 through at 14:59 and 3 more at 15:00.
    const limiter = new EmailRateLimiter(3, 15 * MINUTE);
    const t0 = 0;
    limiter.consume('a@google.com', t0 + 14 * MINUTE);
    limiter.consume('a@google.com', t0 + 14 * MINUTE);
    limiter.consume('a@google.com', t0 + 14 * MINUTE);

    expect(limiter.consume('a@google.com', t0 + 15 * MINUTE).allowed).toBe(false);
  });

  it('keeps keys isolated from one another', () => {
    const limiter = makeLimiter();
    const t0 = 0;

    limiter.consume('a@google.com', t0);
    limiter.consume('a@google.com', t0);
    limiter.consume('a@google.com', t0);
    expect(limiter.consume('a@google.com', t0).allowed).toBe(false);

    // A different address is entirely unaffected.
    expect(limiter.consume('b@google.com', t0).allowed).toBe(true);
    expect(limiter.consume('b@google.com', t0).remaining).toBe(1);
    expect(limiter.consume('c@google.com', t0).allowed).toBe(true);
  });

  it('exhausting one key does not consume another key\u2019s budget', () => {
    const limiter = makeLimiter();
    const t0 = 0;
    for (let i = 0; i < 10; i += 1) limiter.consume('a@google.com', t0);

    expect(limiter.consume('b@google.com', t0).remaining).toBe(2);
  });

  it('peek reports state without consuming a slot', () => {
    const limiter = makeLimiter();
    const t0 = 0;

    expect(limiter.peek('a@google.com', t0)).toEqual({ allowed: true, remaining: 3, retryAfterSeconds: 0 });
    limiter.consume('a@google.com', t0);
    expect(limiter.peek('a@google.com', t0).remaining).toBe(2);
    expect(limiter.peek('a@google.com', t0).remaining).toBe(2);

    limiter.consume('a@google.com', t0);
    limiter.consume('a@google.com', t0);
    const blocked = limiter.peek('a@google.com', t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(15 * 60);
  });

  it('forgets a key entirely once all of its hits expire', () => {
    const limiter = new EmailRateLimiter(2, 10 * MINUTE);
    limiter.consume('a@google.com', 0);
    expect(limiter.size).toBe(1);

    limiter.peek('a@google.com', 10 * MINUTE + 1);
    expect(limiter.size).toBe(0);
  });

  it('reset clears every key', () => {
    const limiter = makeLimiter();
    limiter.consume('a@google.com', 0);
    limiter.consume('b@google.com', 0);
    expect(limiter.size).toBe(2);

    limiter.reset();
    expect(limiter.size).toBe(0);
    expect(limiter.consume('a@google.com', 0).remaining).toBe(2);
  });

  it('stays bounded when flooded with unique keys', () => {
    // Memory exhaustion via attacker-chosen keys is the failure mode here: the
    // key is an email address straight off the request body.
    const limiter = new EmailRateLimiter(3, 15 * MINUTE, 50);
    for (let i = 0; i < 500; i += 1) {
      limiter.consume(`user${i}@google.com`, i);
    }
    expect(limiter.size).toBeLessThanOrEqual(50);
  });

  it('evicts the stalest keys first, keeping recent ones enforceable', () => {
    const limiter = new EmailRateLimiter(1, 60 * MINUTE, 10);
    for (let i = 0; i < 100; i += 1) {
      limiter.consume(`user${i}@google.com`, i * 1000);
    }

    // The most recent caller is still tracked, so their limit still bites.
    const recent = limiter.consume('user99@google.com', 99 * 1000 + 1);
    expect(recent.allowed).toBe(false);
  });

  it('is configured from the shared constant the spec names', () => {
    const limiter = new EmailRateLimiter(MAGIC_LINK_RATE_LIMIT.max, MAGIC_LINK_RATE_LIMIT.windowMs);
    const t0 = 0;

    for (let i = 0; i < MAGIC_LINK_RATE_LIMIT.max; i += 1) {
      expect(limiter.consume('a@google.com', t0).allowed).toBe(true);
    }
    const blocked = limiter.consume('a@google.com', t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(MAGIC_LINK_RATE_LIMIT.windowMs / 1000);
  });

  it('normalisation and the limiter compose: case variants share one budget', () => {
    const limiter = makeLimiter();
    const t0 = 0;
    const attempts = ['A@google.com', ' a@GOOGLE.com ', 'a@google.com', 'A@GOOGLE.COM'];
    const results = attempts.map((raw) => limiter.consume(normaliseEmail(raw), t0).allowed);

    expect(results).toEqual([true, true, true, false]);
  });
});
