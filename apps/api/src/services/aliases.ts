/**
 * Anonymous alias assignment.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE SHUFFLE EXISTS
 *
 * Entries are shown as "Entry 01".."Entry NN". If those labels were handed out
 * in upload order, the number would be a timestamp in disguise: "Entry 01" is
 * whoever posted first, "Entry 17" is the person who scrambled something
 * together at the deadline. Anyone who watched the gallery fill up — or who
 * simply knows a colleague is an eager early submitter — could deanonymise
 * entries from the label alone.
 *
 * So aliases are assigned exactly once, at the moment submissions close, in a
 * SHUFFLED order. The shuffle is seeded from the contest's `tieBreakSeed` so
 * that a rerun (a crash, a replay, a recount) reproduces identical labels:
 * results and ballots reference submission ids, but humans discuss "Entry 07",
 * and that label must not move under them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { formatAlias, type Submission } from '@contest/shared';
import { getConfig, now } from '../config.js';
import { getDb } from '../firebase.js';
import { contestDoc, submissionsCol } from '../db/collections.js';
import { phaseOf } from './contest.js';

// ---------------------------------------------------------------------------
// Seeded shuffle (pure)
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit. A string seed folded into a PRNG state.
 *
 * Not a cryptographic hash and does not need to be: the seed is a server-side
 * secret that is never published, and the property we need is "same seed,
 * same permutation", not unpredictability-under-attack.
 */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit space; >>> 0 keeps it unsigned.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Hand-rolled on purpose: this is a dozen lines, and pulling a dependency into
 * the deployment for it would be a worse trade than owning the code.
 */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle.
 *
 * Pure: same `items` and same `seed` always yield the same permutation, and
 * the input array is not mutated. Callers MUST pass items in a canonical order
 * (we sort by submission id) — otherwise the permutation depends on whatever
 * order Firestore happened to return, and determinism is lost.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    // `i` and `j` are provably in range, but noUncheckedIndexedAccess cannot
    // see that; the casts document the invariant without widening the type.
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignAliasesResult {
  /** How many submissions were labelled. Zero when skipped. */
  assigned: number;
  /** True when nothing needed doing (already assigned, or too early). */
  skipped: boolean;
}

/**
 * Assign aliases if the contest has moved past submissions and has none yet.
 *
 * Designed to be called on EVERY gallery read: it is idempotent, and once
 * `aliasesAssignedAt` is set the fast path is a single contest-document read
 * with no writes and no transaction.
 *
 * Everything mutating happens in ONE Firestore transaction, so a crash cannot
 * leave half the field labelled — a partial assignment would be visible in the
 * gallery as a mix of "Entry 03" and blanks, which both looks broken and leaks
 * that the blanks arrived later.
 */
export async function assignAliasesIfDue(contestId: string): Promise<AssignAliasesResult> {
  const contestRef = contestDoc(contestId);
  const snap = await contestRef.get();
  const contest = snap.data();
  if (!contest) return { assigned: 0, skipped: true };

  if (!aliasesAreDue(contest.aliasesAssignedAt, phaseOf(contest))) {
    return { assigned: 0, skipped: true };
  }

  const db = getDb();
  return db.runTransaction(async (txn) => {
    // Re-read inside the transaction. Two gallery requests can race here; the
    // loser sees `aliasesAssignedAt` already set and backs out rather than
    // reshuffling and renaming every entry under the winner's feet.
    const freshSnap = await txn.get(contestRef);
    const fresh = freshSnap.data();
    if (!fresh) return { assigned: 0, skipped: true };
    if (!aliasesAreDue(fresh.aliasesAssignedAt, phaseOf(fresh))) {
      return { assigned: 0, skipped: true };
    }

    // Withdrawn and disqualified entries are excluded: they are not shown, and
    // burning a label on them would leave visible gaps in the numbering that
    // advertise "somebody pulled out".
    const activeQuery = submissionsCol()
      .where('contestId', '==', contestId)
      .where('status', '==', 'active');
    const subsSnap = await txn.get(activeQuery);

    // Canonical order first, so the permutation depends only on the seed and
    // the set of ids — never on Firestore's return order or index state.
    const ordered = subsSnap.docs
      .map((d) => ({ ref: d.ref, id: d.data().id }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const shuffled = seededShuffle(ordered, fresh.tieBreakSeed);
    const timestamp = now(getConfig());

    // A contest is a team-sized field (tens of entries), comfortably inside
    // the 500-write transaction ceiling. If this ever grew to hundreds we
    // would need chunked batches plus a separate "assignment complete" marker.
    shuffled.forEach((entry, index) => {
      txn.update(entry.ref, { alias: formatAlias(index + 1), updatedAt: timestamp });
    });
    txn.update(contestRef, { aliasesAssignedAt: timestamp, updatedAt: timestamp });

    return { assigned: shuffled.length, skipped: false };
  });
}

/**
 * Are aliases due right now?
 *
 * Pure and exported so the gating rule can be tested without Firestore.
 * Nothing is assigned during SETUP (no field yet) or SUBMISSIONS_OPEN (the
 * field is still changing — labelling early would mean renumbering later, and
 * a label that changes is a label that correlates with arrival time).
 */
export function aliasesAreDue(aliasesAssignedAt: Date | null, phase: string): boolean {
  if (aliasesAssignedAt !== null) return false;
  return phase !== 'SETUP' && phase !== 'SUBMISSIONS_OPEN';
}

/**
 * Gallery ordering for a viewer.
 *
 * Two regimes, both deliberate:
 *
 *  • Once aliases exist, order by alias. The label is already public and
 *    shuffled, so sorting by it reveals nothing and gives every viewer the
 *    same stable, discussable layout ("look at Entry 12").
 *
 *  • Before that — during SUBMISSIONS_OPEN, when alias is null — order by a
 *    per-viewer deterministic shuffle keyed on `tieBreakSeed + viewerUid`.
 *    A chronological list would be an upload-time oracle; a single global
 *    shuffle would hand one entry the top-left slot for everyone, which is a
 *    real advantage in a design contest. Keying on the viewer spreads that
 *    position evenly, and keying it deterministically means one person's own
 *    gallery does not reshuffle on every refresh.
 */
export function orderSubmissionsForViewer<T extends { id: string; alias: string | null }>(
  submissions: readonly T[],
  tieBreakSeed: string,
  viewerUid: string,
): T[] {
  const canonical = [...submissions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const allLabelled = canonical.length > 0 && canonical.every((s) => s.alias !== null);
  if (allLabelled) {
    return canonical.sort((a, b) => {
      const av = a.alias ?? '';
      const bv = b.alias ?? '';
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }

  return seededShuffle(canonical, `${tieBreakSeed}:${viewerUid}`);
}

/** Narrow re-export so routes need not import the entity type just for this. */
export type AliasableSubmission = Pick<Submission, 'id' | 'alias'>;
