/**
 * Authentication and authorisation.
 *
 * Every authenticated request passes through four gates, in this order:
 *
 *   1. A Bearer ID token that `firebase-admin` can verify.
 *   2. `email_verified` — a magic link only proves mailbox control if the
 *      address it was sent to is the one on the token.
 *   3. The domain allowlist, matched on the FULL domain.
 *   4. A user record, created on first contact and refreshed thereafter.
 *
 * The domain check runs here on EVERY request rather than only at sign-in
 * time. A token issued before the allowlist was tightened must stop working
 * immediately, not in an hour when it expires.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiError, type Role, type User } from '@contest/shared';
import { getConfig, isEmailDomainAllowed, now, type AppConfig } from '../config.js';
import { getAdminAuth } from '../firebase.js';
import { userDoc } from '../db/collections.js';

export interface AuthedPrincipal {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  /** Mirrored from the custom claim; the Firestore role is authoritative. */
  claimAdmin: boolean;
  user: User;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after `requireAuth`. */
    principal?: AuthedPrincipal;
  }
  interface FastifyInstance {
    /** preHandler: rejects anonymous, off-domain or unverified callers. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: `requireAuth` plus an admin-role check. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Pull the bearer token out of an Authorization header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * A reasonable default display name from an email address, used until the
 * member sets their own. `first.last@google.com` -> `First Last`.
 */
export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || local
  );
}

/**
 * Find or create the user record, and settle the admin question.
 *
 * `BOOTSTRAP_ADMIN_EMAIL` solves the chicken-and-egg: the very first person to
 * sign in with that address becomes an admin. It is matched only against an
 * address that already passed the domain gate, so it cannot be used to admit
 * an outsider.
 */
export async function loadOrCreateUser(
  uid: string,
  email: string,
  tokenName: string | undefined,
  config: AppConfig,
): Promise<User> {
  const ref = userDoc(uid);
  const snap = await ref.get();
  const timestamp = now(config);

  if (!snap.exists) {
    const isBootstrapAdmin = config.bootstrapAdminEmail !== null && config.bootstrapAdminEmail === email;
    const created: User = {
      uid,
      email,
      displayName: tokenName?.trim() || displayNameFromEmail(email),
      role: isBootstrapAdmin ? 'admin' : 'member',
      createdAt: timestamp,
      lastSeenAt: timestamp,
    };
    await ref.set(created);
    if (isBootstrapAdmin) {
      await getAdminAuth(config).setCustomUserClaims(uid, { admin: true });
    }
    return created;
  }

  const existing = snap.data() as User;

  // Late bootstrap: the env var was set after this account already existed.
  if (config.bootstrapAdminEmail === existing.email && existing.role !== 'admin') {
    await ref.update({ role: 'admin', lastSeenAt: timestamp });
    await getAdminAuth(config).setCustomUserClaims(uid, { admin: true });
    return { ...existing, role: 'admin', lastSeenAt: timestamp };
  }

  // Touch `lastSeenAt` at most once a minute — the turnout view wants
  // "recently active", not a write on every poll of the dashboard.
  if (timestamp.getTime() - existing.lastSeenAt.getTime() > 60_000) {
    await ref.update({ lastSeenAt: timestamp });
  }
  return { ...existing, lastSeenAt: timestamp };
}

async function plugin(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  app.decorateRequest('principal', undefined);

  app.decorate('requireAuth', async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw new ApiError('AUTH_REQUIRED');

    let decoded;
    try {
      // checkRevoked so a demoted or disabled account loses access at once.
      decoded = await getAdminAuth(config).verifyIdToken(token, true);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? '';
      if (code.includes('expired')) throw new ApiError('AUTH_LINK_EXPIRED');
      throw new ApiError('AUTH_INVALID_TOKEN');
    }

    if (decoded.email_verified !== true) throw new ApiError('AUTH_EMAIL_UNVERIFIED');

    const email = decoded.email?.trim().toLowerCase();
    if (!email) throw new ApiError('AUTH_EMAIL_UNVERIFIED');
    if (!isEmailDomainAllowed(email, config.allowedDomains)) {
      throw new ApiError('AUTH_DOMAIN_NOT_ALLOWED');
    }

    const user = await loadOrCreateUser(decoded.uid, email, decoded['name'] as string | undefined, config);

    request.principal = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      claimAdmin: decoded['admin'] === true,
      user,
    };
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await app.requireAuth(request, reply);
    // The Firestore role wins over the claim: a promotion takes effect on the
    // next request rather than after the member's token happens to refresh.
    if (request.principal?.role !== 'admin') throw new ApiError('ADMIN_REQUIRED');
  });
}

export const authPlugin = fp(plugin, { name: 'auth' });

/** Narrowing helper for route handlers running behind `requireAuth`. */
export function principalOf(request: FastifyRequest): AuthedPrincipal {
  const p = request.principal;
  if (!p) throw new ApiError('AUTH_REQUIRED');
  return p;
}
