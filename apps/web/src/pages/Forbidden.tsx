/**
 * "Not available to you."
 *
 * Shown in place of an admin screen for a member. Deliberately a PAGE and not a
 * redirect: bouncing an unauthorised user somewhere that might bounce them back
 * is how guards turn into redirect loops.
 *
 * The tone is matter-of-fact. Nobody did anything wrong by following a link,
 * and a red "ACCESS DENIED" would imply they had.
 */

import { Lock } from 'lucide-react';
import { EmptyState, PageHeader, Panel } from '@/components/ui';
import { ButtonLink } from '@/components/TextLink';
import { ROUTES } from '@/routes';

export function Forbidden(): JSX.Element {
  return (
    <>
      <PageHeader eyebrow="Not available" title="This part is for contest admins" />

      <Panel className="mt-base rounded border border-line bg-paper-raised p-roomy">
        <EmptyState
          icon={<Lock aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="You do not have access to this page"
          description="Admin tools cover contest dates, moderation and publishing results. If you need something changed, the quickest route is to ask whoever is running the contest."
          action={<ButtonLink to={ROUTES.dashboard}>Back to the dashboard</ButtonLink>}
        />
      </Panel>
    </>
  );
}

export default Forbidden;
