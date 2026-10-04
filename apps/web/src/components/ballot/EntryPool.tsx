/**
 * The pool of entries still available to rank.
 *
 * Entries leave the pool when they are ranked and come back when they are
 * removed, which keeps every `@dnd-kit` id unique across the two lists and
 * means "what is left to consider" is answerable at a glance.
 */

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { PublicSubmissionDto } from '@contest/shared';
import { cn } from '@/lib/utils';
import { PoolEntry } from './PoolEntry';

export const POOL_DROPPABLE_ID = 'entry-pool';

export interface EntryPoolProps {
  entries: readonly PublicSubmissionDto[];
  cap: number;
  rankedCount: number;
  onAdd: (id: string, index?: number) => void;
  onFull: () => void;
}

export function EntryPool({
  entries,
  cap,
  rankedCount,
  onAdd,
  onFull,
}: EntryPoolProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: POOL_DROPPABLE_ID });
  const ids = entries.map((entry) => entry.id);

  return (
    <SortableContext items={ids} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn('rounded transition-colors', isOver && 'bg-paper-sunken')}
      >
        {entries.length === 0 ? (
          <p className="rounded border border-dashed border-line-strong px-snug py-base text-sm text-ink-subtle">
            Every entry is on your ballot. Drag one back here, or use its Remove
            button, to free up a position.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-base sm:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => (
              <PoolEntry
                key={entry.id}
                entry={entry}
                cap={cap}
                rankedCount={rankedCount}
                onAdd={(index) => onAdd(entry.id, index)}
                onFull={onFull}
              />
            ))}
          </ul>
        )}
      </div>
    </SortableContext>
  );
}
