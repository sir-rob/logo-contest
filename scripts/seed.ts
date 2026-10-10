/**
 * Seed the local Firebase emulators with a believable contest.
 *
 *   npx tsx scripts/seed.ts --phase=voting --users=20 --preset=normal
 *   npx tsx scripts/seed.ts --preset=tie --users=12
 *   npx tsx scripts/seed.ts --reset
 *
 * This file is the I/O shell and nothing else: argument parsing, Auth/Firestore
 * /Storage writes, and a readable summary. Every decision about *what* the data
 * should look like lives in `seed-data.ts`, which is pure and unit-tested.
 *
 * SAFETY: the script refuses to run unless `FIRESTORE_EMULATOR_HOST` is set.
 * See `assertEmulatorOnly` below — a seed script that can be pointed at
 * production is a loaded gun, and `--reset` is the trigger.
 */

import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

import sharp from 'sharp';
import type { Firestore } from 'firebase-admin/firestore';

import {
  BallotSchema,
  COLLECTIONS,
  ContestSchema,
  DISPLAY_SIZE,
  MAX_RANKS,
  SubmissionSchema,
  THUMB_SIZE,
  UserSchema,
  derivePhase,
  validateContestDates,
  type Ballot,
  type Contest,
  type Submission,
  type User,
} from '@contest/shared';

import { loadConfig, type AppConfig } from '../apps/api/src/config.js';
import { getAdminAuth, getBucket, getDb } from '../apps/api/src/firebase.js';
import { ballotDoc, contestDoc, submissionDoc, userDoc } from '../apps/api/src/db/collections.js';
import {
  EXHAUSTING_SHORT_BALLOT_SHARE,
  FIXED_TIE_BREAK_SEED,
  LOGO_ORIGINAL_SIZE,
  PRESETS,
  SEED_PHASES,
  assertTieGuaranteed,
  assignAliases,
  countShortBallots,
  generateBallots,
  generateContestDates,
  generateSubmissionContents,
  generateUsers,
  isPreset,
  isSeedPhase,
  makeRng,
  phaseHasAliases,
  phaseHasBallots,
  renderLogoPixels,
  simulateIrv,
  uuidFrom,
  type Preset,
  type SeedBallot,
  type SeedPhase,
  type SeedUser,
} from './seed-data.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_SEED = 'north7-seed-v1';

interface Options {
  users: number;
  phase: SeedPhase;
  preset: Preset;
  ballots: number;
  reset: boolean;
  resetOnly: boolean;
  seed: string;
}

const USAGE = `
Seed the Firebase emulators with a full contest fixture.

  npx tsx scripts/seed.ts [options]

  --users=N          Members to create (default 20; the real contest is 10-25).
  --phase=PHASE      ${SEED_PHASES.join(' | ')}   (default voting)
                     Sets real contest dates so derivePhase yields this phase
                     against the real clock — no fake clock needed.
  --preset=PRESET    ${PRESETS.join(' | ')}   (default normal)
                     Ballot distribution. "tie" is arithmetically guaranteed
                     to produce both a mid-count and a final-round tie.
  --ballots=N        How many members actually vote (default: users - 2).
  --seed=STRING      PRNG seed (default "${DEFAULT_SEED}"). Same seed in,
                     same contest out.
  --reset            Wipe the emulator collections and stored images first.
  --reset-only       Wipe and stop.
  --help             This text.
`.trim();

function parseOptions(argv: readonly string[]): Options | null {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    options: {
      users: { type: 'string' },
      phase: { type: 'string' },
      preset: { type: 'string' },
      ballots: { type: 'string' },
      seed: { type: 'string' },
      reset: { type: 'boolean', default: false },
      'reset-only': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help === true) {
    console.log(USAGE);
    return null;
  }

  const users = parseCount(values.users, 20, 'users');
  if (users < 1) throw new Error('--users must be at least 1');

  const phaseRaw = values.phase ?? 'voting';
  if (!isSeedPhase(phaseRaw)) {
    throw new Error(`--phase must be one of: ${SEED_PHASES.join(', ')} (got "${phaseRaw}")`);
  }
  const presetRaw = values.preset ?? 'normal';
  if (!isPreset(presetRaw)) {
    throw new Error(`--preset must be one of: ${PRESETS.join(', ')} (got "${presetRaw}")`);
  }

  // Leaving a couple of people un-voted gives the turnout indicator something
  // to actually show.
  const ballots = parseCount(values.ballots, Math.max(0, users - 2), 'ballots');
  if (ballots > users) throw new Error(`--ballots=${ballots} exceeds --users=${users}`);

  const resetOnly = values['reset-only'] === true;
  return {
    users,
    phase: phaseRaw,
    preset: presetRaw,
    ballots,
    reset: values.reset === true || resetOnly,
    resetOnly,
    seed: values.seed ?? DEFAULT_SEED,
  };
}

function parseCount(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * The one non-negotiable check in this file.
 *
 * Everything below deletes documents, overwrites user records and uploads
 * images under well-known paths. Pointed at a real project it would erase a
 * live contest, and it would do so quietly, because firebase-admin is perfectly
 * happy to authenticate against production from a developer laptop.
 *
 * `FIRESTORE_EMULATOR_HOST` is the only signal that cannot be faked by accident:
 * firebase-admin *only* talks to the emulator when it is set, so requiring it
 * makes "seed production" structurally impossible rather than merely discouraged.
 */
function assertEmulatorOnly(config: AppConfig): void {
  const host = process.env['FIRESTORE_EMULATOR_HOST'];
  if (!host) {
    throw new Error(
      'Refusing to run: FIRESTORE_EMULATOR_HOST is not set.\n' +
        'This script writes and deletes contest data wholesale and is for the local\n' +
        'emulator suite only. Start the emulators and load the local env:\n' +
        '  npm run emulators\n' +
        '  set -a && . ./.env.local && set +a && npx tsx scripts/seed.ts',
    );
  }
  if (config.isProduction) {
    throw new Error('Refusing to run: NODE_ENV=production.');
  }
  if (!config.useEmulators) {
    throw new Error('Refusing to run: config did not resolve to emulator mode.');
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** A point `t` of the way through a window, never in the future. */
function within(start: Date, end: Date, t: number, ceiling: Date): Date {
  const ms = start.getTime() + (end.getTime() - start.getTime()) * t;
  return new Date(Math.min(ms, ceiling.getTime() - 60_000));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

const RESETTABLE = [
  COLLECTIONS.users,
  COLLECTIONS.contests,
  COLLECTIONS.submissions,
  COLLECTIONS.ballots,
  COLLECTIONS.results,
  COLLECTIONS.auditLogs,
] as const;

async function deleteCollection(db: Firestore, name: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await db.collection(name).limit(300).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
  }
}

async function resetEmulator(config: AppConfig): Promise<void> {
  const db = getDb(config);
  console.log('Resetting emulator data…');
  for (const name of RESETTABLE) {
    const n = await deleteCollection(db, name);
    console.log(`  ${name.padEnd(12)} ${plural(n, 'document')} deleted`);
  }

  if (config.emulators.auth) {
    const auth = getAdminAuth(config);
    let removed = 0;
    for (;;) {
      const page = await auth.listUsers(1000);
      if (page.users.length === 0) break;
      await auth.deleteUsers(page.users.map((u) => u.uid));
      removed += page.users.length;
      if (page.users.length < 1000) break;
    }
    console.log(`  auth         ${plural(removed, 'account')} deleted`);
  }

  if (config.emulators.storage) {
    try {
      await getBucket(config).deleteFiles({ prefix: 'submissions/' });
      console.log('  storage      submissions/ cleared');
    } catch (err) {
      // The storage emulator is optional for a Firestore-only workflow.
      console.log(`  storage      skipped (${(err as Error).message})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface AuthError {
  code?: string;
}

/**
 * Create (or refresh) the emulator Auth account for a seeded member.
 *
 * Idempotent: re-running the seed with the same `--seed` must not explode on
 * accounts that already exist, and must not leave a stale account holding the
 * email we want.
 */
async function upsertAuthUser(user: SeedUser, config: AppConfig): Promise<void> {
  const auth = getAdminAuth(config);
  const payload = {
    uid: user.uid,
    email: user.email,
    emailVerified: true,
    displayName: user.displayName,
  };

  try {
    await auth.createUser(payload);
  } catch (err) {
    const code = (err as AuthError).code;
    if (code === 'auth/uid-already-exists') {
      await auth.updateUser(user.uid, {
        email: user.email,
        emailVerified: true,
        displayName: user.displayName,
      });
    } else if (code === 'auth/email-already-exists') {
      // Same address, different uid — from an earlier seed with other options.
      const existing = await auth.getUserByEmail(user.email);
      await auth.deleteUser(existing.uid);
      await auth.createUser(payload);
    } else {
      throw err;
    }
  }

  // The API reads `admin` from the token claims (see plugins/auth.ts) as well
  // as the user document, so the bootstrap admin needs both.
  await auth.setCustomUserClaims(user.uid, user.role === 'admin' ? { admin: true } : {});
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

interface RenditionSet {
  original: Buffer;
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  contentHash: string;
}

/**
 * Paint one placeholder logo and derive the two renditions the app serves.
 * The original is deliberately larger than DISPLAY_SIZE so the resize is a
 * genuine downscale, exercising the same path a real upload takes.
 */
async function renderRenditions(index: number): Promise<RenditionSet> {
  const raw = renderLogoPixels(index);
  const original = await sharp(Buffer.from(raw.data), {
    raw: { width: raw.width, height: raw.height, channels: raw.channels },
  })
    .resize(LOGO_ORIGINAL_SIZE, LOGO_ORIGINAL_SIZE, { kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const display = await sharp(original)
    .resize(DISPLAY_SIZE, DISPLAY_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer();

  const thumb = await sharp(original)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  return {
    original,
    display,
    thumb,
    width: LOGO_ORIGINAL_SIZE,
    height: LOGO_ORIGINAL_SIZE,
    contentHash: sha256(original),
  };
}

async function uploadRenditions(
  config: AppConfig,
  basePath: string,
  set: RenditionSet,
): Promise<void> {
  const bucket = getBucket(config);
  const files: [string, Buffer, string][] = [
    [`${basePath}/original.png`, set.original, 'image/png'],
    [`${basePath}/display.webp`, set.display, 'image/webp'],
    [`${basePath}/thumb.webp`, set.thumb, 'image/webp'],
  ];
  for (const [path, body, contentType] of files) {
    await bucket.file(path).save(body, {
      resumable: false,
      contentType,
      // Private bucket: images are only ever served through signed URLs.
      metadata: { cacheControl: 'private, max-age=0' },
    });
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

interface SeededSubmission {
  id: string;
  ownerUid: string;
  storagePrefix: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options === null) return;

  // Load `.env.local` if it is there, without making dotenv a hard dependency
  // of this script. `node --env-file=.env.local` works just as well.
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '.env.local', override: false });
  } catch {
    // No dotenv: rely on the ambient environment.
  }

  const config = loadConfig();
  assertEmulatorOnly(config);

  if (options.reset) await resetEmulator(config);
  if (options.resetOnly) {
    console.log('\nReset complete. Nothing seeded (--reset-only).');
    return;
  }

  const rng = makeRng(options.seed);
  const clock = new Date();
  const db = getDb(config);
  const contestId = config.defaultContestId;

  // --- people -------------------------------------------------------------
  const generated = generateUsers(options.users, rng);
  const adminEmail = config.bootstrapAdminEmail ?? generated[0]?.email ?? 'admin@google.com';
  const users: SeedUser[] = generated.map((u, i) =>
    i === 0 ? { ...u, email: adminEmail, role: 'admin' } : u,
  );

  const dates = generateContestDates(options.phase, clock);
  const dateErrors = validateContestDates(dates);
  if (dateErrors.length > 0) {
    throw new Error(`generated contest dates are incoherent: ${dateErrors.join(' ')}`);
  }

  console.log(`Seeding contest "${contestId}" — phase ${options.phase}, preset ${options.preset}`);
  console.log(`  seed=${options.seed}  users=${options.users}  ballots=${options.ballots}`);

  for (const [i, user] of users.entries()) {
    await upsertAuthUser(user, config);
    const doc: User = UserSchema.parse({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      registeredContestIds: [contestId],
      createdAt: within(
        new Date(dates.submissionsOpenAt.getTime() - 5 * 86_400_000),
        dates.submissionsOpenAt,
        (i + 1) / (users.length + 1),
        clock,
      ),
      lastSeenAt: new Date(clock.getTime() - Math.floor(rng() * 6 * 3_600_000)),
    });
    await userDoc(user.uid, db).set(doc);
  }
  console.log(`  ${plural(users.length, 'member')} created in Auth + Firestore`);

  // --- entries ------------------------------------------------------------
  const contents = generateSubmissionContents(users, rng);
  const submissions: SeededSubmission[] = users.map((user) => ({
    id: uuidFrom(rng),
    ownerUid: user.uid,
    storagePrefix: '',
  }));
  const submissionIds = submissions.map((s) => s.id);
  const aliases = phaseHasAliases(options.phase)
    ? assignAliases(submissionIds, rng)
    : new Map<string, string>();

  for (const [i, entry] of submissions.entries()) {
    // Path under a random-looking uuid, never anything derived from the person.
    entry.storagePrefix = `submissions/${contestId}/${entry.id}`;
    const set = await renderRenditions(i);
    await uploadRenditions(config, entry.storagePrefix, set);

    const content = contents[i];
    const createdAt = within(
      dates.submissionsOpenAt,
      dates.submissionsCloseAt,
      (i + 0.5) / users.length,
      clock,
    );
    const doc: Submission = SubmissionSchema.parse({
      id: entry.id,
      contestId,
      ownerUid: entry.ownerUid,
      alias: aliases.get(entry.id) ?? null,
      title: content?.title,
      description: content?.description,
      creditOptIn: content?.creditOptIn ?? false,
      originalPath: `${entry.storagePrefix}/original.png`,
      displayPath: `${entry.storagePrefix}/display.webp`,
      thumbPath: `${entry.storagePrefix}/thumb.webp`,
      width: set.width,
      height: set.height,
      bytes: set.original.byteLength,
      contentHash: set.contentHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    });
    await submissionDoc(entry.id, db).set(doc);
    process.stdout.write(`\r  rendering + uploading entries… ${i + 1}/${submissions.length}`);
  }
  process.stdout.write('\n');
  console.log(
    `  ${plural(submissions.length, 'entry', 'entries')} uploaded` +
      `${aliases.size > 0 ? ' and aliased' : ' (aliases withheld until voting)'}`,
  );

  // --- contest ------------------------------------------------------------
  const contest: Contest = ContestSchema.parse({
    id: contestId,
    title: 'Media Moguls (North 7) Logo Design Contest',
    description:
      'Design the logo for Media Moguls (North 7). One entry each, ranked-choice vote, ' +
      'anonymous until the results are published.',
    phaseOverride: null,
    submissionsOpenAt: dates.submissionsOpenAt,
    submissionsCloseAt: dates.submissionsCloseAt,
    votingOpensAt: dates.votingOpensAt,
    votingClosesAt: dates.votingClosesAt,
    resultsPublishedAt: dates.resultsPublishedAt,
    maxRanks: MAX_RANKS,
    allowSelfVote: true,
    showLiveStandings: true,
    minBallotsToPublish: 5,
    tieBreakSeed: FIXED_TIE_BREAK_SEED,
    aliasesAssignedAt: phaseHasAliases(options.phase) ? dates.submissionsCloseAt : null,
    createdBy: users[0]?.uid ?? 'seeduser-01',
    createdAt: within(
      new Date(dates.submissionsOpenAt.getTime() - 7 * 86_400_000),
      dates.submissionsOpenAt,
      0.2,
      clock,
    ),
    updatedAt: clock,
  });
  await contestDoc(contestId, db).set(contest);
  console.log(`  contest document written (tieBreakSeed=${FIXED_TIE_BREAK_SEED})`);

  // --- ballots ------------------------------------------------------------
  let ballots: SeedBallot[] = [];
  if (phaseHasBallots(options.phase) && options.ballots > 0) {
    const voters = users.slice(0, options.ballots);
    ballots = generateBallots(options.preset, voters, submissionIds, rng);

    // Verified again here, outside the generator, because the promise this
    // preset makes is the whole reason it exists.
    if (options.preset === 'tie') assertTieGuaranteed(ballots, submissionIds);

    const votingStart = dates.votingOpensAt;
    for (const [i, ballot] of ballots.entries()) {
      const castAt = within(votingStart, dates.votingClosesAt, (i + 0.5) / ballots.length, clock);
      const doc: Ballot = BallotSchema.parse({
        contestId,
        voterUid: ballot.voterUid,
        ranking: ballot.ranking,
        createdAt: castAt,
        updatedAt: castAt,
      });
      // Keyed `contestId_uid` (see ballotDocId) so re-seeding replaces a
      // person's ballot instead of giving them a second one.
      await ballotDoc(contestId, ballot.voterUid, db).set(doc);
    }
    console.log(`  ${plural(ballots.length, 'ballot')} cast (${options.preset})`);
  } else if (!phaseHasBallots(options.phase)) {
    console.log('  no ballots — voting has not opened in this phase');
  }

  printSummary({ options, users, adminEmail, ballots, submissionIds, aliases, clock, dates, config });
}

interface SummaryInput {
  options: Options;
  users: readonly SeedUser[];
  adminEmail: string;
  ballots: readonly SeedBallot[];
  submissionIds: readonly string[];
  aliases: ReadonlyMap<string, string>;
  clock: Date;
  dates: ReturnType<typeof generateContestDates>;
  config: AppConfig;
}

function printSummary(input: SummaryInput): void {
  const { options, users, adminEmail, ballots, submissionIds, aliases, clock, dates, config } = input;
  const derived = derivePhase({ ...dates, phaseOverride: null }, clock);
  const label = (id: string): string => aliases.get(id) ?? id.slice(0, 8);

  console.log('\n' + '─'.repeat(72));
  console.log(`Contest ......... ${config.defaultContestId}`);
  console.log(`Phase ........... ${derived}  (requested: ${options.phase})`);
  if (derived.toLowerCase() !== expectedPhaseName(options.phase)) {
    console.log('  ⚠ derived phase does not match the request — check the system clock');
  }
  console.log(`Members ......... ${users.length}`);
  console.log(`Entries ......... ${submissionIds.length}`);
  console.log(`Ballots ......... ${ballots.length}  (preset: ${options.preset})`);
  console.log(`PRNG seed ....... ${options.seed}`);
  console.log(`Admin sign-in ... ${adminEmail}`);
  console.log(
    `Windows ......... submissions ${dates.submissionsOpenAt.toISOString()} → ` +
      `${dates.submissionsCloseAt.toISOString()}\n` +
      `                  voting      ${dates.votingOpensAt.toISOString()} → ` +
      `${dates.votingClosesAt.toISOString()}`,
  );

  if (ballots.length > 0) {
    const check = simulateIrv(ballots, [...submissionIds]);
    console.log(
      `Count preview ... ${check.rounds} rounds, ${check.exhaustedAtEnd} exhausted, ` +
        `${check.winner === null ? 'no outright winner' : `winner ${label(check.winner)}`}`,
    );
    if (check.finalTie) {
      console.log(
        `TIE (final) ..... ${check.finalTie.candidates.map(label).join('  vs  ')} ` +
          `at ${check.finalTie.votes} votes each`,
      );
    }
    for (const tie of check.eliminationTies.filter((t) => t.remaining > 2)) {
      console.log(
        `TIE (round ${tie.round}) . ${tie.candidates.map(label).join(', ')} ` +
          `tied for elimination on ${tie.votes} votes`,
      );
    }
    if (options.preset === 'exhausting') {
      const short = countShortBallots(ballots);
      console.log(
        `Short ballots ... ${short}/${ballots.length} ` +
          `(target ${Math.round(EXHAUSTING_SHORT_BALLOT_SHARE * 100)}%)`,
      );
    }
  }

  console.log('\nSign in as any of these (magic link, @google.com only):');
  for (const user of users) {
    console.log(`  ${user.role === 'admin' ? '★' : ' '} ${user.email.padEnd(34)} ${user.displayName}`);
  }
  console.log(
    '\nThe Auth emulator does not send mail. Request a link in the app, then read it from\n' +
      `  http://${config.emulators.auth ?? 'localhost:9099'}` +
      `/emulator/v1/projects/${config.projectId}/oobCodes\n` +
      'or from the Authentication tab of the emulator UI (http://localhost:4000).',
  );
  console.log('─'.repeat(72));
}

/** `SUBMISSIONS_OPEN` ↔ `submissions`, for the sanity line in the summary. */
function expectedPhaseName(phase: SeedPhase): string {
  switch (phase) {
    case 'setup':
      return 'setup';
    case 'submissions':
      return 'submissions_open';
    case 'voting':
      return 'voting_open';
    case 'closed':
      return 'closed';
    case 'results':
      return 'results_published';
  }
}

main().catch((err: unknown) => {
  console.error(`\nseed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
