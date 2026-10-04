/**
 * firebase-admin initialisation.
 *
 * One initialisation for the whole process, emulator-aware. When the emulator
 * host variables are present, firebase-admin picks them up from the
 * environment automatically — we only need to make sure we do NOT hand it real
 * credentials, which is what `applicationDefault()` would try to fetch (and
 * fail to, offline).
 */

import { cert, getApps, initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Bucket } from '@google-cloud/storage';
import { getConfig, type AppConfig } from './config.js';

let app: App | null = null;

export function getFirebaseApp(config: AppConfig = getConfig()): App {
  if (app) return app;

  const existing = getApps();
  if (existing.length > 0 && existing[0]) {
    app = existing[0];
    return app;
  }

  if (config.useEmulators) {
    // The emulators accept any project id and ignore credentials entirely.
    app = initializeApp({
      projectId: config.projectId,
      storageBucket: config.storageBucket,
    });
    return app;
  }

  const saJson = process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON'];
  app = initializeApp({
    credential: saJson ? cert(JSON.parse(saJson) as Record<string, string>) : applicationDefault(),
    projectId: config.projectId,
    storageBucket: config.storageBucket,
  });
  return app;
}

let firestore: Firestore | null = null;

export function getDb(config: AppConfig = getConfig()): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(getFirebaseApp(config));
  try {
    // `undefined` fields are a constant source of accidental writes; drop them
    // rather than throwing mid-transaction.
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() throws if called twice or after first use — harmless here.
  }
  return firestore;
}

export function getAdminAuth(config: AppConfig = getConfig()): Auth {
  return getAuth(getFirebaseApp(config));
}

export function getBucket(config: AppConfig = getConfig()): Bucket {
  return getStorage(getFirebaseApp(config)).bucket(config.storageBucket) as unknown as Bucket;
}

/** Test hook — drops the memoised handles so a fresh config takes effect. */
export function resetFirebase(): void {
  app = null;
  firestore = null;
}
