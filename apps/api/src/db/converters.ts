/**
 * Firestore converters.
 *
 * Firestore hands back `Timestamp`, our domain types use `Date`, and zod
 * schemas in `@contest/shared` are written against `Date`. Rather than sprinkle
 * `.toDate()` through every route, every collection is read through a
 * converter that normalises in both directions and validates on the way out.
 *
 * Validating on read is deliberate: a document written by an older version of
 * the code, or by hand in the console, should fail loudly here rather than
 * quietly produce a malformed API response.
 */

import { Timestamp, type DocumentData, type FirestoreDataConverter, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { z } from 'zod';
import {
  AuditLogSchema,
  BallotSchema,
  ContestSchema,
  ResultSnapshotSchema,
  SubmissionSchema,
  UserSchema,
  type AuditLog,
  type Ballot,
  type Contest,
  type ResultSnapshot,
  type Submission,
  type User,
} from '@contest/shared';

/** Recursively turn Firestore `Timestamp`s into `Date`s. */
export function timestampsToDates(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(timestampsToDates);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = timestampsToDates(v);
    }
    return out;
  }
  return value;
}

/** Recursively turn `Date`s into Firestore `Timestamp`s. */
export function datesToTimestamps(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(datesToTimestamps);
  if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = datesToTimestamps(v);
    }
    return out;
  }
  return value;
}

/**
 * Build a converter from a zod schema.
 *
 * `id` is injected from the snapshot rather than trusted from the document
 * body, so a document whose stored `id` field disagrees with its key cannot
 * confuse a route.
 */
export function converterFor<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): FirestoreDataConverter<z.infer<TSchema>> {
  return {
    toFirestore(model: z.infer<TSchema>): DocumentData {
      const { id: _id, ...rest } = model as Record<string, unknown>;
      return datesToTimestamps(rest) as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): z.infer<TSchema> {
      const raw = timestampsToDates(snapshot.data()) as Record<string, unknown>;
      return schema.parse({ ...raw, id: snapshot.id }) as z.infer<TSchema>;
    },
  };
}

/**
 * Same as `converterFor`, for documents whose identity is the key alone and
 * which carry a `uid` rather than an `id` (the users collection).
 */
export function uidConverterFor<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): FirestoreDataConverter<z.infer<TSchema>> {
  return {
    toFirestore(model: z.infer<TSchema>): DocumentData {
      const { uid: _uid, ...rest } = model as Record<string, unknown>;
      return datesToTimestamps(rest) as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): z.infer<TSchema> {
      const raw = timestampsToDates(snapshot.data()) as Record<string, unknown>;
      return schema.parse({ ...raw, uid: snapshot.id }) as z.infer<TSchema>;
    },
  };
}

export const userConverter = uidConverterFor<typeof UserSchema>(UserSchema) as FirestoreDataConverter<User>;
export const contestConverter = converterFor<typeof ContestSchema>(ContestSchema) as FirestoreDataConverter<Contest>;
export const submissionConverter = converterFor<typeof SubmissionSchema>(
  SubmissionSchema,
) as FirestoreDataConverter<Submission>;
/**
 * Ballots have no `id` field — their identity is the deterministic key
 * `contestId_uid`, which is the whole mechanism preventing one person from
 * holding two ballots. So they get a plain converter with nothing injected.
 */
export const ballotConverter: FirestoreDataConverter<Ballot> = {
  toFirestore(model: Ballot): DocumentData {
    return datesToTimestamps(model) as DocumentData;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): Ballot {
    return BallotSchema.parse(timestampsToDates(snapshot.data()));
  },
};

export const auditLogConverter = converterFor<typeof AuditLogSchema>(
  AuditLogSchema,
) as FirestoreDataConverter<AuditLog>;

/**
 * Result snapshots are keyed by contest id + a suffix, and the schema has no
 * `id` field of its own, so they get a plain converter.
 */
export const resultConverter: FirestoreDataConverter<ResultSnapshot> = {
  toFirestore(model: ResultSnapshot): DocumentData {
    return datesToTimestamps(model) as DocumentData;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): ResultSnapshot {
    return ResultSnapshotSchema.parse(timestampsToDates(snapshot.data()));
  },
};

// ---------------------------------------------------------------------------
// Serialisation helpers used when building DTOs
// ---------------------------------------------------------------------------

/** ISO-8601 for the wire. DTOs use `z.string().datetime()` throughout. */
export const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Non-null variant for fields the DTO declares required. */
export const toIsoRequired = (d: Date): string => d.toISOString();

/** Parse an ISO string from a request body back into a Date. */
export const fromIso = (s: string | null | undefined): Date | null => (s ? new Date(s) : null);
