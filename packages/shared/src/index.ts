/**
 * @contest/shared — the typed seam between the API and the web app.
 *
 * Both sides import from here so they cannot drift. In particular both import
 * `derivePhase`, so the UI never offers an action the server will reject.
 *
 * See `api.ts` before adding a route: it is the anonymity boundary.
 */

export * from './constants.js';
export * from './phases.js';
export * from './entities.js';
export * from './results.js';
export * from './errors.js';
export * from './api.js';
