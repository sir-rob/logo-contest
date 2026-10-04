/**
 * Typed collection handles.
 *
 * Every read and write in the API goes through one of these so the converters
 * are impossible to forget. A raw `db.collection('ballots')` anywhere else in
 * the codebase is a bug.
 */

import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  ballotDocId,
  type AuditLog,
  type Ballot,
  type Contest,
  type ResultSnapshot,
  type Submission,
  type User,
} from '@contest/shared';
import { getDb } from '../firebase.js';
import {
  auditLogConverter,
  ballotConverter,
  contestConverter,
  resultConverter,
  submissionConverter,
  userConverter,
} from './converters.js';

export const usersCol = (db: Firestore = getDb()): CollectionReference<User> =>
  db.collection(COLLECTIONS.users).withConverter(userConverter);

export const userDoc = (uid: string, db: Firestore = getDb()): DocumentReference<User> => usersCol(db).doc(uid);

export const contestsCol = (db: Firestore = getDb()): CollectionReference<Contest> =>
  db.collection(COLLECTIONS.contests).withConverter(contestConverter);

export const contestDoc = (contestId: string, db: Firestore = getDb()): DocumentReference<Contest> =>
  contestsCol(db).doc(contestId);

export const submissionsCol = (db: Firestore = getDb()): CollectionReference<Submission> =>
  db.collection(COLLECTIONS.submissions).withConverter(submissionConverter);

export const submissionDoc = (id: string, db: Firestore = getDb()): DocumentReference<Submission> =>
  submissionsCol(db).doc(id);

/**
 * Ballots. Note there is deliberately no helper for "list all ballots by
 * contest" that returns ballot bodies to a caller — the only consumer of whole
 * ballots is the counting engine, which reduces them to anonymous rankings
 * before anything else sees them.
 */
export const ballotsCol = (db: Firestore = getDb()): CollectionReference<Ballot> =>
  db.collection(COLLECTIONS.ballots).withConverter(ballotConverter);

export const ballotDoc = (contestId: string, uid: string, db: Firestore = getDb()): DocumentReference<Ballot> =>
  ballotsCol(db).doc(ballotDocId(contestId, uid));

export const resultsCol = (db: Firestore = getDb()): CollectionReference<ResultSnapshot> =>
  db.collection(COLLECTIONS.results).withConverter(resultConverter);

/** Final, persisted result for a contest. */
export const resultDoc = (contestId: string, db: Firestore = getDb()): DocumentReference<ResultSnapshot> =>
  resultsCol(db).doc(contestId);

/** Rolling projection shown during voting. Kept apart from the final result. */
export const projectionDoc = (contestId: string, db: Firestore = getDb()): DocumentReference<ResultSnapshot> =>
  resultsCol(db).doc(`${contestId}__projection`);

export const auditLogsCol = (db: Firestore = getDb()): CollectionReference<AuditLog> =>
  db.collection(COLLECTIONS.auditLogs).withConverter(auditLogConverter);
