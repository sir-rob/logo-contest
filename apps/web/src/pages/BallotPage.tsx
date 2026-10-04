/**
 * Route binding for the ballot.
 *
 * `App.tsx` (pre-existing) imports `{ BallotPage }` from this path; the screen
 * itself lives in `Ballot.tsx`. Kept as a one-line re-export rather than
 * renaming either side, matching how `GalleryPage` and `DashboardPage` bind
 * their screens.
 */

export { BallotPage } from './Ballot';
