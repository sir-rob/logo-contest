/**
 * Environment configuration.
 *
 * Everything the API needs from the outside world is parsed and validated here,
 * once, at import time. A missing or malformed value is a startup crash rather
 * than a mystery 500 three hours into a contest.
 *
 * The domain allowlist gets the most care: it is the only thing standing
 * between "a private team contest" and "anyone with an email address".
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain allowlist
// ---------------------------------------------------------------------------

/**
 * Parse `ALLOWED_DOMAINS` — a comma-separated list, lowercased and trimmed.
 * Empty entries are dropped so `"google.com,"` behaves like `"google.com"`.
 */
export function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0)
    .map((d) => (d.startsWith('@') ? d.slice(1) : d));
}

/**
 * Exact, full-domain match against the allowlist.
 *
 * This is deliberately strict rather than clever. `endsWith` would admit
 * `notgoogle.com`; a naive `includes` would admit `google.com.evil.com`. We
 * split on the LAST `@`, lowercase, and compare the whole remainder.
 *
 * Subdomains are NOT admitted: `corp.google.com` is a different domain from
 * `google.com` and must be listed explicitly if it should be allowed.
 */
export function isEmailDomainAllowed(email: string | null | undefined, allowed: readonly string[]): boolean {
  if (!email) return false;
  if (allowed.length === 0) return false;

  const trimmed = email.trim().toLowerCase();
  // Reject anything with whitespace or more than one '@' — not a sane address.
  if (/\s/.test(trimmed)) return false;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;

  const local = parts[0];
  const domain = parts[1];
  if (!local || !domain) return false;
  // A trailing dot ("google.com.") is a distinct FQDN spelling; normalise it.
  const normalised = domain.endsWith('.') ? domain.slice(0, -1) : domain;
  if (normalised.length === 0) return false;

  return allowed.includes(normalised);
}

/** The local-part of an email, e.g. `saurabhma` from `saurabhma@google.com`. */
export function emailLocalPart(email: string): string {
  const at = email.lastIndexOf('@');
  return (at === -1 ? email : email.slice(0, at)).toLowerCase();
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const booleanish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** GCP / Firebase project. Required outside tests. */
  GCLOUD_PROJECT: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),

  /** Private bucket holding rendered images. Never public. */
  STORAGE_BUCKET: z.string().optional(),

  /** Comma-separated. See `parseAllowedDomains`. */
  ALLOWED_DOMAINS: z.string().default('google.com'),

  /** First admin, promoted automatically on first sign-in. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),

  /** Where the magic link lands. Must be an authorised Firebase Auth domain. */
  APP_URL: z.string().url().default('http://localhost:5173'),

  /** Comma-separated CORS origins. Defaults to APP_URL. */
  CORS_ORIGINS: z.string().optional(),

  /** The single contest this deployment serves by default. */
  DEFAULT_CONTEST_ID: z.string().default('north7'),

  // Emulators — presence of these switches firebase-admin into local mode.
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: z.string().optional(),

  /**
   * Test/dev only. Lets the seed script and integration tests move the clock
   * without rewriting contest dates. Ignored in production.
   */
  FAKE_NOW: z.string().datetime().optional(),
  ALLOW_FAKE_CLOCK: booleanish,
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  host: string;
  logLevel: string;
  projectId: string;
  storageBucket: string;
  allowedDomains: string[];
  bootstrapAdminEmail: string | null;
  appUrl: string;
  corsOrigins: string[];
  defaultContestId: string;
  useEmulators: boolean;
  emulators: {
    firestore: string | null;
    auth: string | null;
    storage: string | null;
  };
  fakeNow: Date | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${detail}`);
  }
  const e = parsed.data;

  const projectId = e.FIREBASE_PROJECT_ID ?? e.GCLOUD_PROJECT ?? 'demo-n7-logo-contest';
  const allowedDomains = parseAllowedDomains(e.ALLOWED_DOMAINS);
  const isProduction = e.NODE_ENV === 'production';

  if (allowedDomains.length === 0) {
    throw new Error(
      'ALLOWED_DOMAINS is empty. Refusing to start: an empty allowlist would either admit everyone or nobody, and neither is a decision worth making implicitly.',
    );
  }
  if (isProduction && !e.STORAGE_BUCKET) {
    throw new Error('STORAGE_BUCKET is required in production.');
  }

  const useEmulators = Boolean(
    e.FIRESTORE_EMULATOR_HOST ?? e.FIREBASE_AUTH_EMULATOR_HOST ?? e.FIREBASE_STORAGE_EMULATOR_HOST,
  );
  if (isProduction && useEmulators) {
    throw new Error('Emulator hosts are set but NODE_ENV=production. Refusing to start.');
  }

  const corsOrigins = e.CORS_ORIGINS
    ? e.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [e.APP_URL];

  // The fake clock is a testing affordance and must never be reachable in prod.
  const fakeNow = !isProduction && e.ALLOW_FAKE_CLOCK && e.FAKE_NOW ? new Date(e.FAKE_NOW) : null;

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    projectId,
    storageBucket: e.STORAGE_BUCKET ?? `${projectId}.appspot.com`,
    allowedDomains,
    bootstrapAdminEmail: e.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || null,
    appUrl: e.APP_URL,
    corsOrigins,
    defaultContestId: e.DEFAULT_CONTEST_ID,
    useEmulators,
    emulators: {
      firestore: e.FIRESTORE_EMULATOR_HOST ?? null,
      auth: e.FIREBASE_AUTH_EMULATOR_HOST ?? null,
      storage: e.FIREBASE_STORAGE_EMULATOR_HOST ?? null,
    },
    fakeNow,
  };
}

let cached: AppConfig | null = null;

/** Process-wide config. Parsed once; call `resetConfig()` in tests. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

/**
 * Current time, honouring the dev-only fake clock. Every phase decision in the
 * API goes through this so a seeded "pretend it is voting day" actually works.
 */
export function now(config: AppConfig = getConfig()): Date {
  return config.fakeNow ? new Date(config.fakeNow) : new Date();
}
