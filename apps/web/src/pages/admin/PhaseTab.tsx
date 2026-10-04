/**
 * Tab 2 — Phase control.
 *
 * There are two answers to "what phase is it" and conflating them is the trap
 * this screen exists to avoid:
 *
 *   - the CLOCK-DERIVED phase, computed here with the same `derivePhase` the
 *     server uses, from the dates alone;
 *   - the EFFECTIVE phase the server is actually serving, which is what
 *     `contest.phase` reports.
 *
 * When they disagree, something is overriding the clock. An override silently
 * in force is a trap for the next admin who wonders why the dates are being
 * ignored, so the divergence is stated loudly rather than smoothed over.
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Lock, Unlock } from 'lucide-react';
import {
  CONTEST_PHASES,
  PHASE_LABELS,
  derivePhase,
  type ContestPhase,
  type ContestPublicDto,
} from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { Badge, Button, ConfirmDialog, Divider, Panel, PanelHeader, Stat } from '@/components/ui';
import {
  adminErrorMessage,
  formatAbsolute,
  localTimeZone,
  timeZoneAbbreviation,
  toDateOrNull,
} from './admin-shared';

interface PhaseTabProps {
  contest: ContestPublicDto;
}

/** Plain-words consequences. These are read aloud in the confirm dialog. */
const PHASE_EFFECTS: Record<ContestPhase, string> = {
  SETUP:
    'The gallery, the upload form and voting all disappear for members. Anything already submitted stays safe, but nobody can see or change it.',
  SUBMISSIONS_OPEN:
    'Members will immediately be able to upload, replace and withdraw their entry. Voting stays closed.',
  VOTING_OPEN:
    'Members will immediately be able to vote. Entries are shown under their anonymous aliases and uploads are refused.',
  CLOSED:
    'Voting stops immediately. Ballots already cast are sealed; nobody can add or change one. Results stay hidden until you publish them.',
  RESULTS_PUBLISHED:
    'Every member immediately sees the final result, including the winning entry and the round-by-round count.',
};

const PHASE_ORDER_NOTE =
  'Forcing a phase does not change any date. The moment you clear the override, the clock takes over again from whatever the dates say right now.';

export function PhaseTab({ contest }: PhaseTabProps): JSX.Element {
  const queryClient = useQueryClient();
  const [pendingPhase, setPendingPhase] = React.useState<ContestPhase | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false);

  /**
   * Recomputed against the server's clock reading rather than the browser's,
   * so a skewed laptop cannot make this page disagree with the API.
   */
  const serverNow = React.useMemo(() => new Date(contest.serverNow), [contest.serverNow]);

  const clockPhase = React.useMemo(
    () =>
      derivePhase(
        {
          submissionsOpenAt: toDateOrNull(contest.submissionsOpenAt),
          submissionsCloseAt: toDateOrNull(contest.submissionsCloseAt),
          votingOpensAt: toDateOrNull(contest.votingOpensAt),
          votingClosesAt: toDateOrNull(contest.votingClosesAt),
        },
        serverNow,
      ),
    [contest, serverNow],
  );

  const effectivePhase = contest.phase;

  /**
   * The contest DTO does not carry `phaseOverride`, so the override is
   * INFERRED from the divergence between the two answers above. Publication
   * also legitimately forces RESULTS_PUBLISHED without an override, so that
   * one case is called out separately instead of being blamed on an admin.
   */
  const diverged = effectivePhase !== clockPhase;
  const maybePublication = diverged && effectivePhase === 'RESULTS_PUBLISHED';
  const overrideLikely = diverged && !maybePublication;

  const setPhase = useMutation({
    mutationFn: (phase: ContestPhase | null) => api.admin.setPhase({ phase }),
    onSuccess: async (updated, phase) => {
      queryClient.setQueryData(queryKeys.contest, updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.contest }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submissions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.audit }),
      ]);
      toast.success(
        phase === null
          ? 'Override cleared — the contest follows the clock again.'
          : `Phase forced to “${PHASE_LABELS[phase]}”.`,
      );
    },
    onError: (error: unknown) => {
      toast.error(adminErrorMessage(error, 'Could not change the phase.'));
    },
  });

  const zone = timeZoneAbbreviation(serverNow);

  return (
    <div className="space-y-loose">
      {overrideLikely && (
        <div
          role="status"
          className="rounded border border-warning bg-warning-soft p-roomy"
          data-testid="phase-override-banner"
        >
          <div className="flex items-start gap-base">
            <AlertTriangle aria-hidden className="mt-hair size-5 shrink-0 text-warning" />
            <div>
              <p className="text-body font-semibold text-ink">
                A manual phase override is in force.
              </p>
              <p className="mt-hair max-w-measure text-sm text-ink">
                The contest is behaving as <strong>{PHASE_LABELS[effectivePhase]}</strong>, but the
                dates say it should be <strong>{PHASE_LABELS[clockPhase]}</strong>. The timeline on
                the previous tab is being ignored until this is cleared.
              </p>
              <Button
                variant="secondary"
                className="mt-base"
                onClick={() => setClearOpen(true)}
                loading={setPhase.isPending && setPhase.variables === null}
              >
                <Unlock aria-hidden className="size-4" />
                Return to clock-driven
              </Button>
            </div>
          </div>
        </div>
      )}

      {maybePublication && (
        <div role="status" className="rounded border border-line bg-paper-sunken p-roomy">
          <p className="max-w-measure text-sm text-ink">
            Results are published, which pins the phase to{' '}
            <strong>{PHASE_LABELS.RESULTS_PUBLISHED}</strong> regardless of the dates. That is
            publication doing its job, not an override. Unpublishing on the Results tab releases it.
          </p>
        </div>
      )}

      <Panel>
        <PanelHeader
          eyebrow="Status"
          title="Current phase"
          description={`Clock readings use the server's time, currently ${formatAbsolute(contest.serverNow)}.`}
        />
        <Divider />
        <div className="grid gap-roomy p-roomy sm:grid-cols-2">
          <Stat
            label="What members are experiencing"
            value={PHASE_LABELS[effectivePhase]}
            hint={
              overrideLikely
                ? 'Forced by an administrator — not what the dates say.'
                : 'Matches the timeline.'
            }
          />
          <Stat
            label="What the dates alone would give"
            value={PHASE_LABELS[clockPhase]}
            hint={`Derived from the timeline in ${localTimeZone} (${zone}).`}
          />
        </div>
        <Divider />
        <dl className="grid gap-base p-roomy text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-line pb-tight">
            <dt className="text-ink-muted">Submissions open</dt>
            <dd className="tabular-nums text-ink">{formatAbsolute(contest.submissionsOpenAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-line pb-tight">
            <dt className="text-ink-muted">Submissions close</dt>
            <dd className="tabular-nums text-ink">{formatAbsolute(contest.submissionsCloseAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-line pb-tight">
            <dt className="text-ink-muted">Voting opens</dt>
            <dd className="tabular-nums text-ink">{formatAbsolute(contest.votingOpensAt)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-line pb-tight">
            <dt className="text-ink-muted">Voting closes</dt>
            <dd className="tabular-nums text-ink">{formatAbsolute(contest.votingClosesAt)}</dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Override"
          title="Force a phase"
          description={PHASE_ORDER_NOTE}
          actions={
            overrideLikely ? (
              <Button
                variant="secondary"
                onClick={() => setClearOpen(true)}
                loading={setPhase.isPending && setPhase.variables === null}
              >
                <Unlock aria-hidden className="size-4" />
                Clear override
              </Button>
            ) : (
              <Badge tone="neutral">
                <Clock aria-hidden className="size-3" />
                Clock-driven
              </Badge>
            )
          }
        />
        <Divider />
        <ul className="divide-y divide-line">
          {CONTEST_PHASES.map((phase) => {
            const isEffective = phase === effectivePhase;
            const isForced = overrideLikely && isEffective;
            return (
              <li key={phase} className="flex items-start justify-between gap-6 p-roomy">
                <div className="max-w-measure">
                  <p className="flex items-center gap-2 text-body font-medium text-ink">
                    {PHASE_LABELS[phase]}
                    {isForced && (
                      <Badge tone="warning">
                        <Lock aria-hidden className="size-3" />
                        Forced
                      </Badge>
                    )}
                    {isEffective && !isForced && <Badge tone="accent">Current</Badge>}
                    {phase === clockPhase && !isEffective && (
                      <Badge tone="neutral">Where the clock is</Badge>
                    )}
                  </p>
                  <p className="mt-hair text-sm text-ink-muted">{PHASE_EFFECTS[phase]}</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={isEffective}
                  onClick={() => setPendingPhase(phase)}
                  loading={setPhase.isPending && setPhase.variables === phase}
                >
                  {isEffective ? 'In force' : 'Force this phase'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <ConfirmDialog
        open={pendingPhase !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPhase(null);
        }}
        title={pendingPhase ? `Force “${PHASE_LABELS[pendingPhase]}”?` : 'Force phase'}
        description={
          pendingPhase
            ? `${PHASE_EFFECTS[pendingPhase]} The timeline dates stop being consulted until you clear the override, and this change is recorded in the audit log.`
            : undefined
        }
        confirmLabel="Force phase"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (!pendingPhase) return;
          const phase = pendingPhase;
          setPendingPhase(null);
          setPhase.mutate(phase);
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Return to clock-driven phases?"
        description={`The override is removed and the contest immediately becomes “${PHASE_LABELS[clockPhase]}”, because that is what the dates say right now. Members will see that change at once.`}
        confirmLabel="Clear override"
        cancelLabel="Keep override"
        onConfirm={() => {
          setClearOpen(false);
          setPhase.mutate(null);
        }}
      />
    </div>
  );
}
