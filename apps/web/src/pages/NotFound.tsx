/**
 * 404.
 *
 * Short, unembarrassed, and it offers the two places anybody arriving here
 * actually wanted. No apologising, no illustration of a lost astronaut.
 */

import { Compass } from 'lucide-react';
import { EmptyState, PageHeader, Panel } from '@/components/ui';
import { ButtonLink } from '@/components/TextLink';
import { ROUTES } from '@/routes';

export function NotFound(): JSX.Element {
  return (
    <>
      <PageHeader eyebrow="404" title="There is nothing at this address" />

      <Panel className="mt-base rounded border border-line bg-paper-raised p-roomy">
        <EmptyState
          icon={<Compass aria-hidden="true" className="h-6 w-6 text-ink-subtle" />}
          title="Page not found"
          description="The link may be out of date, or the page may have moved. The dashboard has everything that is currently open."
          action={
            <div className="flex flex-wrap gap-snug">
              <ButtonLink to={ROUTES.dashboard} tone="primary">
                Go to the dashboard
              </ButtonLink>
              <ButtonLink to={ROUTES.gallery}>Browse the gallery</ButtonLink>
            </div>
          }
        />
      </Panel>
    </>
  );
}

export default NotFound;
