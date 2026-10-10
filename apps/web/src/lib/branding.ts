/**
 * Application-wide branding constants.
 *
 * Individual contests carry their own `title` and `description` in Firestore.
 * These constants provide the generic platform branding shown before a contest
 * is selected (or on the sign-in and top-level contests screens).
 */

export const PLATFORM_NAME: string =
  import.meta.env.VITE_APP_NAME ?? import.meta.env.VITE_CONTEST_NAME ?? 'Team Contests';

export const CONTEST_NAME: string = PLATFORM_NAME;

export const CONTEST_SHORT_NAME = 'Contests';

/** The quiet line in the footer. Sets expectations without nagging. */
export const FOOTER_NOTE =
  'Entries are anonymous. You can change your entry and your ballot until each deadline.';
