/**
 * Auth context for the magic-link flow.
 *
 * Three states matter to the UI and they are kept distinct on purpose:
 *
 *   - `loading`  — Firebase has not yet told us whether there is a session.
 *                  Rendering a sign-in form here causes a visible flash for
 *                  an already-signed-in user on every page load.
 *   - `signed out` — no Firebase user.
 *   - `signed in but rejected` — Firebase accepted the mailbox, but our API
 *                  refused the account (wrong domain, unverified). This is a
 *                  real state, not an error to swallow: the person holds a
 *                  valid session for an address that is not allowed in, and
 *                  they need to be told that clearly and signed out.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import type { MeDto } from '@contest/shared';
import { api, ApiClientError, setActiveContestId } from '../lib/api';
import {
  completeMagicLink,
  getFirebaseAuth,
  isMagicLink,
  recallSignInEmail,
  sendMagicLink,
  signOutUser,
} from '../lib/firebase';

const CONTEST_CODE_STORAGE_KEY = 'n7.signin.contestCode';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'rejected';

export interface AuthContextValue {
  status: AuthStatus;
  /** The Firebase session, if any. Rarely needed directly. */
  firebaseUser: FirebaseUser | null;
  /** Our own record of the caller. Null unless status is 'signed-in'. */
  me: MeDto | null;
  /** Why the account was refused, when status is 'rejected'. */
  rejectionReason: string | null;
  isAdmin: boolean;
  requestLink: (email: string) => Promise<void>;
  completeLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read `/me`, e.g. after uploading an entry or saving a ballot. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [me, setMe] = useState<MeDto | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  /** Exchange a Firebase session for our own view of the caller. */
  const loadMe = useCallback(async (): Promise<void> => {
    try {
      let pendingCode: string | null = null;
      try {
        pendingCode = window.localStorage.getItem(CONTEST_CODE_STORAGE_KEY);
        if (pendingCode) window.localStorage.removeItem(CONTEST_CODE_STORAGE_KEY);
      } catch {
        pendingCode = null;
      }
      if (pendingCode && typeof api.joinContest === 'function') {
        try {
          const joined = await api.joinContest(pendingCode);
          setActiveContestId(joined.id);
        } catch {
          // Ignore invalid code during automatic sign-in registration.
        }
      }
      const profile = await api.me();
      setMe(profile);
      setRejectionReason(null);
      setStatus('signed-in');
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'AUTH_DOMAIN_NOT_ALLOWED' || err.code === 'AUTH_EMAIL_UNVERIFIED') {
          // The mailbox is real but not admissible. Hold the state so the UI
          // can explain it, then drop the session so no stale token lingers.
          setMe(null);
          setRejectionReason(err.message);
          setStatus('rejected');
          await signOutUser().catch(() => undefined);
          return;
        }
        if (err.isAuthProblem) {
          setMe(null);
          setStatus('signed-out');
          return;
        }
      }
      // A server hiccup should not look like a sign-out — keep the session and
      // let the caller retry.
      setMe(null);
      setRejectionReason(err instanceof Error ? err.message : 'Could not load your account.');
      setStatus('rejected');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setFirebaseUser(user);
      if (!user) {
        setMe(null);
        setRejectionReason(null);
        setStatus('signed-out');
        return;
      }
      setStatus('loading');
      void loadMe();
    });
    return unsubscribe;
  }, [loadMe]);

  const requestLink = useCallback(async (email: string): Promise<void> => {
    const normalised = email.trim().toLowerCase();
    // Server first: it owns the domain allowlist and the rate limit, so an
    // off-domain address is refused before any mail is generated.
    await api.requestMagicLink(normalised);
    await sendMagicLink(normalised);
  }, []);

  const completeLink = useCallback(async (email: string): Promise<void> => {
    await completeMagicLink(email.trim().toLowerCase());
    // onAuthStateChanged fires next and pulls /me.
  }, []);

  const doSignOut = useCallback(async (): Promise<void> => {
    await signOutUser();
    setMe(null);
    setRejectionReason(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      firebaseUser,
      me,
      rejectionReason,
      isAdmin: me?.role === 'admin',
      requestLink,
      completeLink,
      signOut: doSignOut,
      refresh: loadMe,
    }),
    [status, firebaseUser, me, rejectionReason, requestLink, completeLink, doSignOut, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}

/** Is the current URL a magic link, and what address was it sent to? */
export function pendingMagicLink(): { isLink: boolean; email: string | null } {
  try {
    return { isLink: isMagicLink(), email: recallSignInEmail() };
  } catch {
    return { isLink: false, email: null };
  }
}
