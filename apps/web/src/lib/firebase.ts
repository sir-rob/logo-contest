/**
 * Firebase client initialisation.
 *
 * Only Auth is used from the browser. Firestore and Storage are deliberately
 * NOT initialised here: every read and write goes through our API so that
 * "can this person see this field" is decided in exactly one place, rather
 * than being an emergent property of hand-written security rules.
 *
 * Emulator wiring keys off `VITE_USE_EMULATORS`, so a local run never talks to
 * a real project by accident.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type Auth,
  type UserCredential,
} from 'firebase/auth';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'demo-n7-logo-contest',
  appId: env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
} as const;

export const useEmulators = env.VITE_USE_EMULATORS === 'true';

/** Where the magic link should land. Must be an authorised Auth domain. */
export const appUrl: string = env.VITE_APP_URL ?? window.location.origin;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function getFirebase(): FirebaseApp {
  app ??= initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebase());
  if (useEmulators) {
    const host = env.VITE_AUTH_EMULATOR_URL ?? 'http://localhost:9099';
    connectAuthEmulator(auth, host, { disableWarnings: true });
  }
  return auth;
}

// ---------------------------------------------------------------------------
// Magic link
// ---------------------------------------------------------------------------

/**
 * The address the link was sent to, stashed so the landing page can complete
 * sign-in without asking again.
 *
 * `localStorage` is what Firebase's own guidance recommends here. It is a
 * mild phishing consideration (an attacker who can already run script in this
 * origin could read it), but that attacker has already won, and the
 * alternative — prompting for the address a second time on the landing page —
 * is a real usability cost on a link opened in a different browser.
 */
const EMAIL_KEY = 'n7.signin.email';

export const rememberSignInEmail = (email: string): void => {
  window.localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
};

export const recallSignInEmail = (): string | null => window.localStorage.getItem(EMAIL_KEY);

export const forgetSignInEmail = (): void => {
  window.localStorage.removeItem(EMAIL_KEY);
};

/**
 * Send the sign-in link.
 *
 * The API is asked FIRST (see `api.requestMagicLink`) so the domain allowlist
 * and rate limits are enforced server-side; this call is what actually puts
 * the mail in the queue. Doing it in that order means an off-domain address
 * never receives anything at all.
 */
export async function sendMagicLink(email: string, continueUrl: string = appUrl): Promise<void> {
  await sendSignInLinkToEmail(getFirebaseAuth(), email, {
    url: `${continueUrl.replace(/\/$/, '')}/finish-sign-in`,
    handleCodeInApp: true,
  });
  rememberSignInEmail(email);
}

export const isMagicLink = (href: string = window.location.href): boolean =>
  isSignInWithEmailLink(getFirebaseAuth(), href);

export async function completeMagicLink(email: string, href: string = window.location.href): Promise<UserCredential> {
  const credential = await signInWithEmailLink(getFirebaseAuth(), email, href);
  forgetSignInEmail();
  return credential;
}

export async function signOutUser(): Promise<void> {
  await signOut(getFirebaseAuth());
}

/** A fresh ID token, or null when signed out. */
export async function currentIdToken(forceRefresh = false): Promise<string | null> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
