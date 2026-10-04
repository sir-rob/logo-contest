/**
 * Shared plumbing for the admin console.
 *
 * Two things here exist because an admin screen is where mistakes become
 * irreversible:
 *
 *  1. Dates are NEVER rendered without a named timezone. A deadline shown as
 *     "Oct 3, 5:00 PM" is a deadline someone will misread by a day; every
 *     helper below either carries the zone abbreviation or refuses to format.
 *
 *  2. Error codes are translated into what the admin should DO about them.
 *     `RESULTS_TOO_FEW_BALLOTS` is not a failure to report, it is the
 *     anonymity floor doing its job, and the copy says so.
 */

import type { ErrorCode } from '@contest/shared';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * `queryKeys.admin` in lib/query-client covers moderation/turnout/audit. The
 * admin console also owns a computed-results cache that no member screen
 * shares, so it gets its own key here rather than widening the shared map.
 */
export const adminResultsKey = ['admin', 'results'] as const;

// ---------------------------------------------------------------------------
// Timezone-explicit date formatting
// ---------------------------------------------------------------------------

/**
 * The admin's own IANA zone, resolved once. Everything on this page is stated
 * in it, and labelled with it.
 */
export const localTimeZone: string =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** "EDT" / "GMT+5:30" — whatever the platform calls the admin's zone right now. */
export function timeZoneAbbreviation(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: localTimeZone,
    timeZoneName: 'short',
  }).formatToParts(at);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? localTimeZone;
}

/**
 * "Fri Oct 3, 5:00 PM EDT". The zone is part of the string, not a tooltip —
 * an ambiguous deadline is how you close a contest a day early.
 */
export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Invalid date';
  const body = new Intl.DateTimeFormat('en-US', {
    timeZone: localTimeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
  return `${body} ${timeZoneAbbreviation(at)}`;
}

/** Same, plus the year. Used in tables where rows can straddle a year boundary. */
export function formatAbsoluteWithYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Invalid date';
  const body = new Intl.DateTimeFormat('en-US', {
    timeZone: localTimeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
  return `${body} ${timeZoneAbbreviation(at)}`;
}

/** "3 days ago" / "in 2 hours". Always paired with an absolute date, never alone. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const deltaMs = at.getTime() - now.getTime();
  const abs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 3600_000],
    ['month', 30 * 24 * 3600_000],
    ['day', 24 * 3600_000],
    ['hour', 3600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(deltaMs / ms), unit);
  }
  return rtf.format(Math.round(deltaMs / 1000), 'second');
}

// ---------------------------------------------------------------------------
// <input type="datetime-local"> <-> ISO, both in the admin's own zone
// ---------------------------------------------------------------------------

/**
 * A `datetime-local` input has no timezone. The browser will happily interpret
 * its value in the local zone, which is what we want — but the conversion has
 * to be done explicitly in both directions or a UTC-stored deadline drifts by
 * the offset every time the form round-trips.
 */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** Empty input means "clear this deadline", which the API models as null. */
export function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString();
}

/** Null-safe `new Date`, for feeding `validateContestDates` / `derivePhase`. */
export function toDateOrNull(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function errorCodeOf(error: unknown): ErrorCode | null {
  return error instanceof ApiClientError ? error.code : null;
}

export function fieldErrorsOf(error: unknown): Record<string, string> {
  return error instanceof ApiClientError ? (error.fields ?? {}) : {};
}

/**
 * Admin-facing translation. Where the generic message would leave someone
 * staring at a code, this says what happened and what to do instead.
 */
export function adminErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : fallback;
  }
  switch (error.code) {
    case 'RESULTS_TOO_FEW_BALLOTS':
      return (
        'Too few ballots to publish. Results stay sealed until the anonymity floor is met — ' +
        'with a handful of ballots a published tally can be read backwards to individual voters. ' +
        'Chase the remaining voters on the Turnout tab, or lower the floor on Timeline & settings ' +
        'if you accept the exposure.'
      );
    case 'RESULTS_UNRESOLVED_TIE':
      return (
        'A tie is blocking the count. The deterministic tie-break chain could not settle it, ' +
        'so an administrator has to choose which entry is eliminated before results can be finalised.'
      );
    case 'RESULTS_NOT_COMPUTED':
      return 'No results have been computed yet. Run “Compute results” first.';
    case 'LAST_ADMIN':
      return (
        'That is the last administrator. Demoting them would leave the contest with nobody who ' +
        'can publish results, moderate entries or fix the timeline — and no way to recover from ' +
        'inside the app. Promote someone else first.'
      );
    case 'ADMIN_REQUIRED':
      return 'That action requires administrator access.';
    case 'VALIDATION_FAILED':
      return error.message || 'Some of those values were rejected. Check the fields marked below.';
    case 'RATE_LIMITED':
      return error.retryAfter
        ? `Too many requests. Try again in ${error.retryAfter} seconds.`
        : 'Too many requests. Try again shortly.';
    default:
      return error.message || fallback;
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Percentage for turnout copy. 0 electorate is 0%, not NaN%. */
export function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/** A human label for an audit action string, including ones we do not know. */
export function auditActionLabel(action: string): string {
  const known: Record<string, string> = {
    'admin.promote': 'Promoted to admin',
    'admin.demote': 'Demoted to member',
    'contest.update': 'Contest settings changed',
    'contest.phase_override': 'Phase override changed',
    'submission.disqualify': 'Entry disqualified',
    'submission.reinstate': 'Entry reinstated',
    'moderation.view_identities': 'Viewed uploader identities',
    'results.compute': 'Results computed',
    'results.publish': 'Results published',
    'results.unpublish': 'Results unpublished',
    'results.tiebreak_override': 'Tie resolved by admin',
    'export.ballots': 'Anonymised ballots exported',
  };
  return known[action] ?? action;
}

/** Table cells holding figures line up only if the digits are the same width. */
export const numericCell = 'tabular-nums';
