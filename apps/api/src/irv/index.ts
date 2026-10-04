/**
 * The IRV counting engine's public surface.
 *
 * Everything the API routes and the results service need is re-exported here,
 * so callers never reach into `count.ts` / `rng.ts` directly and the internals
 * stay free to change.
 */

export { countIrv, adminTieBreakKey } from './count.js';
export type { IrvResult, SeededTieBreakNote } from './count.js';
export { makeRng, seededShuffle } from './rng.js';
