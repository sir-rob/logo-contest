/**
 * Alias module.
 *
 * The route table in `App.tsx` imports `ResultsPage` from `./pages/ResultsPage`,
 * which is where the screen actually lives. This file exists so the shorter
 * `@/pages/Results` path resolves to the same component instead of tempting
 * someone into building a second results screen next to the first one.
 */
export { ResultsPage, ResultsPage as Results, default } from './ResultsPage';
