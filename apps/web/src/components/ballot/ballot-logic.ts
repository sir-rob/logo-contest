/**
 * Pure ranking maths for the ballot.
 *
 * Everything here is deliberately free of React and of the API client so the
 * rules that actually decide an election can be read — and tested — on their
 * own. Three invariants hold for every function that returns a ranking:
 *
 *  1. NO DUPLICATES. An entry appears at most once.
 *  2. NO GAPS. Rank is position: `ranking[0]` is rank 1, `ranking[1]` is rank
 *     2, and so on. Removing the middle of the list renumbers the tail rather
 *     than leaving a hole, because a hole is not a thing the API can express.
 *  3. NEVER LONGER THAN THE CAP.
 *
 * A partial ballot is a valid ballot. Nothing here treats "fewer than the cap"
 * as an error state, and callers should not either.
 */

import { MAX_RANKS, type PublicSubmissionDto } from '@contest/shared';
import { entryLabel } from '@/lib/entry-labels';

export type Ranking = readonly string[];

/**
 * What to call an entry in announcements and button labels.
 *
 * Delegates to `entryLabel`, which is the one audited place an entry gets a
 * name — deliberately NOT a local template literal, because that module is the
 * last place an uploader's identity could leak and it only works if everything
 * routes through it.
 *
 * The null case is real: an entry can be removed from the contest while it is
 * still on someone's ballot, and we still have to be able to say which one.
 */
export function labelFor(
  entry: Pick<PublicSubmissionDto, 'alias'> | null | undefined,
): string {
  return entry ? entryLabel(entry) : 'That entry';
}

/**
 * How many entries this voter may rank.
 *
 * Three ceilings, lowest wins: the contest's own `maxRanks`, the hard
 * `MAX_RANKS` from shared, and the number of entries that actually exist. The
 * last one matters — a three-entry contest has a cap of three, and showing
 * five slots would imply the voter had failed to fill two of them.
 */
export function rankingCap(entryCount: number, contestMaxRanks?: number | null): number {
  const configured = contestMaxRanks && contestMaxRanks > 0 ? contestMaxRanks : MAX_RANKS;
  return Math.max(0, Math.min(configured, MAX_RANKS, entryCount));
}

export function sameRanking(a: Ranking, b: Ranking): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/** Stable key for change detection. Ballot ids never contain a newline. */
export function rankingKey(ranking: Ranking): string {
  return ranking.join('\n');
}

/**
 * Place `id` at `index` (default: the end).
 *
 * If the entry is already ranked this is a move, not a second copy — which is
 * what keeps `BALLOT_DUPLICATE_RANKS` a thing the server never has to tell us.
 */
export function placeAt(ranking: Ranking, id: string, cap: number, index?: number): string[] {
  const existing = ranking.indexOf(id);
  if (existing !== -1) {
    return moveWithin(ranking, existing, index ?? ranking.length - 1);
  }
  if (ranking.length >= cap) return [...ranking];

  const next = [...ranking];
  const at = index === undefined ? next.length : clampIndex(index, next.length);
  next.splice(at, 0, id);
  return next;
}

/** Move the item at `from` to `to`. Out-of-range indices are a no-op, not a throw. */
export function moveWithin(ranking: Ranking, from: number, to: number): string[] {
  const next = [...ranking];
  if (from < 0 || from >= next.length) return next;

  const target = clampIndex(to, next.length - 1);
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...ranking];
  next.splice(target, 0, moved);
  return next;
}

/** Drop an entry. The entries below it shuffle up: ranks stay contiguous. */
export function removeId(ranking: Ranking, id: string): string[] {
  return ranking.filter((candidate) => candidate !== id);
}

export function activeIds(entries: readonly PublicSubmissionDto[]): Set<string> {
  return new Set(entries.map((entry) => entry.id));
}

/**
 * Ids on the ballot that the server no longer lists — withdrawn or
 * disqualified since the voter last looked.
 */
export function strandedIds(ranking: Ranking, active: ReadonlySet<string>): string[] {
  return ranking.filter((id) => !active.has(id));
}

/**
 * Coerce a ranking from anywhere (the server, a stale tab) into something this
 * screen can render: known entries only, no duplicates, no longer than the cap.
 */
export function sanitiseRanking(
  ranking: Ranking,
  active: ReadonlySet<string>,
  cap: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranking) {
    if (!active.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** `['Entry 03', 'Entry 07']` → `"Entry 03 and Entry 07"`. */
export function listSentence(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  const head = parts.slice(0, -1).join(', ');
  const tail = parts[parts.length - 1] ?? '';
  return `${head} and ${tail}`;
}

function clampIndex(index: number, max: number): number {
  if (Number.isNaN(index)) return Math.max(0, max);
  return Math.max(0, Math.min(max, index));
}
