/**
 * The ballot after voting has closed: a receipt, not a form.
 *
 * Deliberately NOT the editable component with everything switched off. A row
 * of greyed-out drag handles and dimmed buttons reads as "broken" and invites
 * people to keep poking at it; a plain numbered list reads as "recorded",
 * which is what actually happened.
 */

import { Lock } from 'lucide-react';
import type { PublicSubmissionDto } from '@contest/shared';
import { Badge, EmptyState, Panel, PanelHeader } from '@/components/ui';
import { plural } from '@/lib/utils';
import { EntryThumb } from './EntryThumb';
import { labelFor } from './ballot-logic';

export interface FinalBallotProps {
  ranking: readonly string[];
  entriesById: ReadonlyMap<string, PublicSubmissionDto>;
}

export function FinalBallot({ ranking, entriesById }: FinalBallotProps): JSX.Element {
  const rows = ranking
    .map((id) => entriesById.get(id))
    .filter((entry): entry is PublicSubmissionDto => entry !== undefined);

  return (
    <Panel as="section">
      <PanelHeader
        eyebrow="Voting closed"
        title="Your final ballot"
        description={
          rows.length > 0
            ? `This is the ranking that was counted — ${plural(rows.length, 'entry', 'entries')}, in this order. It can no longer be changed.`
            : 'Voting has closed.'
        }
        actions={<Badge tone="neutral">Final</Badge>}
      />

      <div className="mt-roomy">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Lock aria-hidden="true" className="h-6 w-6" />}
            title="No ballot was recorded"
            description="Voting closed before a ranking was saved, so nothing was counted for you. The result stands on the ballots that were cast."
          />
        ) : (
          <ol className="flex flex-col gap-tight">
            {rows.map((entry, index) => (
              <li
                key={entry.id}
                className="flex items-center gap-snug rounded border border-line bg-paper p-tight"
              >
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong font-display text-sm text-ink"
                >
                  {index + 1}
                </span>
                <EntryThumb entry={entry} className="h-10 w-10 shrink-0" eager />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-body leading-tight text-ink">
                    <span className="sr-only">Position {index + 1}: </span>
                    {labelFor(entry)}
                  </p>
                  {entry.title ? (
                    <p className="truncate text-xs text-ink-muted">{entry.title}</p>
                  ) : null}
                </div>
                {entry.isMine ? <Badge tone="neutral">Yours</Badge> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
