/**
 * Client-side domain hint.
 *
 * This is FEEDBACK, not a gate. The allowlist lives on the server
 * (`ALLOWED_DOMAINS`) and is the only thing that decides who gets a link; all
 * this does is save someone a round trip when they have obviously typed a
 * personal address. Submitting is never blocked on it — if the two ever
 * disagree, the server wins and its message is what the user sees.
 */

const DEFAULT_DOMAINS = 'google.com';

export const ALLOWED_DOMAIN_HINTS: readonly string[] = (
  import.meta.env.VITE_ALLOWED_DOMAINS ?? DEFAULT_DOMAINS
)
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** "@google.com", or "@google.com or @example.com" for a multi-domain contest. */
export function formatAllowedDomains(domains: readonly string[] = ALLOWED_DOMAIN_HINTS): string {
  const at = domains.map((d) => `@${d}`);
  if (at.length === 0) return 'your work address';
  if (at.length === 1) return at[0] as string;
  return `${at.slice(0, -1).join(', ')} or ${at[at.length - 1] as string}`;
}

export function domainOf(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1).replace(/\.$/, '');
}

/** Loose on purpose: catching typos, not validating RFC 5322. */
export function looksLikeEmail(email: string): boolean {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Null when the address is plausible, otherwise a gentle sentence. Subdomains
 * are not admitted, matching the server's exact full-domain match.
 */
export function domainHintFor(email: string): string | null {
  if (!email.trim()) return null;
  if (!looksLikeEmail(email)) return null;

  const domain = domainOf(email);
  if (!domain) return null;
  if (ALLOWED_DOMAIN_HINTS.length === 0) return null;
  if (ALLOWED_DOMAIN_HINTS.includes(domain)) return null;

  return `This contest is for ${formatAllowedDomains()} addresses. You can still try, but the link will not be sent to @${domain}.`;
}
