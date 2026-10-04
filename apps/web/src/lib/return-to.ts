/**
 * Remembering where someone was heading before we asked them to sign in.
 *
 * Router state is not enough. The magic-link round trip is a fresh page load
 * (often in a different tab, sometimes on a different device), so anything held
 * in `history.state` is gone by the time they come back. `sessionStorage`
 * survives the tab; nothing survives the device hop, which is why the fallback
 * is simply the dashboard rather than an error.
 */

const KEY = 'n7.returnTo';

/** Only same-origin, absolute-path destinations. Never an external URL. */
function isSafePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

const IGNORED = new Set(['/signin', '/sign-in', '/finish-signin', '/finish-sign-in']);

export function rememberReturnTo(path: string): void {
  if (!isSafePath(path)) return;
  if (IGNORED.has(new URL(path, 'http://x').pathname)) return;
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // Private browsing, storage disabled — we just lose the nicety.
  }
}

/** Reads and clears the stored destination. Defaults to the dashboard. */
export function takeReturnTo(fallback = '/'): string {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (stored && isSafePath(stored)) return stored;
  } catch {
    // Fall through to the default.
  }
  return fallback;
}
