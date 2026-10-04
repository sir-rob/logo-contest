/**
 * Tab 5 — Results.
 *
 * Three things here are load-bearing.
 *
 *  1. TIE-BREAKS ARE NOT AN EDGE CASE. With ~15 ballots and five ranks, ties
 *     are routine. So every tie the deterministic chain already settled is
 *     shown with its `TIE_BREAK_LABELS` reason — the admin can see what was
 *     decided for them and why — and the one tie the chain refuses to settle
 *     on its own (the one that picks the WINNER) gets a proper side-by-side
 *     chooser rather than an error message.
 *
 *  2. `RESULTS_TOO_FEW_BALLOTS` is the anonymity floor doing its job, not a
 *     malfunction. It is explained in those terms.
 *
 *  3. The CSV is described as what it is: a file that lets a sceptic recount
 *     the contest from scratch without learning who voted how.
 */

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator, Download, EyeOff, Globe, Scale } from 'lucide-react';
import {
  TIE_BREAK_LABELS,
  type PublicSubmissionDto,
  type ResolveTieBody,
  type ResultsDto,
  type TieBreak,
} from '@contest/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import {
  Badge,
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  Panel,
  PanelHeader,
  Stat,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { adminErrorMessage, adminResultsKey, errorCodeOf, formatAbsoluteWithYear } from './admin-shared';

type Snapshot = ResultsDto['snapshot'];
type Round = Snapshot['rounds'][number];

interface TieOccurrence {
  round: number;
  tieBreak: TieBreak;
  /** Tallies as they stood in the round the tie happened, for context. */
  tallies: Record<string, number>;
}

/** Mirrors `finalTieBreakForWinner` on the server: last tie containing the winner. */
function finalTieForWinner(snapshot: Snapshot): TieOccurrence | null {
  const winner = snapshot.winnerSubmissionId;
  if (!winner) return null;
  for (let i = snapshot.rounds.length - 1; i >= 0; i -= 1) {
    const round: Round | undefined = snapshot.rounds[i];
    const tb = round?.tieBreak;
    if (round && tb && tb.tiedCandidates.includes(winner)) {
      return { round: round.round, tieBreak: tb, tallies: round.tallies };
    }
  }
  return null;
}

function allTies(snapshot: Snapshot): TieOccurrence[] {
  const out: TieOccurrence[] = [];
  for (const round of snapshot.rounds) {
    if (round.tieBreak) {
      out.push({ round: round.round, tieBreak: round.tieBreak, tallies: round.tallies });
    }
  }
  return out;
}

function labelFor(entries: PublicSubmissionDto[], id: string): string {
  const entry = entries.find((e) => e.id === id);
  return entry?.alias ?? entry?.title ?? `Entry ${id.slice(0, 6)}`;
}

/**
 * The chooser. Tied entries side by side — thumbnail, alias, and the tallies
 * that got them here — because "eliminate sub-7f3a" is not a decision anyone
 * can make responsibly.
 */
function TieChooser({
  occurrence,
  entries,
  totalBallots,
  onResolve,
  pending,
}: {
  occurrence: TieOccurrence;
  entries: PublicSubmissionDto[];
  totalBallots: number;
  onResolve: (body: ResolveTieBody) => void;
  pending: boolean;
}): JSX.Element {
  const [eliminate, setEliminate] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const tied = occurrence.tieBreak.tiedCandidates;

  return (
    <Panel>
      <PanelHeader
        eyebrow={`Round ${occurrence.round}`}
        title="A tie needs your decision"
        description={
          `${tied.length} entries are level and the automatic chain cannot separate them in a way ` +
          `the result can rest on. Choose which one is eliminated. Whichever you pick, the other ` +
          `survives to the next round — you are not picking the winner directly.`
        }
      />
      <Divider />

      <div className="grid gap-base p-roomy sm:grid-cols-2 lg:grid-cols-3">
        {tied.map((id) => {
          const entry = entries.find((e) => e.id === id);
          const votes = occurrence.tallies[id] ?? 0;
          const selected = eliminate === id;
          return (
            <label
              key={id}
              className={cn(
                'flex cursor-pointer gap-base rounded border p-base transition-colors duration-fast',
                'focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-paper',
                selected ? 'border-danger bg-danger-soft' : 'border-line hover:bg-paper-sunken',
              )}
            >
              <input
                type="radio"
                name={`tie-${occurrence.round}`}
                value={id}
                checked={selected}
                onChange={() => setEliminate(id)}
                className="sr-only"
              />
              {entry ? (
                <img
                  src={entry.thumbUrl}
                  alt={`Thumbnail of ${labelFor(entries, id)}`}
                  className="h-16 w-16 shrink-0 rounded border border-line bg-paper-sunken object-contain"
                />
              ) : (
                <div
                  aria-hidden
                  className="h-16 w-16 shrink-0 rounded border border-line bg-paper-sunken"
                />
              )}
              <div className="min-w-0">
                <p className="text-body font-medium text-ink">{labelFor(entries, id)}</p>
                <p className="text-sm tabular-nums text-ink-muted">
                  {votes} {votes === 1 ? 'vote' : 'votes'} of {totalBallots} ballots
                </p>
                <p className="mt-hair text-xs font-medium text-ink">
                  {selected ? 'Will be eliminated' : 'Select to eliminate'}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      <Divider />
      <div className="flex flex-wrap items-center gap-base p-roomy">
        <Button
          variant="danger"
          disabled={eliminate === null}
          loading={pending}
          onClick={() => setConfirmOpen(true)}
        >
          <Scale aria-hidden className="size-4" />
          Eliminate the selected entry
        </Button>
        <p className="text-sm text-ink-muted">
          Your choice is stored as an <code className="font-mono text-xs">admin_override</code>{' '}
          tie-break, attributed to you, and the count is re-run from it.
        </p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title={
          eliminate
            ? `Eliminate ${labelFor(entries, eliminate)}?`
            : 'Eliminate the selected entry'
        }
        description={
          eliminate
            ? `${labelFor(entries, eliminate)} is removed from round ${occurrence.round} and its ballots transfer to their next preference. The count is recomputed immediately and the decision is recorded in the audit log under your name — this is the one part of the result a human chose rather than the ballots.`
            : undefined
        }
        confirmLabel="Eliminate"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (!eliminate) return;
          setConfirmOpen(false);
          onResolve({ tiedCandidates: [...tied], eliminate });
        }}
      />
    </Panel>
  );
}

export function ResultsTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [results, setResults] = React.useState<ResultsDto | null>(null);
  const [blockedMessage, setBlockedMessage] = React.useState<string | null>(null);
  const [computeOpen, setComputeOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [unpublishOpen, setUnpublishOpen] = React.useState(false);

  const invalidate = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.results }),
      queryClient.invalidateQueries({ queryKey: queryKeys.contest }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.audit }),
      queryClient.invalidateQueries({ queryKey: adminResultsKey }),
    ]);
  }, [queryClient]);

  const compute = useMutation({
    mutationFn: () => api.admin.computeResults(),
    onSuccess: async (data) => {
      setResults(data);
      setBlockedMessage(null);
      queryClient.setQueryData(adminResultsKey, data);
      await invalidate();
      toast.success('Results computed. Nothing is visible to members until you publish.');
    },
    onError: (error: unknown) => {
      setBlockedMessage(adminErrorMessage(error, 'Could not compute results.'));
      toast.error(adminErrorMessage(error, 'Could not compute results.'));
    },
  });

  const publish = useMutation({
    mutationFn: () => api.admin.publishResults(),
    onSuccess: async () => {
      setBlockedMessage(null);
      await invalidate();
      toast.success('Results published. Every member can see them now.');
    },
    onError: (error: unknown) => {
      const code = errorCodeOf(error);
      const message = adminErrorMessage(error, 'Could not publish results.');
      setBlockedMessage(message);
      if (code === 'RESULTS_UNRESOLVED_TIE') {
        // Re-compute so the snapshot (and therefore the tie to resolve) is in
        // hand; publishing failed precisely because nobody has chosen yet.
        compute.mutate();
      }
      toast.error(message);
    },
  });

  const unpublish = useMutation({
    mutationFn: () => api.admin.unpublishResults(),
    onSuccess: async () => {
      await invalidate();
      toast.success('Results unpublished and hidden from members again.');
    },
    onError: (error: unknown) => toast.error(adminErrorMessage(error, 'Could not unpublish results.')),
  });

  const resolveTie = useMutation({
    mutationFn: (body: ResolveTieBody) => api.admin.resolveTie(body),
    onSuccess: async (data) => {
      setResults(data);
      setBlockedMessage(null);
      queryClient.setQueryData(adminResultsKey, data);
      await invalidate();
      toast.success('Tie resolved. The count has been re-run.');
    },
    onError: (error: unknown) => toast.error(adminErrorMessage(error, 'Could not resolve the tie.')),
  });

  const [downloading, setDownloading] = React.useState(false);
  const downloadCsv = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await api.admin.exportBallotsCsv();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ballots-anonymised.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.audit });
      toast.success('Anonymised ballots downloaded.');
    } catch (error) {
      toast.error(adminErrorMessage(error, 'Could not export the ballots.'));
    } finally {
      setDownloading(false);
    }
  };

  const snapshot = results?.snapshot ?? null;
  const entries = results?.entries ?? [];
  const ties = snapshot ? allTies(snapshot) : [];
  const finalTie = snapshot ? finalTieForWinner(snapshot) : null;
  const needsDecision = finalTie !== null && finalTie.tieBreak.reason !== 'admin_override';
  const published = snapshot?.published ?? false;

  return (
    <div className="space-y-loose">
      <Panel>
        <PanelHeader
          eyebrow="Count"
          title="Compute and publish"
          description="Computing is private — it produces a snapshot only admins can see. Publishing is what members experience."
        />
        <Divider />
        <div className="flex flex-wrap gap-base p-roomy">
          <Button variant="primary" onClick={() => setComputeOpen(true)} loading={compute.isPending}>
            <Calculator aria-hidden className="size-4" />
            Compute results
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPublishOpen(true)}
            loading={publish.isPending}
            disabled={needsDecision}
          >
            <Globe aria-hidden className="size-4" />
            Publish to members
          </Button>
          <Button variant="ghost" onClick={() => setUnpublishOpen(true)} loading={unpublish.isPending}>
            <EyeOff aria-hidden className="size-4" />
            Unpublish
          </Button>
          <Button variant="ghost" onClick={() => void downloadCsv()} loading={downloading}>
            <Download aria-hidden className="size-4" />
            Download anonymised ballots (CSV)
          </Button>
        </div>
        <p className="max-w-measure px-roomy pb-roomy text-sm text-ink-muted">
          The CSV contains one row per ballot with the ranked entry aliases and no voter column —
          it lets anyone who doubts the count recount it from scratch without learning who voted
          how. Exporting it is itself recorded in the audit log.
        </p>

        {blockedMessage && (
          <>
            <Divider />
            <div role="alert" className="m-roomy rounded border border-warning bg-warning-soft p-roomy">
              <p className="max-w-measure text-sm text-ink">{blockedMessage}</p>
            </div>
          </>
        )}
      </Panel>

      {needsDecision && finalTie && snapshot && (
        <TieChooser
          occurrence={finalTie}
          entries={entries}
          totalBallots={snapshot.totalBallots}
          onResolve={(body) => resolveTie.mutate(body)}
          pending={resolveTie.isPending}
        />
      )}

      {!snapshot ? (
        <Panel>
          <EmptyState
            title="No count in hand"
            description="Run “Compute results” to produce a private snapshot. Nothing becomes visible to members until you publish it."
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-base sm:grid-cols-4">
            <Stat
              label="Ballots counted"
              value={String(snapshot.totalBallots)}
              hint="One per voter who submitted a ranking."
            />
            <Stat
              label="Rounds"
              value={String(snapshot.rounds.length)}
              hint="Instant-runoff eliminations until someone passed 50%."
            />
            <Stat
              label="Exhausted at the end"
              value={String(snapshot.exhaustedFinal)}
              hint="Ballots whose every ranked entry had been eliminated."
            />
            <Stat
              label="Visibility"
              value={published ? 'Published' : 'Admins only'}
              hint={
                published
                  ? 'Members can see the winner and every round.'
                  : 'Nobody outside this page can see the count.'
              }
            />
          </div>

          <Panel>
            <PanelHeader
              eyebrow="Outcome"
              title={results?.winner ? `Winner: ${results.winner.alias ?? results.winner.title ?? 'Entry'}` : 'No winner determined'}
              description={`Computed ${formatAbsoluteWithYear(snapshot.computedAt)}. Tie-break seed ${snapshot.tieBreakSeed}.`}
              actions={published ? <Badge tone="success">Published</Badge> : <Badge tone="neutral">Draft</Badge>}
            />
            {results?.winner && (
              <>
                <Divider />
                <div className="flex items-center gap-base p-roomy">
                  <img
                    src={results.winner.thumbUrl}
                    alt={`Winning entry ${results.winner.alias ?? ''}`}
                    className="h-20 w-20 rounded border border-line bg-paper-sunken object-contain"
                  />
                  <div>
                    <p className="text-body font-medium text-ink">
                      {results.winner.alias ?? results.winner.title ?? 'Winning entry'}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {results.winnerCredit
                        ? `Credited to ${results.winnerCredit} (they opted in at upload time).`
                        : 'The designer did not opt in to being credited, so they stay anonymous.'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Tie-breaks"
              title="How ties were settled"
              description={
                ties.length === 0
                  ? 'No round needed one. The ballots decided every elimination on their own.'
                  : 'Each of these was decided by the deterministic chain, in the order the rules specify, unless it says an administrator chose.'
              }
            />
            {ties.length > 0 && (
              <>
                <Divider />
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Tie-breaks by round</caption>
                    <thead>
                      <tr className="border-b border-line-strong text-left">
                        <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                          Round
                        </th>
                        <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                          Tied entries
                        </th>
                        <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                          Eliminated
                        </th>
                        <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                          Decided by
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ties.map((tie) => (
                        <tr key={`${tie.round}-${tie.tieBreak.eliminated}`} className="border-b border-line last:border-0">
                          <td className="px-roomy py-tight tabular-nums text-ink">{tie.round}</td>
                          <td className="px-roomy py-tight text-ink">
                            {tie.tieBreak.tiedCandidates
                              .map((id) => `${labelFor(entries, id)} (${tie.tallies[id] ?? 0})`)
                              .join(' · ')}
                          </td>
                          <td className="px-roomy py-tight text-ink">
                            {labelFor(entries, tie.tieBreak.eliminated)}
                          </td>
                          <td className="px-roomy py-tight">
                            <Badge
                              tone={tie.tieBreak.reason === 'admin_override' ? 'accent' : 'neutral'}
                            >
                              {TIE_BREAK_LABELS[tie.tieBreak.reason]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Detail" title="Round by round" />
            <Divider />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Votes held by each entry at the start of each instant-runoff round
                </caption>
                <thead>
                  <tr className="border-b border-line-strong text-left">
                    <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                      Round
                    </th>
                    <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                      Tallies
                    </th>
                    <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                      Active
                    </th>
                    <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                      Exhausted
                    </th>
                    <th scope="col" className="px-roomy py-tight font-medium text-ink-muted">
                      Eliminated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rounds.map((round) => (
                    <tr key={round.round} className="border-b border-line last:border-0">
                      <td className="px-roomy py-tight tabular-nums text-ink">{round.round}</td>
                      <td className="px-roomy py-tight text-ink">
                        {Object.entries(round.tallies)
                          .sort(([, a], [, b]) => b - a)
                          .map(([id, votes]) => `${labelFor(entries, id)} ${votes}`)
                          .join(' · ')}
                      </td>
                      <td className="px-roomy py-tight tabular-nums text-ink-muted">
                        {round.activeBallots}
                      </td>
                      <td className="px-roomy py-tight tabular-nums text-ink-muted">
                        {round.exhaustedBallots}
                      </td>
                      <td className="px-roomy py-tight text-ink">
                        {round.winner
                          ? `${labelFor(entries, round.winner)} reached a majority`
                          : round.eliminated
                            ? labelFor(entries, round.eliminated)
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={computeOpen}
        onOpenChange={setComputeOpen}
        title="Compute results now?"
        description="This runs the instant-runoff count over the sealed ballots and stores a snapshot. Only administrators can see it — members see nothing change. Safe to re-run; it replaces the previous draft."
        confirmLabel="Compute"
        cancelLabel="Cancel"
        onConfirm={() => {
          setComputeOpen(false);
          compute.mutate();
        }}
      />

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish results to every member?"
        description="Every member immediately sees the winning entry, the round-by-round count and the tie-breaks that settled it. The winner's name appears only if they opted in to being credited. Voters are never named. You can unpublish afterwards, but people will already have seen it."
        confirmLabel="Publish"
        cancelLabel="Cancel"
        onConfirm={() => {
          setPublishOpen(false);
          publish.mutate();
        }}
      />

      <ConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        destructive
        title="Hide published results again?"
        description="Members lose access to the winner and the count, and the contest stops reporting itself as finished. The snapshot is kept; this only changes who can see it. Anyone who already read the result still knows it."
        confirmLabel="Unpublish"
        cancelLabel="Cancel"
        onConfirm={() => {
          setUnpublishOpen(false);
          unpublish.mutate();
        }}
      />
    </div>
  );
}
