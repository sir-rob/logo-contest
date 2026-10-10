/**
 * Test harness: a real Fastify app, real routes, fake storage layer.
 *
 * The rule this harness exists to protect: NOTHING between the HTTP boundary
 * and the DTO projection is stubbed. `buildApp()` is the shipped one, the auth
 * plugin is the shipped one, the routers are the shipped ones, and every
 * response is taken from `.inject()` as SERIALISED JSON. Only `firebase.ts`
 * (Firestore / Auth / Bucket handles) is replaced, because those need a
 * network and a credential and neither exists in CI.
 *
 * If a leak is added anywhere in the real code path, it shows up in the bytes
 * these helpers hand back.
 */

import type { FastifyInstance } from 'fastify';
import {
  COLLECTIONS,
  ballotDocId,
  type Ballot,
  type Contest,
  type ResultSnapshot,
  type Submission,
  type User,
} from '@contest/shared';
import { buildApp } from '../../app.js';
import { getConfig, resetConfig } from '../../config.js';
import { fakeDb, mintToken, resetFirebaseMock, type FakeTokenClaims } from './firebase-mock.js';

export const CONTEST_ID = 'north7';
export const ALLOWED_DOMAIN = 'google.com';
export const TIE_BREAK_SEED = 'seed-for-anonymity-tests';

/** A clock the tests can point at any phase they like. */
export const FAKE_NOW = '2026-06-15T12:00:00.000Z';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Pin the environment and drop the memoised config.
 *
 * `FIREBASE_STORAGE_EMULATOR_HOST` is set so `signedReadUrl` takes its
 * emulator branch and becomes a pure string function. That keeps image URLs
 * deterministic AND keeps them inside the test's reach: a signed-URL leak
 * (a path carrying an email, say) has to be visible to the leak scanner.
 */
export function setupTestEnv(overrides: Record<string, string | undefined> = {}): void {
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ALLOWED_DOMAINS: ALLOWED_DOMAIN,
    APP_URL: 'http://localhost:5173',
    STORAGE_BUCKET: 'test-bucket',
    FIREBASE_PROJECT_ID: 'demo-n7-logo-contest',
    DEFAULT_CONTEST_ID: CONTEST_ID,
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
    BOOTSTRAP_ADMIN_EMAIL: undefined,
    ALLOW_FAKE_CLOCK: 'true',
    FAKE_NOW,
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/**
 * Build the real app.
 *
 * `isProduction: true` is forced ONLY to keep the pretty-print log transport
 * (and its worker thread) out of the test process. Nothing else reads that
 * flag from the object passed here; routes call `getConfig()` themselves and
 * get the honest test config.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({ ...getConfig(), isProduction: true, logLevel: 'silent' });
  await app.ready();
  return app;
}

export function resetTestState(): void {
  resetFirebaseMock();
}

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

export interface TestPerson {
  uid: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin';
  token: string;
}

/**
 * Register a person: a `users/{uid}` document plus a token that decodes to
 * them. The token is what the real `plugins/auth.ts` will verify.
 */
export function seedPerson(person: {
  uid: string;
  email: string;
  displayName: string;
  role?: 'member' | 'admin';
  registeredContestIds?: string[];
}): TestPerson {
  const role = person.role ?? 'member';
  const at = new Date(FAKE_NOW);
  const user: Omit<User, 'uid'> = {
    email: person.email,
    displayName: person.displayName,
    role,
    registeredContestIds: person.registeredContestIds ?? [CONTEST_ID],
    createdAt: at,
    lastSeenAt: at,
  };
  fakeDb.seed(COLLECTIONS.users, person.uid, user as unknown as Record<string, unknown>);
  return {
    uid: person.uid,
    email: person.email,
    displayName: person.displayName,
    role,
    token: mintToken({
      uid: person.uid,
      email: person.email,
      email_verified: true,
      name: person.displayName,
      admin: role === 'admin',
    }),
  };
}

/** A token for an identity that has no `users/` document yet. */
export function tokenFor(claims: FakeTokenClaims): string {
  return mintToken(claims);
}

// ---------------------------------------------------------------------------
// Contest
// ---------------------------------------------------------------------------

export interface SeedContestOptions {
  id?: string;
  title?: string;
  code?: string;
  phase?: Contest['phaseOverride'];
  showLiveStandings?: boolean;
  minBallotsToPublish?: number;
  resultsPublishedAt?: Date | null;
  aliasesAssignedAt?: Date | null;
  submissionsCloseAt?: Date | null;
  votingOpensAt?: Date | null;
  votingClosesAt?: Date | null;
}

export function seedContest(options: SeedContestOptions = {}): void {
  const base = new Date(FAKE_NOW).getTime();
  const day = 24 * 60 * 60 * 1000;
  const id = options.id ?? CONTEST_ID;
  const contest: Omit<Contest, 'id'> = {
    title: options.title ?? 'Media Moguls (North 7) Logo Contest',
    description: 'Pick the shirt.',
    code: options.code ?? 'NORTH7',
    phaseOverride: options.phase ?? null,
    submissionsOpenAt: new Date(base - 30 * day),
    submissionsCloseAt: options.submissionsCloseAt === undefined ? new Date(base - 10 * day) : options.submissionsCloseAt,
    votingOpensAt: options.votingOpensAt === undefined ? new Date(base - 5 * day) : options.votingOpensAt,
    votingClosesAt: options.votingClosesAt === undefined ? new Date(base + 5 * day) : options.votingClosesAt,
    resultsPublishedAt: options.resultsPublishedAt ?? null,
    maxRanks: 5,
    allowSelfVote: true,
    showLiveStandings: options.showLiveStandings ?? true,
    minBallotsToPublish: options.minBallotsToPublish ?? 5,
    tieBreakSeed: TIE_BREAK_SEED,
    aliasesAssignedAt: options.aliasesAssignedAt === undefined ? new Date(base - 10 * day) : options.aliasesAssignedAt,
    createdBy: 'u-founder',
    createdAt: new Date(base - 40 * day),
    updatedAt: new Date(base - 40 * day),
  };
  fakeDb.seed(COLLECTIONS.contests, id, contest as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export interface SeedSubmissionOptions {
  id: string;
  ownerUid: string;
  alias?: string | null;
  title?: string;
  description?: string;
  status?: Submission['status'];
  createdAt?: Date;
  creditOptIn?: boolean;
  contentHash?: string;
  storagePrefix?: string;
}

export function seedSubmission(options: SeedSubmissionOptions): void {
  const createdAt = options.createdAt ?? new Date(FAKE_NOW);
  const prefix = options.storagePrefix ?? `submissions/${CONTEST_ID}/${options.id}-prefix`;
  const doc: Omit<Submission, 'id'> = {
    contestId: CONTEST_ID,
    ownerUid: options.ownerUid,
    alias: options.alias ?? null,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined ? {} : { description: options.description }),
    creditOptIn: options.creditOptIn ?? false,
    originalPath: `${prefix}/original.png`,
    displayPath: `${prefix}/display.webp`,
    thumbPath: `${prefix}/thumb.webp`,
    width: 1024,
    height: 1024,
    bytes: 4096,
    contentHash: options.contentHash ?? `hash-${options.id}`,
    status: options.status ?? 'active',
    createdAt,
    updatedAt: createdAt,
  } as unknown as Omit<Submission, 'id'>;
  fakeDb.seed(COLLECTIONS.submissions, options.id, doc as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Ballots
// ---------------------------------------------------------------------------

export function seedBallot(voterUid: string, ranking: readonly string[], at: Date = new Date(FAKE_NOW)): void {
  const ballot: Ballot = {
    contestId: CONTEST_ID,
    voterUid,
    ranking: [...ranking],
    createdAt: at,
    updatedAt: at,
  };
  fakeDb.seed(COLLECTIONS.ballots, ballotDocId(CONTEST_ID, voterUid), ballot as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Result snapshots
// ---------------------------------------------------------------------------

export interface SeedResultOptions {
  winnerSubmissionId: string;
  eliminationOrder: readonly string[];
  totalBallots?: number;
  published?: boolean;
  isProjection?: boolean;
  computedBy?: string;
  /** Force an admin-override tie-break into the snapshot. */
  decidedByUid?: string | null;
  tallies?: Record<string, number>;
}

export function seedResultSnapshot(options: SeedResultOptions): void {
  const tallies = options.tallies ?? { [options.winnerSubmissionId]: 5 };
  const snapshot: ResultSnapshot = {
    contestId: CONTEST_ID,
    winnerSubmissionId: options.winnerSubmissionId,
    rounds: [
      {
        round: 1,
        tallies,
        activeBallots: options.totalBallots ?? 6,
        exhaustedBallots: 0,
        eliminated: null,
        transfer: null,
        tieBreak:
          options.decidedByUid === undefined
            ? null
            : {
                tiedCandidates: [...options.eliminationOrder].slice(0, 2),
                reason: 'admin_override',
                eliminated: options.eliminationOrder[0] ?? options.winnerSubmissionId,
                decidedByUid: options.decidedByUid,
              },
        winner: options.winnerSubmissionId,
      },
    ],
    totalBallots: options.totalBallots ?? 6,
    exhaustedFinal: 0,
    eliminationOrder: [...options.eliminationOrder],
    tieBreakSeed: TIE_BREAK_SEED,
    computedAt: new Date(FAKE_NOW),
    computedBy: options.computedBy ?? 'u-admin-who-computed',
    published: options.published ?? true,
    isProjection: options.isProjection ?? false,
  };
  const id = options.isProjection ? `${CONTEST_ID}__projection` : CONTEST_ID;
  fakeDb.seed(COLLECTIONS.results, id, snapshot as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export interface InjectOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  token?: string | null;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface InjectedResponse {
  status: number;
  /** The raw response body, exactly as it went on the wire. */
  raw: string;
  /** Parsed JSON, or `undefined` when the body is not JSON. */
  json: unknown;
  headers: Record<string, unknown>;
}

/** Issue a request and keep BOTH the raw bytes and the parsed body. */
export async function call(app: FastifyInstance, options: InjectOptions): Promise<InjectedResponse> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.payload !== undefined) headers['content-type'] ??= 'application/json';

  const response = await app.inject({
    method: options.method ?? 'GET',
    url: options.url,
    headers,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
  });

  const raw = response.body;
  let json: unknown;
  try {
    json = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.statusCode, raw, json, headers: response.headers as Record<string, unknown> };
}

/** The `code` field of an `ApiErrorBody`, or null if the body is not one. */
export function errorCode(response: InjectedResponse): string | null {
  const body = response.json;
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { code?: unknown } }).error;
    if (error && typeof error === 'object' && typeof error.code === 'string') return error.code;
  }
  if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route enumeration
// ---------------------------------------------------------------------------

export interface RegisteredRoute {
  method: string;
  url: string;
}

/**
 * Every route Fastify actually has, read out of its own router.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY ENUMERATE INSTEAD OF HAND-LISTING
 *
 * A hand-written list of admin routes protects only the routes somebody
 * remembered to add to it. The route that gets forgotten is, by construction,
 * the one nobody was thinking carefully about — exactly the one most likely to
 * be missing its `requireAdmin`. Reading the router means a new
 * `/api/admin/**` route is covered by the authorisation tests on the day it is
 * written, whether or not its author ever opens this file.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `printRoutes` renders a TREE, so a nested path is split across lines:
 *
 *     ├── /api/admin/submissions (GET, HEAD)
 *     │   ├── /:id/disqualify (POST)
 *
 * The child carries only its own suffix, so the full URL has to be rebuilt
 * from the indentation. Getting this wrong would silently shrink the set of
 * routes under test, so `anonymity-authorization.test.ts` cross-checks the
 * result against a handful of URLs known to exist.
 */
export function registeredRoutes(app: FastifyInstance): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const prefixAtDepth: string[] = [];

  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const marker = /[├└]──\s/.exec(line);
    if (!marker) continue;
    // Each nesting level is rendered as a 4-character gutter ("│   " or "    ").
    const depth = Math.floor(marker.index / 4);
    const rest = line.slice(marker.index + marker[0].length);

    const parsed = /^(\S+)\s+\(([A-Z, ]+)\)\s*$/.exec(rest.trim());
    if (!parsed) continue;
    const [, segment, methodList] = parsed;
    if (!segment || !methodList) continue;
    // CORS installs a wildcard OPTIONS handler that is not a real route.
    if (segment === '*' || (!segment.startsWith('/') && depth === 0)) continue;

    const url = depth === 0 ? segment : `${prefixAtDepth[depth - 1] ?? ''}${segment}`;
    prefixAtDepth[depth] = url;
    prefixAtDepth.length = depth + 1;

    for (const method of methodList.split(',').map((m) => m.trim())) {
      if (method.length > 0) routes.push({ method, url });
    }
  }
  return routes;
}
