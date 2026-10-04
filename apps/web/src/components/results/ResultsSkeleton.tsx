/**
 * Loading state, shaped like the page that is coming.
 *
 * Same rhythm, same panel edges, same column split as the real layout, so the
 * content lands where the placeholder already was instead of shoving the page
 * around on arrival.
 */

import { Panel, Skeleton } from '@/components/ui';

export function ResultsSkeleton(): JSX.Element {
  return (
    <div className="space-y-8" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading results</span>

      {/* winner */}
      <Panel className="p-6 sm:p-8">
        <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:items-center md:gap-12">
          <Skeleton className="aspect-square w-full rounded" />
          <div className="space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-px w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </Panel>

      {/* the count */}
      <Panel className="p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-measure" />
        <Skeleton className="mt-6 h-[420px] w-full rounded" />
      </Panel>

      {/* standings */}
      <Panel className="p-6">
        <Skeleton className="h-5 w-36" />
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
