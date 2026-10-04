/**
 * "Have I done my bit yet?"
 *
 * For most people arriving here that is the only question they actually have,
 * so it gets a panel of its own above the aggregate numbers rather than a line
 * buried among them. Done and not-done are distinguished by icon, wording and
 * the presence of an action — not by colour, which is doing nothing load-
 * bearing here.
 */

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Panel } from '@/components/ui';

export interface ViewerStatusProps {
  done: boolean;
  /** Headline once they have done it. */
  doneTitle: string;
  doneDescription: string;
  /** Headline while they still have to. */
  todoTitle: string;
  todoDescription: string;
  actionLabel: string;
  /** Where the action goes. */
  actionTo: string;
  /** Label for the secondary action shown once the task is done. */
  changeLabel?: string;
  /** False once the window has shut: state stays, the invitation to act goes. */
  actionable: boolean;
  /** Shown in place of the action when the window has shut. */
  closedNote?: string;
}

export function ViewerStatus({
  done,
  doneTitle,
  doneDescription,
  todoTitle,
  todoDescription,
  actionLabel,
  actionTo,
  changeLabel,
  actionable,
  closedNote,
}: ViewerStatusProps): JSX.Element {
  const navigate = useNavigate();
  const Icon = done ? CheckCircle2 : CircleDashed;

  return (
    <Panel>
      <div className="flex flex-col gap-base sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon
            aria-hidden="true"
            className={done ? 'mt-1 h-5 w-5 shrink-0 text-success' : 'mt-1 h-5 w-5 shrink-0 text-ink-subtle'}
          />
          <div>
            <h2 className="text-display-sm">{done ? doneTitle : todoTitle}</h2>
            <p className="mt-1 text-sm text-ink-muted">{done ? doneDescription : todoDescription}</p>
          </div>
        </div>

        <div className="shrink-0 sm:pl-base">
          {actionable ? (
            <Button onClick={() => navigate(actionTo)}>
              {done ? (changeLabel ?? 'Change it') : actionLabel}
            </Button>
          ) : closedNote ? (
            <p className="text-sm text-ink-subtle">{closedNote}</p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
