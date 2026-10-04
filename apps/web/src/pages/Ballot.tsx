/**
 * The ranked-choice ballot.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT A VOTER IS DOING HERE
 *
 * Ranking up to five anonymous entries, 1 = most preferred. Counting is
 * instant-runoff: the lowest-placed candidate is eliminated and their ballots
 * transfer to each voter's next surviving preference, until someone holds a
 * majority. Two consequences shape this screen:
 *
 *   - A partial ballot is a real ballot. Ranking two entries is not a
 *     half-finished task; it is a complete statement that transfers twice and
 *     then exhausts. Nothing here calls it incomplete, warns about it, or
 *     blocks a save on it.
 *   - Rank is position, not a label. Removing #2 renumbers everything below it,
 *     because a ballot with a hole in it is not something IRV can count — and
 *     not something `SaveBallotBody` can express.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * KEYBOARD IS A FIRST-CLASS PATH
 *
 * Every operation exists twice — as a drag, and as a real `<button>`:
 *
 *   pool card    → "Add to ballot", plus digit keys 1–5 to drop straight into
 *                  a rank while the card has focus
 *   ballot slot  → "Move up" / "Move down" / "Remove"
 *   both         → a focusable drag handle wired to dnd-kit's keyboard sensor
 *
 * A voter can complete, reorder and save an entire ballot with Tab, Enter and
 * the arrow keys, never touching a pointer. Changes are narrated through one
 * `aria-live="polite"` region; dnd-kit's own announcer is deliberately silenced
 * so there is exactly one voice rather than two talking over each other.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SELF-VOTING
 *
 * Allowed, at any position including rank 1 (spec §5, decided). The voter's own
 * entry is never hidden, never disabled and never sorted to the end. It carries
 * a quiet "Yours" badge so nobody ranks themselves by accident, and that is the
 * entire difference.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ListOrdered, RefreshCw } from 'lucide-react';
import {
  canVote,
  derivePhase,
  type ContestPhase,
  type PublicSubmissionDto,
} from '@contest/shared';
import { api, ApiClientError } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import {
  Badge,
  Button,
  ConfirmDialog,
  Countdown,
  Divider,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/ui';
import { plural } from '@/lib/utils';
import { BallotSkeleton } from '@/components/ballot/BallotSkeleton';
import { BALLOT_DROPPABLE_ID, BallotSlots, slotButtonId } from '@/components/ballot/BallotSlots';
import { EntryPool, POOL_DROPPABLE_ID } from '@/components/ballot/EntryPool';
import { poolAddButtonId } from '@/components/ballot/PoolEntry';
import { EntryThumb } from '@/components/ballot/EntryThumb';
import { FinalBallot } from '@/components/ballot/FinalBallot';
import { SaveStatus } from '@/components/ballot/SaveStatus';
import {
  activeIds,
  labelFor,
  listSentence,
  moveWithin,
  placeAt,
  rankingCap,
  removeId,
  sanitiseRanking,
  strandedIds,
} from '@/components/ballot/ballot-logic';
import { useBallotAutosave } from '@/components/ballot/useBallotAutosave';

/** Entries that left the contest while this ballot was open. */
interface Amendment {
  labels: string[];
  /** The dialog is dismissible; the banner it leaves behind is not. */
  dialogOpen: boolean;
}

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'To move an entry with the keyboard, focus its drag handle and press space, ' +
    'then use the arrow keys to move it and space again to drop. Press escape to cancel. ' +
    'Dragging is optional: every entry also has Add to ballot, Move up, Move down and ' +
    'Remove buttons that work on their own.',
};

/**
 * dnd-kit ships its own live region. Every announcement here returns undefined
 * so it stays silent and all narration goes through the single polite region
 * below — two announcers talking over each other is worse than one.
 */
const SILENT_DND_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

const PAGE_EYEBROW = 'Ranked choice';
const PAGE_TITLE = 'Your ballot';

export function BallotPage(): JSX.Element {
  const queryClient = useQueryClient();

  const contestQuery = useQuery({ queryKey: queryKeys.contest, queryFn: () => api.contest() });
  const entriesQuery = useQuery({
    queryKey: queryKeys.submissions,
    queryFn: () => api.submissions(),
  });
  const ballotQuery = useQuery({ queryKey: queryKeys.ballot, queryFn: () => api.myBallot() });

  const contest = contestQuery.data ?? null;
  const entries = useMemo<PublicSubmissionDto[]>(
    () => entriesQuery.data ?? [],
    [entriesQuery.data],
  );
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry] as const)),
    [entries],
  );
  const active = useMemo(() => activeIds(entries), [entries]);
  const cap = rankingCap(entries.length, contest?.maxRanks);

  // -----------------------------------------------------------------------
  // Clock. Anchored to the server, never to the browser — a voter whose laptop
  // is twenty minutes fast should not be told voting closed early, and one
  // whose laptop is slow should not be handed a ballot the server will reject.
  // -----------------------------------------------------------------------
  const serverNow = contest?.serverNow ?? null;
  const [skewMs, setSkewMs] = useState(0);
  const [localNowMs, setLocalNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (serverNow === null) return;
    setSkewMs(Date.parse(serverNow) - Date.now());
  }, [serverNow]);

  useEffect(() => {
    const timer = window.setInterval(() => setLocalNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const nowMs = localNowMs + skewMs;

  /** True once the server has told us, in so many words, that voting is over. */
  const [serverClosed, setServerClosed] = useState(false);

  const phase: ContestPhase | null = useMemo(() => {
    if (!contest) return null;
    const derived = derivePhase(
      {
        submissionsOpenAt: toDate(contest.submissionsOpenAt),
        submissionsCloseAt: toDate(contest.submissionsCloseAt),
        votingOpensAt: toDate(contest.votingOpensAt),
        votingClosesAt: toDate(contest.votingClosesAt),
      },
      new Date(nowMs),
    );
    // The server's phase wins: it knows about admin overrides and published
    // results, which the public windows do not describe. The local derivation
    // gets exactly one vote, and only in the safe direction — closing the
    // ballot the moment the deadline passes, rather than letting someone keep
    // editing into a rejection they did not see coming.
    if (contest.phase === 'VOTING_OPEN' && derived === 'CLOSED') return 'CLOSED';
    return contest.phase;
  }, [contest, nowMs]);

  const votingOpen = phase !== null && canVote(phase) && !serverClosed;

  // -----------------------------------------------------------------------
  // The ballot itself. `null` means "not seeded from the server yet"; an empty
  // array is a real and meaningful state.
  // -----------------------------------------------------------------------
  const [ranking, setRanking] = useState<string[] | null>(null);
  const current = useMemo(() => ranking ?? [], [ranking]);
  const currentRef = useRef<string[]>(current);
  currentRef.current = current;

  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
  const say = useCallback((text: string) => {
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }));
  }, []);

  const [amendment, setAmendment] = useState<Amendment | null>(null);

  const dataReady = contestQuery.isSuccess && entriesQuery.isSuccess && ballotQuery.isSuccess;
  const serverBallot = ballotQuery.data ?? null;

  // Seed once. Anything the server has that the contest no longer lists is an
  // entry withdrawn or disqualified since this person last looked — handled as
  // an amendment they confirm, never as a silent deletion.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!dataReady || seededRef.current) return;
    seededRef.current = true;

    const raw = serverBallot ?? [];
    const stranded = strandedIds(raw, active);
    setRanking(sanitiseRanking(raw, active, cap));

    if (stranded.length > 0) {
      const labels = stranded.map((id) => labelFor(entriesById.get(id) ?? null));
      setAmendment({ labels, dialogOpen: true });
      say(
        `${listSentence(labels)} ${stranded.length === 1 ? 'is' : 'are'} no longer in the contest ` +
          'and has been removed from your ballot. Confirm the amended ballot to save it.',
      );
    }
  }, [dataReady, serverBallot, active, cap, entriesById, say]);

  /**
   * Work out WHICH entry disappeared, take it off the ballot, renumber, and ask
   * for confirmation. The server tells us something is wrong; it does not
   * reliably tell us which id, so we re-read the entry list and diff.
   */
  const reconcileStranded = useCallback(
    async (error: ApiClientError): Promise<void> => {
      const fresh = await queryClient.fetchQuery({
        queryKey: queryKeys.submissions,
        queryFn: () => api.submissions(),
      });
      const freshActive = activeIds(fresh);

      const gone = new Set(strandedIds(currentRef.current, freshActive));
      // If the server named an id in `fields`, believe that too.
      for (const [key, value] of Object.entries(error.fields ?? {})) {
        for (const candidate of [key, value]) {
          if (currentRef.current.includes(candidate)) gone.add(candidate);
        }
      }

      if (gone.size === 0) {
        say('One of your ranked entries could not be saved. Try again, or reload the page.');
        return;
      }

      const labels = [...gone].map((id) => labelFor(entriesById.get(id) ?? null));
      setRanking((previous) => (previous ?? []).filter((id) => !gone.has(id)));
      setAmendment({ labels, dialogOpen: true });
      say(
        `${listSentence(labels)} ${gone.size === 1 ? 'is' : 'are'} no longer in the contest ` +
          'and has been removed from your ballot. Confirm the amended ballot to save it.',
      );
    },
    [queryClient, entriesById, say],
  );

  // Errors are handled by CODE, never by matching on the message text — that
  // prose is user-facing copy and is free to change without warning.
  const handleSaveError = useCallback(
    (error: ApiClientError) => {
      switch (error.code) {
        case 'PHASE_VOTING_CLOSED': {
          setServerClosed(true);
          void queryClient.invalidateQueries({ queryKey: queryKeys.ballot });
          void queryClient.invalidateQueries({ queryKey: queryKeys.contest });
          say('Voting has closed. Your ballot is now final and can no longer be changed.');
          return;
        }
        case 'BALLOT_UNKNOWN_SUBMISSION':
        case 'BALLOT_INACTIVE_SUBMISSION': {
          void reconcileStranded(error);
          return;
        }
        case 'BALLOT_DUPLICATE_RANKS':
        case 'BALLOT_TOO_MANY_RANKS': {
          // The local model cannot produce either of these, so if the server
          // says otherwise our copy has drifted. Repair rather than argue.
          setRanking((previous) => sanitiseRanking(previous ?? [], active, cap));
          say('Your ballot was adjusted to fit the rules. Check it and save again.');
          return;
        }
        case 'BALLOT_EMPTY': {
          // We only ever send a non-empty ranking, so this means the server and
          // this tab disagree about whether a ballot exists. Nothing to save.
          say('There was nothing to save. Rank at least one entry.');
          return;
        }
        default:
          // Everything else surfaces through SaveStatus with a retry. The local
          // ranking is untouched, so nothing the voter did is lost.
          return;
      }
    },
    [queryClient, say, active, cap, reconcileStranded],
  );

  const autosave = useBallotAutosave({
    ranking: current,
    enabled: votingOpen && dataReady,
    paused: amendment !== null,
    serverRanking: dataReady ? sanitiseRanking(serverBallot ?? [], active, cap) : null,
    onError: handleSaveError,
  });

  // -----------------------------------------------------------------------
  // Mutations. Each one announces, in the voter's words, what just happened.
  // -----------------------------------------------------------------------
  const handleAdd = useCallback(
    (id: string, index?: number) => {
      const label = labelFor(entriesById.get(id) ?? null);
      const base = currentRef.current;

      if (!base.includes(id) && base.length >= cap) {
        say(
          `Your ballot is full at ${plural(cap, 'entry', 'entries')}. Remove one to add ${label}.`,
        );
        return;
      }

      const next = placeAt(base, id, cap, index);
      const position = next.indexOf(id) + 1;
      setRanking(next);
      say(`${label} added to your ballot at position ${position} of ${next.length}.`);
    },
    [cap, entriesById, say],
  );

  const handleMove = useCallback(
    (from: number, to: number) => {
      const base = currentRef.current;
      const id = base[from];
      if (id === undefined) return;

      const next = moveWithin(base, from, to);
      const position = next.indexOf(id) + 1;
      if (position === from + 1) return;

      setRanking(next);
      say(`${labelFor(entriesById.get(id) ?? null)} moved to position ${position}.`);
    },
    [entriesById, say],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const base = currentRef.current;
      if (!base.includes(id)) return;

      const next = removeId(base, id);
      setRanking(next);
      say(
        `${labelFor(entriesById.get(id) ?? null)} removed from your ballot. ` +
          (next.length === 0
            ? 'Your ballot is now empty.'
            : `${plural(next.length, 'entry', 'entries')} still ranked.`),
      );
    },
    [entriesById, say],
  );

  /**
   * Entries still available to rank. A ranked entry leaves the pool, which
   * keeps every dnd-kit id unique across the two lists and makes "what is left
   * to consider" answerable at a glance.
   */
  const poolEntries = useMemo(
    () => entries.filter((entry) => !current.includes(entry.id)),
    [entries, current],
  );

  // -----------------------------------------------------------------------
  // Focus restoration.
  //
  // Every mutation unmounts the control that triggered it: "Add to ballot"
  // takes the card out of the pool, "Remove" takes the row out of the slots,
  // and "Move up" renders a different row at that index. Without this, focus
  // falls to <body> after every single action and a keyboard voter has to tab
  // in from the top of the document again to place their second choice.
  //
  // Each handler names the controls it would like focus to land on, best
  // first, and the effect takes the first one that exists and is enabled.
  // -----------------------------------------------------------------------
  const focusAfterRenderRef = useRef<string[] | null>(null);

  useEffect(() => {
    const candidates = focusAfterRenderRef.current;
    if (!candidates) return;
    focusAfterRenderRef.current = null;

    for (const id of candidates) {
      const element = document.getElementById(id);
      if (element instanceof HTMLButtonElement && !element.disabled) {
        element.focus();
        return;
      }
    }
  });

  /** Add from the button/keyboard path — keeps the voter in the pool. */
  const handleAddFromControl = useCallback(
    (id: string, index?: number) => {
      const base = currentRef.current;
      if (!base.includes(id) && base.length >= cap) {
        handleFull();
        return;
      }

      const poolIndex = poolEntries.findIndex((entry) => entry.id === id);
      const successor = poolEntries[poolIndex + 1] ?? poolEntries[poolIndex - 1];
      focusAfterRenderRef.current = successor
        ? [poolAddButtonId(successor.id)]
        : // Pool is now empty: the only sensible place left is the row we made.
          [slotButtonId('remove', base.length)];

      handleAdd(id, index);
    },
    // handleFull is stable; declared below but captured by reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cap, poolEntries, handleAdd],
  );

  /** Move from the button path — keeps focus on the same control, new row. */
  const handleMoveFromControl = useCallback(
    (from: number, to: number) => {
      const base = currentRef.current;
      const landing = Math.max(0, Math.min(base.length - 1, to));
      const direction = to < from ? 'up' : 'down';

      // Prefer the button they just pressed. If it is disabled at the new
      // position (top of the list for "up"), fall through to its neighbour
      // rather than dropping focus entirely.
      focusAfterRenderRef.current =
        direction === 'up'
          ? [
              slotButtonId('up', landing),
              slotButtonId('down', landing),
              slotButtonId('remove', landing),
            ]
          : [
              slotButtonId('down', landing),
              slotButtonId('up', landing),
              slotButtonId('remove', landing),
            ];

      handleMove(from, to);
    },
    [handleMove],
  );

  /** Remove from the button path — stay in the slots, or follow the entry back. */
  const handleRemoveFromControl = useCallback(
    (id: string) => {
      const base = currentRef.current;
      const index = base.indexOf(id);
      if (index === -1) return;

      const remaining = base.length - 1;
      focusAfterRenderRef.current =
        remaining === 0
          ? // Ballot is empty now; the entry is back in the pool, so go with it.
            [poolAddButtonId(id)]
          : [
              slotButtonId('remove', Math.min(index, remaining - 1)),
              poolAddButtonId(id),
            ];

      handleRemove(id);
    },
    [handleRemove],
  );

  const handleFull = useCallback(() => {
    say(
      `Your ballot is full at ${plural(cap, 'entry', 'entries')}. ` +
        'Remove one to make room for another.',
    );
  }, [cap, say]);

  const handleExplicitSave = useCallback(() => {
    if (!autosave.isDirty && autosave.status !== 'error') {
      say('Your ballot is already saved.');
      return;
    }
    autosave.saveNow();
  }, [autosave, say]);

  const confirmAmendment = useCallback(() => {
    setAmendment(null);
    autosave.saveNow();
    say('Amended ballot saved.');
  }, [autosave, say]);

  const dismissAmendmentDialog = useCallback(() => {
    setAmendment((previous) => (previous ? { ...previous, dialogOpen: false } : null));
  }, []);

  // -----------------------------------------------------------------------
  // Drag and drop
  // -----------------------------------------------------------------------
  const sensors = useSensors(
    // A 6px threshold so a click on "Add to ballot" stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const lastOverRef = useRef<string | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setDraggingId(id);
      lastOverRef.current = null;
      say(
        `Picked up ${labelFor(entriesById.get(id) ?? null)}. ` +
          'Use the arrow keys to move it, space to drop, escape to cancel.',
      );
    },
    [entriesById, say],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over ? String(event.over.id) : null;
      // Only speak when the target actually changes; dnd-kit fires this
      // continuously and a live region cannot keep up with that.
      if (overId === lastOverRef.current) return;
      lastOverRef.current = overId;
      if (overId === null) return;

      const base = currentRef.current;
      if (overId === POOL_DROPPABLE_ID) {
        say('Over the entry pool. Drop here to take this entry off your ballot.');
      } else if (overId === BALLOT_DROPPABLE_ID) {
        say(`Over your ballot. Drop here to place at position ${base.length + 1}.`);
      } else if (base.includes(overId)) {
        say(`Over position ${base.indexOf(overId) + 1} of your ballot.`);
      }
    },
    [say],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      lastOverRef.current = null;

      const draggedId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const label = labelFor(entriesById.get(draggedId) ?? null);

      if (overId === null) {
        say(`${label} was not moved.`);
        return;
      }

      const base = currentRef.current;
      const fromBallot = base.includes(draggedId);
      const overBallot = overId === BALLOT_DROPPABLE_ID || base.includes(overId);
      const overPool =
        overId === POOL_DROPPABLE_ID || (!base.includes(overId) && active.has(overId));

      if (!fromBallot && overBallot) {
        handleAdd(draggedId, base.includes(overId) ? base.indexOf(overId) : undefined);
        return;
      }
      if (fromBallot && overBallot) {
        const to = base.includes(overId) ? base.indexOf(overId) : base.length - 1;
        handleMove(base.indexOf(draggedId), to);
        return;
      }
      if (fromBallot && overPool) {
        handleRemove(draggedId);
        return;
      }
      say(`${label} was not moved.`);
    },
    [active, entriesById, handleAdd, handleMove, handleRemove, say],
  );

  const handleDragCancel = useCallback(() => {
    setDraggingId(null);
    lastOverRef.current = null;
    say('Move cancelled. Nothing changed.');
  }, [say]);

  const draggingEntry = draggingId === null ? null : (entriesById.get(draggingId) ?? null);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const liveRegion = (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {/* The zero-width space makes an identical repeated message re-announce. */}
      {announcement.text}
      {'\u200B'.repeat(announcement.seq % 2)}
    </p>
  );

  const loadError = contestQuery.error ?? entriesQuery.error ?? ballotQuery.error;
  if (loadError) {
    return (
      <div className="flex flex-col gap-roomy">
        {liveRegion}
        <PageHeader eyebrow={PAGE_EYEBROW} title={PAGE_TITLE} />
        <Panel>
          <PanelHeader
            title="This ballot could not be loaded"
            description={
              loadError instanceof ApiClientError
                ? loadError.message
                : 'Something went wrong on the way to the server.'
            }
          />
          <div className="mt-base">
            <Button
              variant="secondary"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.contest });
                void queryClient.invalidateQueries({ queryKey: queryKeys.submissions });
                void queryClient.invalidateQueries({ queryKey: queryKeys.ballot });
              }}
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  if (!dataReady || !contest || ranking === null) {
    return (
      <div className="flex flex-col gap-roomy">
        <PageHeader eyebrow={PAGE_EYEBROW} title={PAGE_TITLE} />
        <BallotSkeleton />
        <p className="sr-only" aria-live="polite">
          Loading your ballot.
        </p>
      </div>
    );
  }

  // Voting is over: a receipt, not a disabled form.
  if (phase === 'CLOSED' || phase === 'RESULTS_PUBLISHED' || serverClosed) {
    return (
      <div className="flex flex-col gap-roomy">
        {liveRegion}
        <PageHeader
          eyebrow={PAGE_EYEBROW}
          title={PAGE_TITLE}
          description="Voting has closed. The ranking below is what was counted."
        />
        <FinalBallot ranking={serverBallot ?? current} entriesById={entriesById} />
      </div>
    );
  }

  // Voting has not opened yet.
  if (!votingOpen) {
    return (
      <div className="flex flex-col gap-roomy">
        {liveRegion}
        <PageHeader eyebrow={PAGE_EYEBROW} title={PAGE_TITLE} />
        <Panel>
          <EmptyState
            icon={<ListOrdered aria-hidden="true" className="h-6 w-6" />}
            title="Voting has not opened yet"
            description={
              contest.votingOpensAt
                ? 'The ballot appears here the moment voting opens. Nothing to do until then.'
                : 'The ballot appears here once an admin opens voting.'
            }
            action={
              contest.votingOpensAt ? (
                <Countdown to={contest.votingOpensAt} serverNow={contest.serverNow} />
              ) : undefined
            }
          />
        </Panel>
      </div>
    );
  }

  // No entries at all — nothing to rank, and that is not the voter's problem.
  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-roomy">
        {liveRegion}
        <PageHeader eyebrow={PAGE_EYEBROW} title={PAGE_TITLE} />
        <Panel>
          <EmptyState
            icon={<ListOrdered aria-hidden="true" className="h-6 w-6" />}
            title="There is nothing to rank yet"
            description="No entries have been published for this contest. Check back once they are."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-roomy">
      {liveRegion}

      <PageHeader
        eyebrow={PAGE_EYEBROW}
        title={PAGE_TITLE}
        description={`Rank up to ${plural(cap, 'entry', 'entries')}, with 1 as your favourite. Ranking fewer is completely fine — a partial ballot is counted exactly as you leave it. Edit as often as you like until voting closes; the last version you save is the one that counts.`}
        actions={
          contest.votingClosesAt ? (
            <div className="flex flex-col gap-hair">
              <span className="eyebrow">Voting closes in</span>
              <Countdown
                to={contest.votingClosesAt}
                serverNow={contest.serverNow}
                expired="Voting has closed"
              />
            </div>
          ) : undefined
        }
      />

      {amendment ? (
        <div
          className="flex flex-wrap items-start gap-snug rounded border border-warning bg-warning-soft px-base py-snug"
          role="status"
        >
          <CircleAlert aria-hidden="true" className="mt-hair h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {listSentence(amendment.labels)} {amendment.labels.length === 1 ? 'is' : 'are'} no
              longer in the contest.
            </p>
            <p className="mt-hair text-sm text-ink-muted">
              {amendment.labels.length === 1 ? 'It has' : 'They have'} been taken off your ballot
              and the remaining entries renumbered. Nothing is saved until you confirm.
            </p>
          </div>
          <Button size="sm" onClick={confirmAmendment}>
            Save amended ballot
          </Button>
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        modifiers={[restrictToWindowEdges]}
        accessibility={{
          announcements: SILENT_DND_ANNOUNCEMENTS,
          screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/*
          DOM order is pool → ballot, which matches the desktop reading and tab
          order (entries left, slots right). On narrow screens
          `flex-col-reverse` lifts the slots above the pool so the ballot stays
          visible while choosing.
        */}
        <div className="flex flex-col-reverse gap-roomy lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-loose">
          <Panel as="section">
            <PanelHeader
              eyebrow={`${plural(entries.length, 'entry', 'entries')} · ${poolEntries.length} not yet ranked`}
              title="All entries"
              description="Anonymous, and presented identically. Add any of them to your ballot — including your own."
            />
            <div className="mt-roomy">
              <EntryPool
                entries={poolEntries}
                cap={cap}
                rankedCount={current.length}
                onAdd={handleAddFromControl}
                onFull={handleFull}
              />
            </div>
          </Panel>

          <div className="lg:sticky lg:top-base">
            <Panel as="section">
              <PanelHeader
                eyebrow={`${current.length} of ${cap} ranked`}
                title="Your ranking"
                description="1 is your favourite. A partial ballot is valid and is counted."
                actions={
                  current.some((id) => entriesById.get(id)?.isMine) ? (
                    <Badge tone="neutral">Includes your entry</Badge>
                  ) : undefined
                }
              />

              <div className="mt-roomy flex flex-col gap-base">
                {current.length === 0 ? (
                  <EmptyState
                    icon={<ListOrdered aria-hidden="true" className="h-6 w-6" />}
                    title="Pick a favourite to begin"
                    description="Add one entry or five — both are complete ballots. Use Add to ballot on any entry, or drag it into a slot."
                  />
                ) : null}

                <BallotSlots
                  ranking={current}
                  entriesById={entriesById}
                  cap={cap}
                  onMove={handleMoveFromControl}
                  onRemove={handleRemoveFromControl}
                />
              </div>

              <Divider />

              <div className="flex flex-col gap-snug">
                <SaveStatus
                  status={autosave.status}
                  lastSavedAt={autosave.lastSavedAt}
                  error={autosave.error}
                  onRetry={autosave.saveNow}
                />
                <Button
                  fullWidth
                  loading={autosave.status === 'saving'}
                  onClick={handleExplicitSave}
                >
                  Save ballot
                </Button>
                <p className="text-xs text-ink-muted">
                  Your ballot saves itself a moment after every change. The Save button is here if
                  you would rather not rely on that. Either way you can keep editing until voting
                  closes, and the last saved version is the one that counts.
                </p>
              </div>
            </Panel>
          </div>
        </div>

        <DragOverlay>
          {draggingEntry ? (
            <div className="flex items-center gap-snug rounded border border-accent bg-paper-raised p-tight">
              <EntryThumb entry={draggingEntry} className="h-10 w-10 shrink-0" eager />
              <span className="font-display text-body text-ink">{labelFor(draggingEntry)}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={amendment?.dialogOpen ?? false}
        onOpenChange={(open) => {
          if (!open) dismissAmendmentDialog();
        }}
        title={
          amendment && amendment.labels.length === 1
            ? 'An entry on your ballot has left the contest'
            : 'Entries on your ballot have left the contest'
        }
        description={
          amendment
            ? `${listSentence(amendment.labels)} ${amendment.labels.length === 1 ? 'was' : 'were'} withdrawn or disqualified, so ${amendment.labels.length === 1 ? 'it has' : 'they have'} been removed from your ballot and the remaining entries renumbered. Save this amended ballot?`
            : ''
        }
        confirmLabel="Save amended ballot"
        cancelLabel="Let me look first"
        onConfirm={confirmAmendment}
      />
    </div>
  );
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

// Named export matching the file name, as on every other page (`Dashboard`,
// `Admin`, `Gallery`) — that is what `App.tsx` imports. The `BallotPage`
// spelling is the component's own name and stays exported so `./BallotPage`
// can keep re-exporting it.
export { BallotPage as Ballot };
export default BallotPage;
