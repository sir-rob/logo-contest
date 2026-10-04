/**
 * "Not open yet" / "no longer open."
 *
 * The page a phase-gated route renders instead of its screen. The wording comes
 * from `gateExplanation` in `routes.tsx`, which is the same source the disabled
 * nav item uses — so the tooltip and the page can never tell a different story.
 *
 * Not an error page. The contest simply is not at that point.
 */

import { CalendarClock } from 'lucide-react';
import type { ContestPhase } from '@contest/shared';
import { PHASE_LABELS } from '@contest/shared';
import { Badge, EmptyState, PageHeader, Panel } from '@/components/ui';
import { ButtonLink } from '@/components/TextLink';
import { gateExplanation, gateReason, ROUTES, type GateKey } from '@/routes';

const TITLES: Record<GateKey, string> = {
  submit: 'Entries',
  vote: 'Your ballot',
  gallery: 'The gallery',
  results: 'Results',
};

export function PhaseLocked({
  gate,
  phase,
  unavailable = false,
}: {
  gate: GateKey;
  phase: ContestPhase | null;
  /** True when we could not read the contest at all, rather than it being shut. */
  unavailable?: boolean;
}): JSX.Element {
  const heading = unavailable
    ? 'We could not load the contest'
    : (gateReason(gate, phase) ?? 'Not available right now');

  const body = unavailable
    ? 'Something went wrong fetching the contest, so we are not showing this page rather than guessing at what you can do. Refreshing usually sorts it.'
    : gateExplanation(gate, phase);

  return (
    <>
      <PageHeader
        eyebrow={TITLES[gate]}
        title={heading}
        actions={phase ? <Badge tone="neutral">{PHASE_LABELS[phase]}</Badge> : null}
      />

      <Panel className="mt-base rounded border border-line bg-paper-raised p-roomy">
        <EmptyState
          icon={<CalendarClock aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title={heading}
          description={body}
          action={<ButtonLink to={ROUTES.dashboard}>Back to the dashboard</ButtonLink>}
        />
      </Panel>
    </>
  );
}

export default PhaseLocked;
