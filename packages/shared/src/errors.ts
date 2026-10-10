import { z } from 'zod';

/**
 * Error codes shared by API and web, so the client can react to a specific
 * failure (re-prompt for an email, show a countdown, offer a resend) instead of
 * pattern-matching on English prose.
 */
export const ERROR_CODES = [
  // auth
  'AUTH_REQUIRED',
  'AUTH_INVALID_TOKEN',
  'AUTH_EMAIL_UNVERIFIED',
  'AUTH_DOMAIN_NOT_ALLOWED',
  'AUTH_LINK_EXPIRED',
  'AUTH_RATE_LIMITED',
  // authorization
  'FORBIDDEN',
  'ADMIN_REQUIRED',
  'LAST_ADMIN',
  'CONTEST_ACCESS_REQUIRED',
  'CONTEST_CODE_INVALID',
  'CONTEST_CODE_TAKEN',
  // phase
  'PHASE_SUBMISSIONS_CLOSED',
  'PHASE_VOTING_CLOSED',
  'PHASE_RESULTS_NOT_PUBLISHED',
  // submissions
  'SUBMISSION_NOT_FOUND',
  'SUBMISSION_ALREADY_EXISTS',
  'SUBMISSION_INVALID_TYPE',
  'SUBMISSION_TOO_LARGE',
  'SUBMISSION_TOO_SMALL',
  'SUBMISSION_TOO_LARGE_DIMENSIONS',
  'SUBMISSION_TITLE_IDENTIFIES_AUTHOR',
  'SUBMISSION_CORRUPT_IMAGE',
  // ballots
  'BALLOT_DUPLICATE_RANKS',
  'BALLOT_TOO_MANY_RANKS',
  'BALLOT_EMPTY',
  'BALLOT_UNKNOWN_SUBMISSION',
  'BALLOT_INACTIVE_SUBMISSION',
  // results
  'RESULTS_TOO_FEW_BALLOTS',
  'RESULTS_NOT_COMPUTED',
  'RESULTS_UNRESOLVED_TIE',
  // generic
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Field-level detail for VALIDATION_FAILED. */
    fields: z.record(z.string()).optional(),
    /** Seconds until a rate-limited caller may retry. */
    retryAfter: z.number().int().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID_TOKEN: 401,
  AUTH_EMAIL_UNVERIFIED: 403,
  AUTH_DOMAIN_NOT_ALLOWED: 403,
  AUTH_LINK_EXPIRED: 401,
  AUTH_RATE_LIMITED: 429,
  FORBIDDEN: 403,
  ADMIN_REQUIRED: 403,
  LAST_ADMIN: 409,
  CONTEST_ACCESS_REQUIRED: 403,
  CONTEST_CODE_INVALID: 404,
  CONTEST_CODE_TAKEN: 409,
  PHASE_SUBMISSIONS_CLOSED: 409,
  PHASE_VOTING_CLOSED: 409,
  PHASE_RESULTS_NOT_PUBLISHED: 409,
  SUBMISSION_NOT_FOUND: 404,
  SUBMISSION_ALREADY_EXISTS: 409,
  SUBMISSION_INVALID_TYPE: 415,
  SUBMISSION_TOO_LARGE: 413,
  SUBMISSION_TOO_SMALL: 422,
  SUBMISSION_TOO_LARGE_DIMENSIONS: 422,
  SUBMISSION_TITLE_IDENTIFIES_AUTHOR: 422,
  SUBMISSION_CORRUPT_IMAGE: 422,
  BALLOT_DUPLICATE_RANKS: 422,
  BALLOT_TOO_MANY_RANKS: 422,
  BALLOT_EMPTY: 422,
  BALLOT_UNKNOWN_SUBMISSION: 422,
  BALLOT_INACTIVE_SUBMISSION: 422,
  RESULTS_TOO_FEW_BALLOTS: 409,
  RESULTS_NOT_COMPUTED: 404,
  RESULTS_UNRESOLVED_TIE: 409,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Default user-facing copy. Routes may override with something more specific. */
export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  AUTH_INVALID_TOKEN: 'Your session is no longer valid. Please sign in again.',
  AUTH_EMAIL_UNVERIFIED: 'Your email address could not be verified.',
  AUTH_DOMAIN_NOT_ALLOWED: 'This contest is limited to a specific email domain.',
  AUTH_LINK_EXPIRED: 'That sign-in link has expired or was already used.',
  AUTH_RATE_LIMITED: 'Too many sign-in emails requested. Please try again shortly.',
  FORBIDDEN: 'You do not have access to that.',
  ADMIN_REQUIRED: 'That action requires administrator access.',
  LAST_ADMIN: 'You cannot remove the last administrator.',
  CONTEST_ACCESS_REQUIRED: 'Enter the contest code to register for this contest first.',
  CONTEST_CODE_INVALID: 'No contest was found with that code. Check the code with your contest organiser.',
  CONTEST_CODE_TAKEN: 'Another contest is already using that code. Choose a unique code.',
  PHASE_SUBMISSIONS_CLOSED: 'Submissions are closed.',
  PHASE_VOTING_CLOSED: 'Voting is closed.',
  PHASE_RESULTS_NOT_PUBLISHED: 'Results have not been published yet.',
  SUBMISSION_NOT_FOUND: 'That entry could not be found.',
  SUBMISSION_ALREADY_EXISTS: 'You already have an entry. Replace it instead.',
  SUBMISSION_INVALID_TYPE: 'Please upload a PNG, JPEG or WebP image.',
  SUBMISSION_TOO_LARGE: 'That image is larger than 10 MB.',
  SUBMISSION_TOO_SMALL: 'That image is smaller than 512 pixels on a side.',
  SUBMISSION_TOO_LARGE_DIMENSIONS: 'That image is larger than 6000 pixels on a side.',
  SUBMISSION_TITLE_IDENTIFIES_AUTHOR: 'Entry titles cannot contain your name — entries are anonymous.',
  SUBMISSION_CORRUPT_IMAGE: 'That file could not be read as an image.',
  BALLOT_DUPLICATE_RANKS: 'Each entry can only be ranked once.',
  BALLOT_TOO_MANY_RANKS: 'You can rank at most five entries.',
  BALLOT_EMPTY: 'Rank at least one entry before saving.',
  BALLOT_UNKNOWN_SUBMISSION: 'Your ballot refers to an entry that no longer exists.',
  BALLOT_INACTIVE_SUBMISSION: 'Your ballot refers to an entry that has been withdrawn.',
  RESULTS_TOO_FEW_BALLOTS: 'Too few ballots have been cast to publish results anonymously.',
  RESULTS_NOT_COMPUTED: 'Results have not been computed yet.',
  RESULTS_UNRESOLVED_TIE: 'A tie needs an administrator decision before results can be finalised.',
  VALIDATION_FAILED: 'Some of that input was not valid.',
  NOT_FOUND: 'Not found.',
  CONFLICT: 'That conflicts with the current state.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  INTERNAL: 'Something went wrong on our end.',
};

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly fields?: Record<string, string>,
    public readonly retryAfter?: number,
  ) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code]);
    this.name = 'ApiError';
  }

  get status(): number {
    return HTTP_STATUS_FOR_CODE[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
        ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      },
    };
  }
}
