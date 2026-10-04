/**
 * Create the initial contest document in a LIVE project.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API reads exactly one contest per deployment (`DEFAULT_CONTEST_ID`) and
 * throws NOT_FOUND if it is absent — but nothing in the API ever CREATES one.
 * `PATCH /admin/contest` updates an existing document; there is no POST. The
 * emulator seed script papers over this locally, so an empty production
 * Firestore is the first place it shows up: every page fails with "That
 * contest does not exist" and the admin UI cannot fix it, because the admin UI
 * also needs the contest to load first.
 *
 * This script is the bootstrap. Run it ONCE per deployment.
 *
 * The durable fix is to make the API able to create a contest — see the note
 * at the end of this file.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcloud-config/application_default_credentials.json \
 *   npx tsx scripts/create-contest.ts --project n7-logo-contest \
 *     --contest-id media-moguls-2026 --admin-email saurabhma@google.com
 *
 * Idempotent: refuses to overwrite an existing contest unless --force.
 */
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1] as string;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing required --${name}`);
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Days from now, at a tidy hour in the admin's local time. */
function daysFromNow(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main(): Promise<void> {
  const projectId = arg('project');
  const contestId = arg('contest-id');
  const adminEmail = arg('admin-email');
  const submissionDays = Number(arg('submission-days', '7'));
  const votingDays = Number(arg('voting-days', '7'));

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  const db = getFirestore();
  const auth = getAuth();

  // Attribute the record to the real admin account rather than a placeholder.
  // They have signed in already (that is how they became admin), so the user
  // record exists.
  let createdBy = adminEmail;
  try {
    const user = await auth.getUserByEmail(adminEmail);
    createdBy = user.uid;
    console.log(`resolved ${adminEmail} -> uid ${user.uid}`);
  } catch {
    console.log(`WARNING: no Firebase user for ${adminEmail} yet; recording the email instead.`);
    console.log('         (sign in once first if you want the uid attributed properly)');
  }

  const ref = db.collection('contests').doc(contestId);
  const existing = await ref.get();
  if (existing.exists && !has('force')) {
    console.log(`\nContest "${contestId}" already exists. Nothing to do.`);
    console.log('Pass --force to overwrite it (this resets dates and settings, NOT entries or ballots).');
    return;
  }

  const now = new Date();
  const submissionsCloseAt = daysFromNow(submissionDays, 17); // 5pm local
  const votingClosesAt = daysFromNow(submissionDays + votingDays, 17);

  // Sequential windows, deliberately: voting opens exactly when submissions
  // close, so no one votes before they have seen every entry.
  const contest = {
    id: contestId,
    title: 'Media Moguls (North 7) Logo Design Contest',
    description:
      'Upload one logo, then rank your top five. The winner goes on the team shirt. ' +
      'Entries are anonymous — nobody can see who submitted what, and nobody can see how anyone voted.',

    phaseOverride: null,
    submissionsOpenAt: Timestamp.fromDate(now),
    submissionsCloseAt: Timestamp.fromDate(submissionsCloseAt),
    votingOpensAt: Timestamp.fromDate(submissionsCloseAt),
    votingClosesAt: Timestamp.fromDate(votingClosesAt),
    resultsPublishedAt: null,

    maxRanks: 5,
    allowSelfVote: true,
    showLiveStandings: true,
    minBallotsToPublish: 5,

    // Persisted so any recount reproduces identical tie-breaks. Generated once,
    // here, and never regenerated — regenerating it would silently change who
    // wins a tied elimination.
    tieBreakSeed: randomBytes(16).toString('hex'),

    // Assigned when submissions close, in shuffled order, so entry numbers
    // cannot leak who uploaded when.
    aliasesAssignedAt: null,

    createdBy,
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
  };

  await ref.set(contest);

  console.log(`\nCreated contests/${contestId}`);
  console.log(`  submissions open   ${now.toLocaleString()}`);
  console.log(`  submissions close  ${submissionsCloseAt.toLocaleString()}`);
  console.log(`  voting opens       ${submissionsCloseAt.toLocaleString()}`);
  console.log(`  voting closes      ${votingClosesAt.toLocaleString()}`);
  console.log(`  self-voting        allowed`);
  console.log(`  live standings     public during voting`);
  console.log(`  min ballots        5`);
  console.log('\nAdjust any of this in the app under Admin -> Timeline.');
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * THE DURABLE FIX
 * ---------------
 * This script should not be needed twice. The API should be able to create a
 * contest when none exists, so a fresh deployment is self-sufficient. Two
 * reasonable options:
 *
 *   1. Make `PATCH /admin/contest` an upsert: if the document is missing,
 *      create it from defaults plus the submitted fields. Smallest change, and
 *      it makes the existing admin Timeline form work on a fresh project with
 *      no new UI at all.
 *
 *   2. Add `POST /api/admin/contest` plus a "create your contest" empty state
 *      in the admin console. More explicit, and better if multiple contests
 *      are ever supported.
 *
 * Option 1 is the better trade today: the app is deliberately one-contest, and
 * the admin form already collects every field a new contest needs.
 */
