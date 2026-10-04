/**
 * Normalising the two kinds of failure the magic-link flow can produce.
 *
 * `requestLink` calls our API first and then Firebase; `completeLink` calls
 * only Firebase. So a sign-in screen can be handed an `ApiClientError` carrying
 * one of our `ErrorCode`s, or a raw `FirebaseError` with a string code like
 * `auth/invalid-action-code`. Switching on both at every call site is how the
 * baffling "something went wrong" screens get written, so it happens once here.
 */

import { ApiClientError } from './api';

export type AuthFailureKind =
  | 'domain-not-allowed'
  | 'rate-limited'
  | 'link-expired'
  | 'invalid-email'
  | 'offline'
  | 'unknown';

export interface AuthFailure {
  kind: AuthFailureKind;
  /** Safe to show verbatim. Prefers the server's wording where there is one. */
  message: string;
  /** Seconds until a rate-limited caller may try again, when the server said. */
  retryAfter?: number;
}

function firebaseCodeOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('auth/') ? code : null;
}

export function classifyAuthError(err: unknown): AuthFailure {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case 'AUTH_DOMAIN_NOT_ALLOWED':
      case 'AUTH_EMAIL_UNVERIFIED':
        return { kind: 'domain-not-allowed', message: err.message };
      case 'AUTH_RATE_LIMITED':
      case 'RATE_LIMITED':
        return { kind: 'rate-limited', message: err.message, retryAfter: err.retryAfter };
      case 'AUTH_LINK_EXPIRED':
        return { kind: 'link-expired', message: err.message };
      case 'VALIDATION_FAILED':
        return { kind: 'invalid-email', message: err.message };
      default:
        return { kind: 'unknown', message: err.message };
    }
  }

  const code = firebaseCodeOf(err);
  if (code) {
    switch (code) {
      // Both mean the same thing to a human: this link will not work again.
      case 'auth/invalid-action-code':
      case 'auth/expired-action-code':
      case 'auth/user-disabled':
        return {
          kind: 'link-expired',
          message: 'That sign-in link has already been used or has expired.',
        };
      case 'auth/invalid-email':
        return { kind: 'invalid-email', message: 'That does not look like a valid email address.' };
      case 'auth/network-request-failed':
        return { kind: 'offline', message: 'We could not reach the server. Check your connection.' };
      case 'auth/too-many-requests':
        return { kind: 'rate-limited', message: 'Too many attempts. Please wait a few minutes.' };
      default:
        return { kind: 'unknown', message: 'Sign-in failed. Please request a new link.' };
    }
  }

  return {
    kind: 'unknown',
    message: err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.',
  };
}

/** "in 2 minutes" / "in 45 seconds", for a retry-after that reads like English. */
export function formatRetryAfter(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return 'shortly';
  if (seconds < 60) return `in ${Math.ceil(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}
