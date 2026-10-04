/**
 * Route binding for the gallery.
 *
 * `App.tsx` (pre-existing) imports `{ GalleryPage }` from this path; the screen
 * itself lives in `Gallery.tsx`. Kept as a one-line re-export rather than
 * renaming either side, so the route table needs no edit.
 */
export { Gallery as GalleryPage } from './Gallery';
