/**
 * Authentication, profile and admin-roster routes.
 *
 * Four concerns live here, in rough order of how exposed they are:
 *
 *   1. `POST /auth/magic-link` — the ONLY anonymous route in the app. It is
 *      the front door, so it carries the allowlist gate and two independent
 *      rate limits.
 *   2. `GET /me`, `PATCH /me` — the caller's own record. By construction
 *      there is no parameter here that could address somebody else.
 *   3. `GET /admin/users` — the admin roster.
 *   4. `POST /admin/users/:uid/role` — promotion and demotion, transactional,
 *      audited, and mirrored into the Firebase Auth custom claim.
 *
 * FIRST-ADMIN BOOTSTRAP IS NOT HERE. `BOOTSTRAP_ADMIN_EMAIL` is applied by
 * `loadOrCreateUser` in `../plugins/auth.js`, which runs on every authenticated
 * request: it promotes that address on first contact and also on a late set
 * (i.e. if the env var is added after the account already exists). Do not
 * duplicate that logic in this file — two places deciding who is an admin is
 * one place too many.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import {
  ApiError,
  MAGIC_LINK_IP_RATE_LIMIT,
  MAGIC_LINK_RATE_LIMIT,
  MeSchema,
  RequestMagicLinkSchema,
  SetRoleSchema,
  UpdateProfileSchema,
  type MeDto,
  type PublicSubmissionDto,
  type Role,
  type User,
} from '@contest/shared';
import { getConfig, isEmailDomainAllowed, type AppConfig } from '../config.js';
import { getAdminAuth, getDb } from '../firebase.js';
import { ballotDoc, submissionsCol, userDoc, usersCol } from '../db/collections.js';
import { principalOf } from '../plugins/auth.js';
import { zodErrorToFields } from '../plugins/error-handler.js';
import { writeAudit } from '../services/audit.js';
import { toPublicDto } from '../services/submission-dto.js';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in ./auth.test.ts)
// ---------------------------------------------------------------------------

/**
 * Canonical form of an address for every comparison we make: allowlist match,
 * rate-limit bucket, bootstrap-admin match.
 *
 * Lowercasing matters for more than tidiness. `Saurabh@google.com` and
 * `saurabh@google.com` are the same mailbox, so if they hashed to different
 * rate-limit keys an attacker would get `max` requests per capitalisation
 * variant — effectively no limit at all.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A log-safe rendering of an address: first character of the local part, then
 * the full domain. `saurabhma@google.com` -> `s***@google.com`.
 *
 * We keep the domain because an operator debugging "why is nobody getting
 * links" needs to see which domain was asked for, and the domain is not
 * personal data here — it is the one thing the allowlist already publicises.
 * We drop the local part because request logs are retained and shipped, and a
 * full roster of who tried to sign in is not something this feature needs.
 */
export function redactEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.charAt(0);
  return `${head}***@${domain}`;
}

/** Namespaced key for the per-IP limiter, so it cannot collide with the global bucket. */
export function magicLinkIpKey(ip: string): string {
  return `magic-link:ip:${ip}`;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window frees a slot. `0` when the request was allowed. */
  retryAfterSeconds: number;
}

/**
 * A sliding-window counter keyed by email address.
 *
 * Why in-process rather than the shared store `@fastify/rate-limit` uses: this
 * limit is keyed by request BODY, not by connection, and the plugin's key
 * generator runs before the body is reliably available on every hook. Keeping
 * it here also keeps the decision testable without booting Fastify.
 *
 * The trade-off is honest and worth stating: with N API instances a determined
 * caller gets up to N × max links per window. That is acceptable because the
 * per-IP limit (which IS shared-store capable) and the allowlist already bound
 * the blast radius, and the worst case is a few redundant emails to a mailbox
 * the requester demonstrably controls.
 *
 * Sliding rather than fixed window: a fixed window lets someone fire `max`
 * requests at 14:59 and `max` more at 15:00. Pruning by timestamp closes that.
 */
export class EmailRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /**
   * @param max        Requests permitted per key per window.
   * @param windowMs   Width of the sliding window, in milliseconds.
   * @param maxKeys    Hard cap on tracked keys. Unbounded growth on an
   *                   attacker-chosen key is a memory-exhaustion vector, so the
   *                   map is swept and, if still oversized, trimmed.
   */
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = 10_000,
  ) {}

  /** Number of keys currently tracked. Exposed for tests and diagnostics. */
  get size(): number {
    return this.hits.size;
  }

  /**
   * Record an attempt and decide on it.
   *
   * A blocked attempt is deliberately NOT recorded. Recording it would make the
   * window slide forward on every rejected retry, so an impatient user hammering
   * the button would lock themselves out indefinitely rather than for 15 minutes.
   */
  consume(key: string, atMs: number = Date.now()): RateLimitDecision {
    const recent = this.prunedHits(key, atMs);

    if (recent.length >= this.max) {
      // `recent` is sorted ascending, so index 0 is the hit that expires first.
      const oldest = recent[0] ?? atMs;
      const freesAt = oldest + this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        // Round up, and never report 0 — a `Retry-After: 0` invites an
        // immediate retry that is guaranteed to fail again.
        retryAfterSeconds: Math.max(1, Math.ceil((freesAt - atMs) / 1000)),
      };
    }

    recent.push(atMs);
    this.hits.set(key, recent);
    this.evictIfOversized(atMs);
    return { allowed: true, remaining: this.max - recent.length, retryAfterSeconds: 0 };
  }

  /** Read the current state without recording an attempt. */
  peek(key: string, atMs: number = Date.now()): RateLimitDecision {
    const recent = this.prunedHits(key, atMs);
    if (recent.length < this.max) {
      return { allowed: true, remaining: this.max - recent.length, retryAfterSeconds: 0 };
    }
    const oldest = recent[0] ?? atMs;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - atMs) / 1000)),
    };
  }

  /** Drop all state. Used by tests; also handy for an operator reset. */
  reset(): void {
    this.hits.clear();
  }

  /** Timestamps for `key` that still fall inside the window, oldest first. */
  private prunedHits(key: string, atMs: number): number[] {
    const cutoff = atMs - this.windowMs;
    const existing = this.hits.get(key);
    if (!existing) return [];
    const recent = existing.filter((t) => t > cutoff);
    if (recent.length === 0) {
      this.hits.delete(key);
      return [];
    }
    this.hits.set(key, recent);
    return recent;
  }

  /**
   * Keep the map bounded. First a cheap sweep of wholly-expired keys; only if
   * that is not enough do we evict the keys whose most recent hit is oldest —
   * those are the closest to expiring anyway, so the eviction costs the least.
   */
  private evictIfOversized(atMs: number): void {
    if (this.hits.size <= this.maxKeys) return;

    const cutoff = atMs - this.windowMs;
    for (const [key, times] of this.hits) {
      const last = times[times.length - 1];
      if (last === undefined || last <= cutoff) this.hits.delete(key);
    }
    if (this.hits.size <= this.maxKeys) return;

    const byStaleness = [...this.hits.entries()].sort((a, b) => {
      const lastA = a[1][a[1].length - 1] ?? 0;
      const lastB = b[1][b[1].length - 1] ?? 0;
      return lastA - lastB;
    });
    const excess = this.hits.size - this.maxKeys;
    for (let i = 0; i < excess; i += 1) {
      const entry = byStaleness[i];
      if (entry) this.hits.delete(entry[0]);
    }
  }
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

const UidParamsSchema = z.object({ uid: z.string().min(1) });

/**
 * Parse untrusted input into a typed value, or throw an `ApiError`.
 *
 * The global error handler already converts a stray `ZodError`, but going
 * through `ApiError` explicitly keeps one rule true with no exceptions: every
 * failure leaving this file is an `ApiError`, so nothing here ever hand-writes
 * a response body.
 */
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ApiError('VALIDATION_FAILED', undefined, zodErrorToFields(err));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MeDto assembly
// ---------------------------------------------------------------------------

/**
 * The caller's own active entry for the default contest, or null.
 *
 * Scoped by `ownerUid == caller` at the query level rather than filtered after
 * the fact, so there is no shape of this function that can read somebody
 * else's submission even if a later edit gets the projection wrong.
 */
async function loadOwnSubmission(uid: string, config: AppConfig): Promise<PublicSubmissionDto | null> {
  const snap = await submissionsCol()
    .where('contestId', '==', config.defaultContestId)
    .where('ownerUid', '==', uid)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  const doc = snap.docs[0];
  if (!doc) return null;
  return toPublicDto(doc.data(), uid);
}

/**
 * The caller's OWN ranking, or null.
 *
 * The ballot document id is derived from `(contestId, uid)` — there is no uid
 * parameter on any route in this file, so the only ballot reachable from here
 * is the caller's. That is the whole of the ballot-secrecy story on this path:
 * not a permission check that could be forgotten, but an addressing scheme
 * that cannot name anyone else.
 */
async function loadOwnBallot(uid: string, config: AppConfig): Promise<string[] | null> {
  const snap = await ballotDoc(config.defaultContestId, uid).get();
  const ballot = snap.data();
  return ballot ? [...ballot.ranking] : null;
}

/**
 * Build and VALIDATE the `MeDto`.
 *
 * `MeSchema.parse` is not ceremony: it is the assertion that this response
 * carries exactly the fields the anonymity boundary declares. If a future edit
 * spreads a `User` entity in here, the extra server-only fields are stripped by
 * the schema and a shape change fails on this line rather than in a client.
 */
async function buildMe(user: User, config: AppConfig): Promise<MeDto> {
  const [mySubmission, myBallot] = await Promise.all([
    loadOwnSubmission(user.uid, config),
    loadOwnBallot(user.uid, config),
  ]);

  return MeSchema.parse({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    mySubmission,
    myBallot,
  } satisfies MeDto);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // One limiter instance for the lifetime of the app. Constructed here rather
  // than at module scope so a test that builds two apps gets two clean states.
  const emailLimiter = new EmailRateLimiter(MAGIC_LINK_RATE_LIMIT.max, MAGIC_LINK_RATE_LIMIT.windowMs);

  /**
   * POST /auth/magic-link — ANONYMOUS.
   *
   * THIS ROUTE DOES NOT SEND EMAIL. The browser SDK calls
   * `sendSignInLinkToEmail` itself; Firebase Auth delivers the message. What
   * this endpoint provides is the gate the client cannot be trusted to apply:
   * the domain allowlist, the two rate limits, and the log trail. Do not add
   * mail sending here later — it would duplicate delivery, and the client
   * would still be able to skip it.
   *
   * (There is no audit-log entry: `AUDIT_ACTIONS` covers admin actions by an
   * identified actor, and this caller is by definition anonymous. The trail for
   * this route is the structured request log below.)
   */
  app.post(
    '/auth/magic-link',
    {
      config: {
        // Per-IP limit, enforced by @fastify/rate-limit as a preHandler — so it
        // runs BEFORE the handler body and therefore before any allowlist
        // probing is possible. This is what stops one host inbox-bombing the
        // whole team, which the per-email limit alone would not catch.
        rateLimit: {
          max: MAGIC_LINK_IP_RATE_LIMIT.max,
          timeWindow: MAGIC_LINK_IP_RATE_LIMIT.windowMs,
          // `trustProxy` is on in app.ts, so `request.ip` is the real client
          // address behind Cloud Run rather than the load balancer's.
          keyGenerator: (request: FastifyRequest) => magicLinkIpKey(request.ip),
        },
      },
    },
    async (request) => {
      const config = getConfig();
      const body = parseOrThrow(RequestMagicLinkSchema, request.body);
      const email = normaliseEmail(body.email);

      // GATE 1 — the allowlist, before anything else happens with this address.
      // `isEmailDomainAllowed` matches the FULL domain after the last `@`:
      // `notgoogle.com` and `google.com.evil.com` are both rejected, which a
      // `endsWith`/`includes` check would wave through.
      //
      // This rejection is surfaced to the caller on purpose. Telling someone
      // "this contest is @google.com only" is useful and reveals nothing — the
      // allowlist is a property of the contest, not of any person.
      if (!isEmailDomainAllowed(email, config.allowedDomains)) {
        throw new ApiError('AUTH_DOMAIN_NOT_ALLOWED');
      }

      // GATE 2 — per-email limit. Protects a single mailbox from being flooded
      // by a caller who rotates IPs, which defeats the per-IP limit above.
      const decision = emailLimiter.consume(email);
      if (!decision.allowed) {
        // `retryAfter` reaches the client as both the error body and the
        // `Retry-After` header (see plugins/error-handler.ts), so the UI can
        // show a real countdown instead of a shrug.
        throw new ApiError('AUTH_RATE_LIMITED', undefined, undefined, decision.retryAfterSeconds);
      }

      request.log.info(
        { emailRedacted: redactEmail(email), remaining: decision.remaining },
        'magic-link requested',
      );

      // Identical response whether or not this address has an account. Any
      // difference — a different code, a different shape, even a measurably
      // different latency path — turns this endpoint into an account-existence
      // oracle for the whole allowed domain.
      return { ok: true };
    },
  );

  /** GET /me — the caller's own profile, entry and ballot. */
  app.get('/me', { preHandler: app.requireAuth }, async (request) => {
    const principal = principalOf(request);
    return buildMe(principal.user, getConfig());
  });

  /** PATCH /me — change your own display name. */
  app.patch('/me', { preHandler: app.requireAuth }, async (request) => {
    const config = getConfig();
    const principal = principalOf(request);
    const body = parseOrThrow(UpdateProfileSchema, request.body);

    // Trim, then re-validate: `"   "` passes `min(1)` but is not a name, and a
    // blank display name would render as an invisible author in the admin
    // roster.
    const displayName = body.displayName.trim();
    if (displayName.length === 0) {
      throw new ApiError('VALIDATION_FAILED', undefined, { displayName: 'Display name cannot be blank.' });
    }

    const ref = userDoc(principal.uid);
    await ref.update({ displayName });

    // Re-read rather than patching the in-memory principal, so the response is
    // what the database actually holds.
    const snap = await ref.get();
    const user = snap.data();
    if (!user) throw new ApiError('NOT_FOUND', 'Your account record is missing.');

    return buildMe(user, config);
  });

  /**
   * GET /admin/users — the admin roster.
   *
   * This is a membership list, NOT turnout (that lives on the admin turnout
   * route) and it carries no ballot information whatsoever. There is no field
   * here that says whether a person voted, let alone how.
   */
  app.get('/admin/users', { preHandler: app.requireAdmin }, async () => {
    const snap = await usersCol().orderBy('email').get();
    const users = snap.docs.map((doc) => {
      const user = doc.data();
      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        // ISO strings: the wire format is JSON, and a Firestore Timestamp or a
        // raw Date would serialise into something the client has to guess at.
        createdAt: user.createdAt.toISOString(),
        lastSeenAt: user.lastSeenAt.toISOString(),
      };
    });
    return { users };
  });

  /**
   * POST /admin/users/:uid/role — promote or demote.
   *
   * Two things make this more than a field update: the last-admin guard, and
   * keeping the Firebase Auth custom claim in step with Firestore.
   */
  app.post('/admin/users/:uid/role', { preHandler: app.requireAdmin }, async (request) => {
    const config = getConfig();
    const actor = principalOf(request);
    const { uid } = parseOrThrow(UidParamsSchema, request.params);
    const { role: toRole } = parseOrThrow(SetRoleSchema, request.body);

    const db = getDb();

    const outcome = await db.runTransaction(async (tx) => {
      const ref = userDoc(uid, db);
      const snap = await tx.get(ref);
      const target = snap.data();
      // A uid with no user document is not a person we can demote or promote.
      if (!target) throw new ApiError('NOT_FOUND', 'No such user.');

      const fromRole: Role = target.role;

      if (fromRole === toRole) {
        // Idempotent no-op. We still fall through to re-assert the custom claim
        // below, which repairs drift if a previous call died between the
        // Firestore write and the claim write.
        return { fromRole, toRole, targetEmail: target.email, changed: false };
      }

      if (fromRole === 'admin' && toRole === 'member') {
        // LAST-ADMIN GUARD. Counted INSIDE the transaction, and only here: a
        // count taken before `runTransaction` is a read that nothing protects,
        // so two admins demoting each other concurrently would both see "2
        // admins", both pass, and lock everyone out of the contest. Reading the
        // count through `tx` puts it in the transaction's read set, so one of
        // the two retries and then fails correctly.
        //
        // Self-demotion is intentionally permitted: an admin stepping down is a
        // normal thing to do, and the count is what decides, not who is asking.
        const admins = await tx.get(usersCol(db).where('role', '==', 'admin'));
        if (admins.size <= 1) throw new ApiError('LAST_ADMIN');
      }

      tx.update(ref, { role: toRole });
      return { fromRole, toRole, targetEmail: target.email, changed: true };
    });

    const auth = getAdminAuth();

    // Mirror the role into the custom claim. Firestore stays authoritative for
    // this API (`requireAdmin` reads the document), but the Firestore and
    // Storage security rules are evaluated by Google's backends, which only
    // ever see the token — so the claim is the ONLY thing enforcing admin
    // access there. Leaving it stale would leave a demoted admin with direct
    // database access the API no longer grants.
    await auth.setCustomUserClaims(uid, { admin: outcome.toRole === 'admin' });

    if (outcome.changed) {
      // Setting a claim does not touch tokens already issued: an ID token lives
      // about an hour and keeps whatever claims it was minted with. Without
      // this revocation a just-demoted admin would keep `admin: true` — and
      // with it, rules-level access — until their token happened to expire.
      // Revoking forces a refresh, and the refresh re-reads the new claim.
      await auth.revokeRefreshTokens(uid);

      await writeAudit(
        {
          // Role is global rather than per-contest, but the audit view is
          // filtered by contest, and an admin change made during a contest is
          // exactly what a reviewer of that contest needs to see.
          contestId: config.defaultContestId,
          actorUid: actor.uid,
          actorEmail: actor.email,
          action: outcome.toRole === 'admin' ? 'admin.promote' : 'admin.demote',
          targetType: 'user',
          targetId: uid,
          metadata: {
            fromRole: outcome.fromRole,
            toRole: outcome.toRole,
            targetEmail: outcome.targetEmail,
          },
        },
        request.log,
      );
    }

    return { ok: true };
  });
}
