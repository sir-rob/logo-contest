/**
 * The one place the contest's name is written down.
 *
 * The contest document carries a `title` an admin can edit, and the header
 * prefers it once it has loaded. This is the name shown before that — on the
 * sign-in screen, where there is no session and therefore no contest fetch.
 */

export const CONTEST_NAME: string =
  import.meta.env.VITE_CONTEST_NAME ?? 'Media Moguls \u2014 North 7 Logo Contest';

export const CONTEST_SHORT_NAME = 'North 7';

/** The quiet line in the footer. Sets expectations without nagging. */
export const FOOTER_NOTE =
  'Entries are anonymous. You can change your entry and your ballot until each deadline.';
