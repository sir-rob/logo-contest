/**
 * The loading state.
 *
 * Deliberately the same shape as the loaded page — header, status panel, three
 * stats, a standings list — so that when the data lands nothing jumps. A
 * spinner in the middle of an empty page would be less work and worse.
 */

import { Panel, Skeleton } from '@/components/ui';

export function DashboardSkeleton(): JSX.Element {
  return (
    <div className="space-y-section" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the contest dashboard</span>

      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-[min(28rem,100%)]" />
        <Skeleton className="h-4 w-[min(20rem,100%)]" />
      </div>

      <Panel>
        <div className="flex items-center justify-between gap-base">
          <div className="w-full space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-10 w-32 shrink-0" />
        </div>
      </Panel>

      <div className="grid gap-base sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Panel key={i}>
            <div className="space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </Panel>
        ))}
      </div>

      <Panel>
        <div className="space-y-2">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-[min(32rem,100%)]" />
        </div>
        <ul className="mt-roomy divide-y divide-line">
          {[0, 1, 2, 3, 4].map((i) => (
            <li
              key={i}
              className="grid grid-cols-[1.75rem_2.5rem_minmax(0,1fr)] items-center gap-3 py-3 sm:grid-cols-[2rem_3rem_minmax(0,1fr)_5rem_3.5rem] sm:gap-4"
            >
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-10 w-10 sm:h-12 sm:w-12" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-2 w-full" />
              </div>
              <Skeleton className="hidden h-4 w-full sm:block" />
              <Skeleton className="hidden h-4 w-full sm:block" />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
