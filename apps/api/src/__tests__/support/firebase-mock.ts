/**
 * The module that stands in for `apps/api/src/firebase.ts` under test.
 *
 * Every test file in this directory starts with
 *
 *     vi.mock('../firebase.js', async () => (await import('./support/firebase-mock.js')).firebaseModule);
 *
 * which swaps the real firebase-admin handles for in-memory ones while leaving
 * EVERY other module — routes, plugins, DTO projections, converters — exactly
 * as shipped. That is the point: these tests must exercise the real anonymity
 * boundary, not a re-implementation of it.
 *
 * The fake `Auth` is the interesting half. `verifyIdToken` decodes a token that
 * the test minted, so a test can hand the API an off-domain address, an
 * unverified address, an expired token or outright garbage and watch the real
 * four gates in `plugins/auth.ts` react.
 */

import { FakeFirestore } from './fake-firestore.js';

// ---------------------------------------------------------------------------
// Shared singletons — one store per test process, cleared between tests
// ---------------------------------------------------------------------------

export const fakeDb = new FakeFirestore();

/** Custom claims written by the API via `setCustomUserClaims`. */
export const customClaims = new Map<string, Record<string, unknown>>();

/** Objects "uploaded" to the fake bucket: path -> bytes. */
export const bucketObjects = new Map<string, Buffer>();

export function resetFirebaseMock(): void {
  fakeDb.reset();
  customClaims.clear();
  bucketObjects.clear();
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface FakeTokenClaims {
  uid: string;
  email?: string | undefined;
  email_verified?: boolean;
  name?: string;
  admin?: boolean;
  [key: string]: unknown;
}

/** Sentinel tokens the fake verifier treats as failures. */
export const EXPIRED_TOKEN = 'test-token-expired';
export const INVALID_TOKEN = 'test-token-invalid';
export const REVOKED_TOKEN = 'test-token-revoked';

/** Mint a token the fake `verifyIdToken` will accept and decode. */
export function mintToken(claims: FakeTokenClaims): string {
  return `fake.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}`;
}

class FakeAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const fakeAuth = {
  async verifyIdToken(token: string, _checkRevoked?: boolean): Promise<Record<string, unknown>> {
    if (token === EXPIRED_TOKEN) {
      throw new FakeAuthError('Firebase ID token has expired.', 'auth/id-token-expired');
    }
    if (token === REVOKED_TOKEN) {
      throw new FakeAuthError('Firebase ID token has been revoked.', 'auth/id-token-revoked');
    }
    if (!token.startsWith('fake.')) {
      throw new FakeAuthError('Decoding Firebase ID token failed.', 'auth/argument-error');
    }
    try {
      const decoded = JSON.parse(Buffer.from(token.slice('fake.'.length), 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (typeof decoded['uid'] !== 'string') {
        throw new FakeAuthError('Token has no uid.', 'auth/argument-error');
      }
      return decoded;
    } catch (err) {
      if (err instanceof FakeAuthError) throw err;
      throw new FakeAuthError('Decoding Firebase ID token failed.', 'auth/argument-error');
    }
  },

  async setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void> {
    if (claims === null) customClaims.delete(uid);
    else customClaims.set(uid, claims);
  },

  async getUserByEmail(email: string): Promise<{ uid: string; email: string }> {
    throw new FakeAuthError(`No user record for ${email}.`, 'auth/user-not-found');
  },
};

// ---------------------------------------------------------------------------
// Bucket
// ---------------------------------------------------------------------------

const fakeBucket = {
  name: 'test-bucket',
  file(path: string) {
    return {
      name: path,
      async save(bytes: Buffer): Promise<void> {
        bucketObjects.set(path, Buffer.from(bytes));
      },
      async getSignedUrl(): Promise<[string]> {
        return [`https://signed.invalid/${encodeURIComponent(path)}?sig=test`];
      },
      async delete(): Promise<void> {
        bucketObjects.delete(path);
      },
    };
  },
  async deleteFiles(options: { prefix: string }): Promise<void> {
    for (const key of [...bucketObjects.keys()]) {
      if (key.startsWith(options.prefix)) bucketObjects.delete(key);
    }
  },
};

// ---------------------------------------------------------------------------
// The replacement module
// ---------------------------------------------------------------------------

export const firebaseModule = {
  getFirebaseApp: () => ({ name: 'fake-app' }),
  getDb: () => fakeDb,
  getAdminAuth: () => fakeAuth,
  getBucket: () => fakeBucket,
  resetFirebase: () => {
    /* nothing memoised here */
  },
};
