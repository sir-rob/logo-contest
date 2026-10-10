/**
 * Non-destructive migration for the existing North 7 Logo Contest (`media-moguls-2026`).
 *
 * Ensures:
 *   1. The `contests/media-moguls-2026` document has a `code` field (defaulting
 *      to `NORTH7` if not already set).
 *   2. Every existing user document in `users/*` has `media-moguls-2026` in
 *      their `registeredContestIds` array so they retain full access to the
 *      North 7 Logo Contest on their home page without needing to re-register.
 *
 * Usage:
 *   npx tsx scripts/migrate-north7-users.ts --project n7-logo-contest
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1] as string;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing required --${name}`);
}

async function main(): Promise<void> {
  const projectId = arg('project', 'n7-logo-contest');
  const contestId = arg('contest-id', 'media-moguls-2026');
  const defaultCode = arg('code', 'NORTH7').trim().toUpperCase();

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  const db = getFirestore();

  console.log(`Migrating project "${projectId}" for contest "${contestId}"...`);

  // 1. Ensure contest document has `code`
  const contestRef = db.collection('contests').doc(contestId);
  const contestSnap = await contestRef.get();
  if (!contestSnap.exists) {
    console.warn(`WARNING: contests/${contestId} does not exist in project ${projectId}.`);
  } else {
    const data = contestSnap.data() ?? {};
    if (typeof data['code'] !== 'string' || data['code'].trim().length === 0) {
      await contestRef.update({ code: defaultCode });
      console.log(`Updated contests/${contestId} with code="${defaultCode}".`);
    } else {
      console.log(`contests/${contestId} already has code="${String(data['code'])}".`);
    }
  }

  // 2. Ensure every existing user has `contestId` in `registeredContestIds`
  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} user document(s) in Firestore.`);

  let updatedCount = 0;
  let alreadyRegisteredCount = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const existingIds = Array.isArray(data['registeredContestIds'])
      ? (data['registeredContestIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    if (existingIds.includes(contestId)) {
      alreadyRegisteredCount += 1;
      console.log(`  [ok] ${userDoc.id} (${String(data['email'] ?? '')}) already registered for ${contestId}`);
      continue;
    }

    await userDoc.ref.update({
      registeredContestIds: FieldValue.arrayUnion(contestId),
    });
    updatedCount += 1;
    console.log(`  [migrated] ${userDoc.id} (${String(data['email'] ?? '')}) -> added ${contestId}`);
  }

  console.log(
    `\nMigration complete: ${updatedCount} user(s) updated, ${alreadyRegisteredCount} already registered.`,
  );
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
