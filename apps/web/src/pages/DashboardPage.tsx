/**
 * Route entry point.
 *
 * `App.tsx` imports `DashboardPage` from this path; the screen itself lives in
 * `Dashboard.tsx`. Keeping the re-export means neither file has to move if the
 * route table is renamed later.
 */

export { Dashboard, DashboardPage } from './Dashboard';
