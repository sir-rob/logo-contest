/**
 * Contest-wide constants. These are the knobs that are NOT per-contest config —
 * anything an admin can change at runtime lives on the contest document instead.
 */

/** Maximum number of entries a voter may rank. */
export const MAX_RANKS = 5;

/** A ballot must rank at least this many entries to be counted. */
export const MIN_RANKS = 1;

/** Results cannot be published below this many ballots (anonymity floor). */
export const DEFAULT_MIN_BALLOTS_TO_PUBLISH = 5;

/** One active submission per person per contest. Not configurable. */
export const MAX_SUBMISSIONS_PER_USER = 1;

// ---------------------------------------------------------------------------
// Upload constraints
// ---------------------------------------------------------------------------

/**
 * SVG is deliberately absent. It is executable markup and would be an XSS
 * vector in a gallery that renders user-supplied images inline.
 */
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_IMAGE_DIMENSION = 512;
export const MAX_IMAGE_DIMENSION = 6000;

/** Rendered sizes produced on upload. Originals are never served. */
export const THUMB_SIZE = 640;
export const DISPLAY_SIZE = 1600;

/** Lifetime of the signed URLs the API mints for images. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Text limits
// ---------------------------------------------------------------------------

export const MAX_TITLE_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 240;
export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MIN_CONTEST_CODE_LENGTH = 2;
export const MAX_CONTEST_CODE_LENGTH = 32;
export const DEFAULT_CONTEST_CODE = 'NORTH7';

/** Normalise a contest access code for storage and case-insensitive matching. */
export const normaliseContestCode = (raw: string): string => raw.trim().toUpperCase();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Magic-link requests allowed per email address per window. */
export const MAGIC_LINK_RATE_LIMIT = { max: 3, windowMs: 15 * 60 * 1000 } as const;

/** Magic-link requests allowed per IP per window. Blocks inbox-bombing. */
export const MAGIC_LINK_IP_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 } as const;

// ---------------------------------------------------------------------------
// Firestore collection names
// ---------------------------------------------------------------------------

export const COLLECTIONS = {
  users: 'users',
  contests: 'contests',
  submissions: 'submissions',
  ballots: 'ballots',
  results: 'results',
  auditLogs: 'auditLogs',
} as const;

/** Ballot documents are keyed deterministically so one person cannot hold two. */
export const ballotDocId = (contestId: string, uid: string): string => `${contestId}_${uid}`;

/** Anonymous public label for an entry, e.g. "Entry 07". */
export const formatAlias = (n: number): string => `Entry ${String(n).padStart(2, '0')}`;
