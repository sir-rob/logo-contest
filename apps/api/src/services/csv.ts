/**
 * Anonymised ballot CSV.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AND WHAT IT MAY NOT CONTAIN.
 *
 * The export exists so a skeptic can recount the contest independently. That
 * is the ONLY purpose, and it sets the whole shape of the output: every value
 * in the file must be sufficient to re-run the count and insufficient to
 * identify a person.
 *
 * Therefore:
 *   - `ballot_id` is a SEQUENTIAL ANONYMOUS index (`B001`, `B002`, …). It is
 *     NOT the Firestore ballot document id, because that id is derived from
 *     the voter's uid (`<contestId>_<uid>`) and would de-anonymise every row.
 *   - Rows are ordered by a hash of the RANKING, never by document order,
 *     creation time, or anything voter-derived. Firestore order correlates
 *     with document id, which correlates with uid; creation time correlates
 *     with who voted when. A ranking hash correlates with nothing but the
 *     vote itself.
 *   - Rank cells hold ALIASES ("Entry 07"). Never a submission id (which
 *     joins back to an uploader), never a uid, never an email.
 *
 * The module is deliberately PURE — no Firestore, no config, no clock — so
 * these guarantees can be unit-tested exhaustively.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'node:crypto';
import { ApiError } from '@contest/shared';

/** RFC 4180 record separator. Excel and every serious CSV reader expect CRLF. */
const CRLF = '\r\n';

/**
 * Stable, opaque fingerprint of a ranking.
 *
 * Used only for ORDERING. Two identical rankings hash identically, which is
 * fine: the rows they produce are identical too, so no information is carried
 * by their relative position.
 */
export function rankingHash(ranking: readonly string[]): string {
  // `\u0000` cannot occur in a Firestore document id, so it is an unambiguous
  // separator — `['ab','c']` and `['a','bc']` must not collide.
  return createHash('sha256').update(ranking.join('\u0000')).digest('hex');
}

/**
 * Deterministic anonymous ordering of ballots.
 *
 * Sorting by ranking hash means the row order is a function of the VOTES and
 * nothing else. Feed the same set of ballots in any order and you get the same
 * file; learn nothing about who cast which from the order.
 */
export function orderRankingsAnonymously(
  rankings: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  return [...rankings]
    .map((ranking) => ({ ranking, hash: rankingHash(ranking) }))
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
    .map((x) => x.ranking);
}

/**
 * `B001`, `B002`, … from a zero-based index. Three digits is enough for this
 * contest's scale and `padStart` degrades gracefully past 999.
 */
export function anonymousBallotId(index: number, prefix = 'B'): string {
  return `${prefix}${String(index + 1).padStart(3, '0')}`;
}

/**
 * Escape one cell per RFC 4180: quote it if it contains a comma, a double
 * quote, CR or LF; double any internal quotes.
 *
 * Unicode passes through untouched — the file is UTF-8 and carries no BOM, so
 * nothing here needs to transliterate anything.
 */
export function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(escapeCsvCell).join(',');
}

/**
 * Serialise anonymised ballots.
 *
 * @param rankings  One entry per ballot: ordered submission ids, first
 *                  preference first. These are ids ONLY so they can be mapped
 *                  to aliases here; no id reaches the output.
 * @param aliasOf   Submission id -> public alias, or null if unknown. A miss
 *                  produces an EMPTY cell rather than the raw id: leaking an
 *                  id because a lookup failed would defeat the entire point
 *                  of the export.
 * @param maxRanks  Number of `rank_N` columns. Short ballots are padded with
 *                  empty cells and over-long ones truncated, so every row has
 *                  exactly the same arity and a naive parser cannot misread it.
 */
export function ballotsToCsv(
  rankings: readonly (readonly string[])[],
  aliasOf: (id: string) => string | null,
  maxRanks: number,
): string {
  if (!Number.isInteger(maxRanks) || maxRanks < 1) {
    throw new ApiError('VALIDATION_FAILED', 'maxRanks must be a positive integer.');
  }

  const header = ['ballot_id', ...Array.from({ length: maxRanks }, (_, i) => `rank_${i + 1}`)];
  const lines: string[] = [csvRow(header)];

  const ordered = orderRankingsAnonymously(rankings);
  for (let i = 0; i < ordered.length; i += 1) {
    const ranking = ordered[i] ?? [];
    const cells: string[] = [anonymousBallotId(i)];
    for (let r = 0; r < maxRanks; r += 1) {
      const id = ranking[r];
      // Unranked position, or an id we cannot resolve -> empty cell, never the id.
      cells.push(id === undefined ? '' : (aliasOf(id) ?? ''));
    }
    lines.push(csvRow(cells));
  }

  // Trailing CRLF terminates the final record. No BOM: the bytes are plain
  // UTF-8 and a BOM would corrupt the first header cell for strict parsers.
  return `${lines.join(CRLF)}${CRLF}`;
}
