/**
 * Route entry point.
 *
 * The console itself lives in `Admin.tsx` alongside its `admin/` tab folder;
 * `App.tsx` imports `./pages/AdminPage`, so this keeps that import stable
 * without duplicating the page.
 */
export { AdminPage, default } from './Admin';
