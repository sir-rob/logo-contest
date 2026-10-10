/**
 * The route table, and the one place that decides what is reachable right now.
 *
 * Nav items and route guards are generated from the SAME `derivePhase()`-backed
 * gates (`canSubmit` / `canVote` / `canViewGallery` / `canViewResults` from
 * `@contest/shared`, via `useContest`). The API imports those same predicates,
 * so the UI cannot offer an action the server will then reject.
 *
 * Two rules about disabled things:
 *
 *   1. A gated nav item is SHOWN and DISABLED, never silently dropped. People
 *      need to know a ballot exists before it opens.
 *   2. Every disabled item carries a reason. A greyed-out link with no
 *      explanation reads as a bug, and people file it as one.
 *
 * Guards here are a courtesy, not a security control — every screen behind them
 * calls an endpoint that re-checks the same thing server-side.
 */

import {
  FolderKanban,
  ImagePlus,
  Images,
  LayoutDashboard,
  ListOrdered,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { ContestPhase } from '@contest/shared';
import type { PhaseGates } from '@/lib/contest';

export const ROUTES = {
  contests: '/contests',
  dashboard: '/',
  gallery: '/gallery',
  // Where you upload, replace or withdraw YOUR entry. Distinct from /gallery,
  // which is everyone's entries, anonymised.
  submit: '/submit',
  ballot: '/ballot',
  results: '/results',
  admin: '/admin',
  signIn: '/signin',
  completeSignIn: '/finish-signin',
} as const;

/**
 * Legacy paths kept alive on purpose.
 *
 * `lib/firebase.ts` builds the magic link's continue URL as `/finish-sign-in`.
 * Renaming the route without keeping this alias would break every link already
 * sitting in somebody's inbox, so both spellings resolve to the same screen.
 */
export const LEGACY_ROUTES = {
  signIn: '/sign-in',
  completeSignIn: '/finish-sign-in',
} as const;

/** Which `PhaseGates` key a nav destination depends on, if any. */
export type GateKey = keyof PhaseGates;

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Exact match only — the dashboard is `/`, which prefix-matches everything. */
  end: boolean;
  /** The gate this depends on, or null when it is always reachable. */
  gate: GateKey | null;
  /** Null when usable. A short sentence when disabled — shown to the user. */
  disabledReason: string | null;
  /** False means "do not render at all" (the admin tab for a member). */
  visible: boolean;
}

/**
 * Why a gate is shut, in a few words. Used on nav items, so it has to fit in a
 * tooltip and still tell someone something they did not already know.
 */
export function gateReason(gate: GateKey, phase: ContestPhase | null): string | null {
  if (phase === null) return 'Loading the contest…';

  switch (gate) {
    case 'gallery':
      return phase === 'SETUP' ? 'Opens when entries do' : null;

    case 'submit':
      if (phase === 'SUBMISSIONS_OPEN') return null;
      if (phase === 'SETUP') return 'Opens when entries do';
      return 'Entries are closed';

    case 'vote':
      if (phase === 'VOTING_OPEN') return null;
      if (phase === 'SETUP') return 'Opens when voting does';
      if (phase === 'SUBMISSIONS_OPEN') return 'Opens when submissions close';
      return 'Voting has closed';

    case 'results':
      if (phase === 'RESULTS_PUBLISHED') return null;
      if (phase === 'CLOSED') return 'Published once the count is confirmed';
      return 'Published after voting closes';

    default:
      return null;
  }
}

/** The same explanation, at the length a full page can afford. */
export function gateExplanation(gate: GateKey, phase: ContestPhase | null): string {
  if (phase === null) return 'We are still loading the contest. One moment.';

  switch (gate) {
    case 'gallery':
      return 'The gallery opens as soon as the contest starts accepting entries. Nothing is visible before then, so no one gets an early look.';

    case 'submit':
      return phase === 'SETUP'
        ? 'Uploads open when the contest starts. You will have until the submission deadline to change your entry.'
        : 'The submission deadline has passed, so entries are locked. This is what makes the vote fair — everyone was working to the same clock.';

    case 'vote':
      if (phase === 'SUBMISSIONS_OPEN')
        return 'Voting opens once submissions close, so that everyone votes on the same complete set of entries. Until then, the gallery is the place to look.';
      if (phase === 'SETUP')
        return 'Voting opens after the submission window closes. There is nothing to rank yet.';
      return 'Voting has closed and ballots are locked. Results follow once the count is confirmed.';

    case 'results':
      return phase === 'CLOSED'
        ? 'Voting is over and the count is being confirmed. Results appear here the moment they are published.'
        : 'Results are published after voting closes. Showing them earlier would nudge the people who have not voted yet.';

    default:
      return 'This is not available right now.';
  }
}

/**
 * The primary nav for a given phase and role.
 *
 * Order is the order of the contest itself — look, decide, see what happened —
 * which keeps the current step near where the eye already is.
 */
export function navItemsFor(phase: ContestPhase | null, isAdmin: boolean): NavItem[] {
  const item = (
    to: string,
    label: string,
    icon: LucideIcon,
    gate: GateKey | null,
    opts: { end?: boolean; visible?: boolean } = {},
  ): NavItem => ({
    to,
    label,
    icon,
    end: opts.end ?? false,
    gate,
    disabledReason: gate ? gateReason(gate, phase) : null,
    visible: opts.visible ?? true,
  });

  return [
    item(ROUTES.contests, 'Contests', FolderKanban, null),
    item(ROUTES.dashboard, 'Dashboard', LayoutDashboard, null, { end: true }),
    item(ROUTES.gallery, 'Gallery', Images, 'gallery'),
    // Sits next to Gallery because the two are easily confused: Gallery is
    // everyone's entries, anonymised; My Entry is the one you control.
    item(ROUTES.submit, 'My Entry', ImagePlus, 'submit'),
    item(ROUTES.ballot, 'Ballot', ListOrdered, 'vote'),
    item(ROUTES.results, 'Results', Trophy, 'results'),
    // Members never see an admin tab at all — a disabled one would just invite
    // questions we would rather not field.
    item(ROUTES.admin, 'Admin', ShieldCheck, null, { visible: isAdmin }),
  ];
}
