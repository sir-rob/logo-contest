/**
 * Loading state, in the shape of the thing that is loading.
 *
 * Two columns on desktop, slots-above-pool on narrow screens — the same layout
 * the real screen uses, so nothing jumps when the data lands.
 */

import { Panel, Skeleton } from '@/components/ui';

export function BallotSkeleton(): JSX.Element {
  return (
    <div
      className="flex flex-col-reverse gap-roomy lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-loose"
      aria-hidden="true"
    >
      <Panel>
        {/* Widths are fractions, not fixed steps: the spacing scale stops at 32. */}
        <div className="flex flex-col gap-tight">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-1/2" />
        </div>
        <div className="mt-roomy grid grid-cols-1 gap-base sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-snug">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-tight">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-2/3" />
        </div>
        <div className="mt-roomy flex flex-col gap-tight">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}
