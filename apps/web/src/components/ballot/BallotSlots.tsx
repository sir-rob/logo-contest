/**
 * The five numbered slots.
 *
 * Rank is position, so the list is the model: slot 1 is `ranking[0]`. There is
 * no way to leave a gap because there is no gap to leave — remove the entry at
 * position 2 and everything below it moves up, which is exactly what the API
 * expects to receive.
 *
 * Empty slots are placeholders and read as such: a dashed hairline, muted ink,
 * and the word "Empty". No red, no warning icon, no implication that a voter
 * who only cares about two entries has done something wrong.
 *
 * Every reordering action exists twice — as a drag, and as a real button. The
 * buttons are not a fallback; they are the primary path for anyone not using a
 * mouse, and they carry the whole operation on their own.
 */

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import type { PublicSubmissionDto } from '@contest/shared';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EntryThumb } from './EntryThumb';
import { labelFor } from './ballot-logic';

export const BALLOT_DROPPABLE_ID = 'ballot-slots';

/**
 * DOM ids for the per-slot controls, derived from position.
 *
 * Exported because the page needs to name a control that does not exist yet:
 * after "Move up" the focused button unmounts, and focus has to be sent to the
 * equivalent button on the row that took its place.
 */
export function slotButtonId(action: 'up' | 'down' | 'remove', index: number): string {
  return `ballot-slot-${action}-${index}`;
}

export interface BallotSlotsProps {
  ranking: readonly string[];
  entriesById: ReadonlyMap<string, PublicSubmissionDto>;
  cap: number;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}

export function BallotSlots({
  ranking,
  entriesById,
  cap,
  onMove,
  onRemove,
}: BallotSlotsProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: BALLOT_DROPPABLE_ID });
  const emptyCount = Math.max(0, cap - ranking.length);

  return (
    <SortableContext items={[...ranking]} strategy={verticalListSortingStrategy}>
      <ol
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-tight rounded transition-colors',
          isOver && 'bg-paper-sunken',
        )}
      >
        {ranking.map((id, index) => {
          const entry = entriesById.get(id);
          if (!entry) return null;
          return (
            <RankedSlot
              key={id}
              entry={entry}
              index={index}
              total={ranking.length}
              onMove={onMove}
              onRemove={onRemove}
            />
          );
        })}

        {Array.from({ length: emptyCount }, (_, offset) => (
          <EmptySlot key={`empty-${ranking.length + offset}`} position={ranking.length + offset + 1} />
        ))}
      </ol>
    </SortableContext>
  );
}

interface RankedSlotProps {
  entry: PublicSubmissionDto;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}

function RankedSlot({ entry, index, total, onMove, onRemove }: RankedSlotProps): JSX.Element {
  const label = labelFor(entry);
  const position = index + 1;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, data: { container: 'ballot' } });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex items-center gap-snug rounded border border-line bg-paper-raised p-tight',
        isDragging && 'opacity-40',
      )}
    >
      <RankNumeral position={position} current />

      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}, currently position ${position} of ${total}`}
        className={cn(
          'grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded text-ink-subtle',
          'hover:text-ink focus-visible:outline focus-visible:outline-2',
          'focus-visible:outline-offset-2 focus-visible:outline-accent',
        )}
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </button>

      <EntryThumb entry={entry} className="h-10 w-10 shrink-0" eager />

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-body leading-tight text-ink">{label}</p>
        {entry.title ? (
          <p className="truncate text-xs text-ink-muted">{entry.title}</p>
        ) : null}
      </div>

      {entry.isMine ? <Badge tone="neutral">Yours</Badge> : null}

      {/*
        The non-drag path. Three real buttons with real accessible names —
        everything a drag can do, reachable with Tab and Enter alone.

        The ids are position-derived so the page can put focus back on the
        equivalent control after a change unmounts the one that was focused;
        otherwise every press of "Move up" would drop a keyboard voter back to
        the top of the document.
      */}
      <div className="flex shrink-0 items-center gap-hair">
        <Button
          id={slotButtonId('up', index)}
          variant="ghost"
          size="sm"
          className="px-2"
          onClick={() => onMove(index, index - 1)}
          disabled={isFirst}
          // At position 1 this read "up to position 0", which is nonsense. The
          // button is disabled there, but a disabled control is still reachable
          // and still announced, so the label has to make sense in both states.
          aria-label={
            isFirst
              ? `${label} is already your first choice`
              : `Move ${label} up to position ${position - 1}`
          }
        >
          <ArrowUp aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          id={slotButtonId('down', index)}
          variant="ghost"
          size="sm"
          className="px-2"
          onClick={() => onMove(index, index + 1)}
          disabled={isLast}
          // Mirror of the "up" case: at the bottom this would name a position
          // that does not exist.
          aria-label={
            isLast
              ? `${label} is already your last choice`
              : `Move ${label} down to position ${position + 1}`
          }
        >
          <ArrowDown aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          id={slotButtonId('remove', index)}
          variant="ghost"
          size="sm"
          className="px-2"
          onClick={() => onRemove(entry.id)}
          aria-label={`Remove ${label} from your ballot`}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function EmptySlot({ position }: { position: number }): JSX.Element {
  return (
    <li
      className={cn(
        'flex items-center gap-snug rounded border border-dashed border-line-strong',
        'bg-paper px-tight py-snug',
      )}
    >
      <RankNumeral position={position} />
      <p className="text-sm text-ink-subtle">
        Position {position} — empty. Drag an entry here, or use{' '}
        <span className="text-ink-muted">Add to ballot</span>.
      </p>
    </li>
  );
}

function RankNumeral({ position, current = false }: { position: number; current?: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full border font-display text-sm',
        current ? 'border-accent text-accent' : 'border-line-strong text-ink-faint',
      )}
    >
      {position}
    </span>
  );
}
