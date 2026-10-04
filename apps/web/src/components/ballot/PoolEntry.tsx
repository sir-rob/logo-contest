/**
 * One available entry in the left-hand pool.
 *
 * Two independent ways in, both complete:
 *  - Drag the card (pointer) or its handle (keyboard, via dnd-kit's sortable
 *    keyboard sensor) into the ballot.
 *  - Press the real "Add to ballot" button, or type a digit while the card has
 *    focus to drop it straight into that rank.
 *
 * The "ballot is full" state is `aria-disabled`, not `disabled`, on purpose: a
 * `disabled` button leaves the tab order, so a keyboard voter tabbing the pool
 * would sail past the only control that explains why nothing is happening.
 */

import type { KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus } from 'lucide-react';
import type { PublicSubmissionDto } from '@contest/shared';
import { Badge, Button } from '@/components/ui';
import { EntryFrame } from '@/components/EntryFrame';
import { entryAlt } from '@/lib/entry-labels';
import { cn } from '@/lib/utils';
import { labelFor } from './ballot-logic';

/**
 * DOM id for a pool card's Add button.
 *
 * Exported so the page can move focus to the card that takes this one's place
 * after it is added and unmounts out of the pool.
 */
export function poolAddButtonId(entryId: string): string {
  return `ballot-pool-add-${entryId}`;
}

export interface PoolEntryProps {
  entry: PublicSubmissionDto;
  /** How many entries may be ranked in total. */
  cap: number;
  /** How many are ranked right now. */
  rankedCount: number;
  /** Append to the ballot, or place at a specific zero-based index. */
  onAdd: (index?: number) => void;
  /** Fired when the ballot is full, so the page can say so out loud. */
  onFull: () => void;
}

export function PoolEntry({
  entry,
  cap,
  rankedCount,
  onAdd,
  onFull,
}: PoolEntryProps): JSX.Element {
  const label = labelFor(entry);
  const isFull = rankedCount >= cap;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, data: { container: 'pool' } });

  const handleAdd = (): void => {
    if (isFull) {
      onFull();
      return;
    }
    onAdd();
  };

  /**
   * Digit shortcuts. `1` is rank 1, and placing into a rank beyond the current
   * end of the list just appends — ranks stay contiguous, so there is no way to
   * type a gap into existence.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.length !== 1) return;

    const digit = Number.parseInt(event.key, 10);
    if (Number.isNaN(digit) || digit < 1 || digit > cap) return;
    event.preventDefault();

    if (isFull) {
      onFull();
      return;
    }
    onAdd(Math.min(digit - 1, rankedCount));
  };

  return (
    <li
      ref={setNodeRef}
      onKeyDown={handleKeyDown}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group flex h-full flex-col gap-snug rounded border border-line bg-paper-raised p-snug',
        'transition-colors focus-within:border-line-strong',
        isDragging && 'opacity-40',
      )}
    >
      {/*
        The shared frame, identical for every entry. Presentation must never
        advantage an entry on a ballot screen of all places.
      */}
      <EntryFrame src={entry.thumbUrl} alt={entryAlt(entry)} />

      <div className="flex items-start justify-between gap-tight">
        <div className="min-w-0">
          <p className="font-display text-body leading-tight text-ink">{label}</p>
          {entry.title ? (
            <p className="mt-hair truncate text-xs text-ink-muted">{entry.title}</p>
          ) : null}
        </div>
        {/* Self-voting is allowed at any rank. This is a label, not a barrier. */}
        {entry.isMine ? <Badge tone="neutral">Yours</Badge> : null}
      </div>

      <div className="mt-auto flex items-center gap-tight">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${label} onto your ballot`}
          className={cn(
            'grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded border border-line',
            'text-ink-subtle hover:text-ink focus-visible:outline focus-visible:outline-2',
            'focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <GripVertical aria-hidden="true" className="h-4 w-4" />
        </button>

        <Button
          id={poolAddButtonId(entry.id)}
          variant="secondary"
          size="sm"
          fullWidth
          onClick={handleAdd}
          aria-disabled={isFull}
          aria-keyshortcuts={isFull ? undefined : digitShortcuts(cap)}
          aria-label={
            isFull
              ? `Ballot full — cannot add ${label}`
              : `Add ${label} to your ballot at position ${rankedCount + 1}`
          }
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add to ballot
        </Button>
      </div>
    </li>
  );
}

/** "1 2 3 4 5" — the shape `aria-keyshortcuts` wants. */
function digitShortcuts(cap: number): string {
  return Array.from({ length: cap }, (_, i) => String(i + 1)).join(' ');
}
