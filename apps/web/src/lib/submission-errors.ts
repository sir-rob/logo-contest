/**
 * Server rejections, translated.
 *
 * Switched on `ApiClientError.code`, never on the message text. The prose the
 * server sends is a fallback for codes nobody anticipated; matching on it
 * would break the first time someone fixes a typo in the API.
 *
 * Each case answers two questions: what went wrong, and what to do next.
 * `field` routes the message to the control that caused it, so a rejected
 * title is reported beside the title box rather than in a banner at the top of
 * the page.
 */

import { ApiClientError } from '@/lib/api';
import {
  MAX_IMAGE_DIMENSION,
  MAX_TITLE_LENGTH,
  MIN_IMAGE_DIMENSION,
} from '@contest/shared';
import { MAX_UPLOAD_LABEL, ACCEPTED_TYPES_LABEL } from '@/lib/image-validation';

export interface SubmissionFailure {
  message: string;
  /** Which control to attach the message to, when it belongs to one. */
  field?: 'file' | 'title' | 'description';
  /**
   * The clock rolled over mid-session: submissions closed between the page
   * loading and this request landing. The caller must re-read the phase and
   * swap the whole screen to the locked state, not just show an error.
   */
  phaseClosed?: boolean;
  /** Re-authentication is the remedy. */
  authExpired?: boolean;
}

export function describeSubmissionFailure(error: unknown): SubmissionFailure {
  if (!(error instanceof ApiClientError)) {
    return {
      message: 'Something went wrong and your entry was not saved. Try again in a moment.',
    };
  }

  switch (error.code) {
    // The one the brief calls out: the server compares the title against the
    // uploader's own display name and email local-part. It is a well-meant
    // mistake, not an attack, so the copy should read as a nudge.
    case 'SUBMISSION_TITLE_IDENTIFIES_AUTHOR':
      return {
        field: 'title',
        message:
          'That title looks like your own name or email address, and entries are judged anonymously. ' +
          'Give the logo a name instead — something about the design, not about you. ' +
          'If you want credit when you win, use the checkbox below; it stays hidden until then.',
      };

    case 'PHASE_SUBMISSIONS_CLOSED':
      return {
        phaseClosed: true,
        message:
          'Submissions closed while this page was open, so nothing was saved. ' +
          'Whatever you had already submitted before the deadline still stands.',
      };

    case 'SUBMISSION_INVALID_TYPE':
      return {
        field: 'file',
        message: `The server would not accept that file type. Entries must be a ${ACCEPTED_TYPES_LABEL} image — SVG is not accepted.`,
      };

    case 'SUBMISSION_TOO_LARGE':
      return {
        field: 'file',
        message: `That file is over the ${MAX_UPLOAD_LABEL} limit. Re-export it smaller and try again.`,
      };

    case 'SUBMISSION_TOO_SMALL':
      return {
        field: 'file',
        message: `The server measured that image below ${MIN_IMAGE_DIMENSION} pixels on its shortest side. Export a larger version.`,
      };

    case 'SUBMISSION_TOO_LARGE_DIMENSIONS':
      return {
        field: 'file',
        message: `The server measured that image above ${MAX_IMAGE_DIMENSION} pixels on its longest side. Scale it down and try again.`,
      };

    case 'SUBMISSION_CORRUPT_IMAGE':
      return {
        field: 'file',
        message:
          'The server could not read that image, even though the browser could. Re-export it from your design tool — a partial or unusual export usually explains this.',
      };

    case 'SUBMISSION_NOT_FOUND':
      return {
        message: 'That entry no longer exists. It may already have been withdrawn — reload to see where things stand.',
      };

    case 'VALIDATION_FAILED': {
      // The server names the offending fields; prefer its specific wording.
      const named = error.fields ? Object.entries(error.fields)[0] : undefined;
      if (named) {
        const [field, message] = named;
        if (field === 'title') return { field: 'title', message };
        if (field === 'description') return { field: 'description', message };
        if (field === 'file') return { field: 'file', message };
        return { message };
      }
      return {
        message: `Something in the form was rejected. Check the title is ${MAX_TITLE_LENGTH} characters or fewer and try again.`,
      };
    }

    case 'RATE_LIMITED':
      return {
        message: error.retryAfter
          ? `Too many attempts. Try again in about ${Math.ceil(error.retryAfter)} seconds.`
          : 'Too many attempts in a short time. Wait a moment and try again.',
      };

    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID_TOKEN':
    case 'AUTH_LINK_EXPIRED':
      return {
        authExpired: true,
        message: 'Your session expired before this could be saved. Sign in again, then re-upload.',
      };

    case 'INTERNAL':
      return {
        message: error.message || 'The server had a problem and your entry was not saved. Try again shortly.',
      };

    default:
      return { message: error.message };
  }
}
