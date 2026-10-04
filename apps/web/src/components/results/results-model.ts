/**
 * The results screen's arithmetic and geometry, kept out of the components.
 *
 * Everything here is pure: `ResultsDto` in, plain data out. Two reasons that
 * matters. First, the round-by-round count is the one part of this product
 * people are entitled to be suspicious of, and a pure function is something you
 * can unit-test line by line against a known snapshot. Second, three different
 * views (the flow chart, the stacked round list, and the screen-reader table)
 * must agree exactly — if they each did their own sums, they would eventually
 * disagree, and a visualisation that contradicts its own data table is worse
 * than no visualisation.
 *
 * Vertical ordering is FINAL STANDING, not per-round tally, in every view. It
 * costs a little "who is winning right now" legibility and buys the thing that
 * matters more: a candidate occupies the same lane in every column, so the eye
 * can follow one entry across the whole count without the rows reshuffling
 * underneath it.
 */

import {
  TIE_BREAK_LABELS,
  type PublicSubmissionDto,
  type ResultsDto,
  type Round,
  type TieBreak,
  type TieBreakReason,
} from '@contest/shared';

/** The snapshot as it arrives over the wire (dates are ISO strings, not Dates). */
export type ResultSnapshotDto = ResultsDto['snapshot'];

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  /** The anonymous public label. Never an uploader's name. */
  alias: string;
  title: string | null;
  thumbUrl: string | null;
  entry: PublicSubmissionDto | null;
  /** 1 = winner, 2 = runner-up (last eliminated), and so on. */
  place: number;
  /** Round number at which this entry left the count; null for the winner. */
  eliminatedInRound: number | null;
  /** Votes held in the last round this entry was still counted in. */
  finalVotes: number;
  isWinner: boolean;
}

/**
 * A majority of *continuing* ballots. Exhausted ballots are deliberately not in
 * the denominator — that is what instant-runoff means, and §5c makes us say so
 * out loud rather than let "majority" quietly change definition mid-page.
 */
export const majorityThreshold = (activeBallots: number): number =>
  Math.floor(activeBallots / 2) + 1;

/**
 * Final standing, best first.
 *
 * `eliminationOrder` is the authority: it is the order the engine actually
 * eliminated people in, with the winner last. Reversing it gives the placement.
 * Anything that somehow appears in a tally but not in that list (a snapshot
 * written by an older engine, say) is appended by final votes rather than
 * dropped — losing a candidate silently would be the worst possible failure
 * mode for an audit view.
 */
export function buildCandidates(results: ResultsDto): Candidate[] {
  const { snapshot, entries } = results;
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const ids = new Set<string>(snapshot.eliminationOrder);
  for (const round of snapshot.rounds) {
    for (const id of Object.keys(round.tallies)) ids.add(id);
  }

  const elimIndex = new Map<string, number>();
  snapshot.eliminationOrder.forEach((id, i) => {
    if (!elimIndex.has(id)) elimIndex.set(id, i);
  });

  const eliminatedInRound = new Map<string, number>();
  for (const round of snapshot.rounds) {
    if (round.eliminated) eliminatedInRound.set(round.eliminated, round.round);
  }

  // Rounds are ordered, so the last write for an id is the last round it was
  // counted in — exactly the tally we want to show as its final figure.
  const finalVotes = new Map<string, number>();
  for (const round of snapshot.rounds) {
    for (const [id, votes] of Object.entries(round.tallies)) finalVotes.set(id, votes);
  }

  const draft = [...ids].map((id) => {
    const entry = entryById.get(id) ?? null;
    return {
      id,
      entry,
      alias: entry?.alias ?? 'Withdrawn entry',
      title: entry?.title ?? null,
      thumbUrl: entry?.thumbUrl ?? null,
      eliminatedInRound: eliminatedInRound.get(id) ?? null,
      finalVotes: finalVotes.get(id) ?? 0,
      isWinner: snapshot.winnerSubmissionId === id,
    };
  });

  draft.sort((a, b) => {
    if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
    const ea = elimIndex.get(a.id);
    const eb = elimIndex.get(b.id);
    if (ea !== undefined && eb !== undefined) return eb - ea; // eliminated later ⇒ placed higher
    if (ea !== undefined) return -1;
    if (eb !== undefined) return 1;
    if (b.finalVotes !== a.finalVotes) return b.finalVotes - a.finalVotes;
    return a.alias.localeCompare(b.alias);
  });

  return draft.map((c, i) => ({ ...c, place: i + 1 }));
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export interface RoundRow {
  candidate: Candidate;
  votes: number;
  /** Share of ballots still counting this round. */
  share: number;
  isEliminatedHere: boolean;
  isWinnerHere: boolean;
  holdsMajority: boolean;
}

export interface TransferMove {
  to: Candidate;
  count: number;
}

export interface TransferView {
  from: Candidate;
  /** Recipients, ordered by final standing so the ribbons cross as little as possible. */
  moves: TransferMove[];
  exhausted: number;
  /** Every ballot that moved, including the ones that ran out of preferences. */
  total: number;
}

export interface TieBreakView {
  tieBreak: TieBreak;
  reason: TieBreakReason;
  label: string;
  tied: Candidate[];
  eliminated: Candidate | null;
  wasAdminDecision: boolean;
}

export interface RoundView {
  /** 0-based position in the array. */
  index: number;
  /** 1-based round number as the engine recorded it. */
  number: number;
  round: Round;
  activeBallots: number;
  exhaustedBallots: number;
  threshold: number;
  rows: RoundRow[];
  eliminated: Candidate | null;
  winner: Candidate | null;
  transfer: TransferView | null;
  tieBreak: TieBreakView | null;
}

export function buildRounds(
  snapshot: ResultSnapshotDto,
  candidates: readonly Candidate[],
): RoundView[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const placeOf = (id: string): number => byId.get(id)?.place ?? Number.MAX_SAFE_INTEGER;

  return snapshot.rounds.map((round, index) => {
    const active = round.activeBallots;

    const rows: RoundRow[] = candidates
      .filter((c) => Object.prototype.hasOwnProperty.call(round.tallies, c.id))
      .map((candidate) => {
        const votes = round.tallies[candidate.id] ?? 0;
        return {
          candidate,
          votes,
          share: active > 0 ? votes / active : 0,
          isEliminatedHere: round.eliminated === candidate.id,
          isWinnerHere: round.winner === candidate.id,
          holdsMajority: active > 0 && votes >= majorityThreshold(active),
        };
      });

    let transfer: TransferView | null = null;
    const t = round.transfer;
    if (t) {
      const from = byId.get(t.from);
      if (from) {
        const moves: TransferMove[] = Object.entries(t.to)
          .filter(([, count]) => count > 0)
          .map(([id, count]) => ({ to: byId.get(id) ?? null, count }))
          .filter((m): m is TransferMove => m.to !== null)
          .sort((a, b) => placeOf(a.to.id) - placeOf(b.to.id));
        const moved = moves.reduce((sum, m) => sum + m.count, 0);
        transfer = { from, moves, exhausted: t.exhausted, total: moved + t.exhausted };
      }
    }

    let tieBreak: TieBreakView | null = null;
    const tb = round.tieBreak;
    if (tb) {
      tieBreak = {
        tieBreak: tb,
        reason: tb.reason,
        label: TIE_BREAK_LABELS[tb.reason],
        tied: tb.tiedCandidates
          .map((id) => byId.get(id))
          .filter((c): c is Candidate => c !== undefined)
          .sort((a, b) => a.place - b.place),
        eliminated: byId.get(tb.eliminated) ?? null,
        wasAdminDecision: tb.reason === 'admin_override',
      };
    }

    return {
      index,
      number: round.round,
      round,
      activeBallots: active,
      exhaustedBallots: round.exhaustedBallots,
      threshold: majorityThreshold(active),
      rows,
      eliminated: round.eliminated ? (byId.get(round.eliminated) ?? null) : null,
      winner: round.winner ? (byId.get(round.winner) ?? null) : null,
      transfer,
      tieBreak,
    };
  });
}

// ---------------------------------------------------------------------------
// The whole derived model
// ---------------------------------------------------------------------------

export interface ResultsModel {
  candidates: Candidate[];
  rounds: RoundView[];
  winner: Candidate | null;
  /** Every round that needed a tie-break, surfaced so the page cannot bury them. */
  tieBreaks: { round: RoundView; tieBreak: TieBreakView }[];
  totalBallots: number;
  exhaustedFinal: number;
  /** Ballots still counting in the last round. */
  finalActiveBallots: number;
  finalThreshold: number;
  winnerFinalVotes: number;
  /** The winner's share of *continuing* ballots, 0..1. */
  winnerShareOfContinuing: number;
  /** The winner's share of every ballot cast, 0..1. Usually the smaller number. */
  winnerShareOfCast: number;
  exhaustedShare: number;
  tieBreakSeed: string;
  computedAt: string;
  isProjection: boolean;
}

export function buildResultsModel(results: ResultsDto): ResultsModel {
  const { snapshot } = results;
  const candidates = buildCandidates(results);
  const rounds = buildRounds(snapshot, candidates);
  const winner = candidates.find((c) => c.isWinner) ?? null;

  const finalRound = rounds.length > 0 ? rounds[rounds.length - 1] : undefined;
  const finalActive = finalRound?.activeBallots ?? 0;
  const winnerFinalVotes = winner ? (finalRound?.round.tallies[winner.id] ?? winner.finalVotes) : 0;
  const total = snapshot.totalBallots;

  return {
    candidates,
    rounds,
    winner,
    tieBreaks: rounds
      .filter((r): r is RoundView & { tieBreak: TieBreakView } => r.tieBreak !== null)
      .map((r) => ({ round: r, tieBreak: r.tieBreak })),
    totalBallots: total,
    exhaustedFinal: snapshot.exhaustedFinal,
    finalActiveBallots: finalActive,
    finalThreshold: majorityThreshold(finalActive),
    winnerFinalVotes,
    winnerShareOfContinuing: finalActive > 0 ? winnerFinalVotes / finalActive : 0,
    winnerShareOfCast: total > 0 ? winnerFinalVotes / total : 0,
    exhaustedShare: total > 0 ? snapshot.exhaustedFinal / total : 0,
    tieBreakSeed: snapshot.tieBreakSeed,
    computedAt: snapshot.computedAt,
    isProjection: snapshot.isProjection,
  };
}

// ---------------------------------------------------------------------------
// Flow geometry
// ---------------------------------------------------------------------------

/**
 * Hand-rolled Sankey geometry. There is no charting library in this repo and
 * there is not going to be one — a dependency that ships its own colour scale,
 * its own fonts and its own tooltip would undo the entire design system for one
 * screen.
 *
 * Coordinates are SVG user units. The chart is drawn once at its natural size
 * and scaled with `width: 100%`, so the numbers below are "design pixels".
 */
export interface FlowOptions {
  columnWidth: number;
  /** Horizontal space between columns — this is where the ribbons live. */
  gap: number;
  bandGap: number;
  /** Floor height so a zero-vote entry is still a visible, hoverable target. */
  minBand: number;
  padX: number;
  padTop: number;
  padBottom: number;
  /** Target height of the vote area; the real height is derived from content. */
  targetPlotHeight: number;
  minUnit: number;
  maxUnit: number;
}

export const DEFAULT_FLOW_OPTIONS: FlowOptions = {
  columnWidth: 132,
  gap: 104,
  bandGap: 6,
  minBand: 5,
  padX: 8,
  padTop: 52,
  padBottom: 64,
  targetPlotHeight: 380,
  minUnit: 5,
  maxUnit: 26,
};

export interface FlowBand {
  key: string;
  candidateId: string;
  roundIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  votes: number;
  /** True height in vote units, before the `minBand` floor was applied. */
  voteHeight: number;
  isWinner: boolean;
  eliminatedHere: boolean;
  holdsMajority: boolean;
  label: string;
}

export interface FlowExhaustLane {
  key: string;
  roundIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

export type RibbonKind = 'carry' | 'transfer' | 'exhausted';

export interface FlowRibbon {
  key: string;
  kind: RibbonKind;
  /** Filled Sankey ribbon, not a stroked line — see `ribbonPath`. */
  d: string;
  count: number;
  fromRoundIndex: number;
  /** True when this ribbon feeds the eventual winner; the one accented path. */
  toWinner: boolean;
  /** Plain-language description, used for the `<title>` on hover. */
  description: string;
}

export interface FlowColumn {
  roundIndex: number;
  number: number;
  x: number;
  width: number;
  centerX: number;
  bands: FlowBand[];
  exhaust: FlowExhaustLane | null;
  /** y of the majority line: a band reaching it from the top holds a majority. */
  thresholdY: number;
  threshold: number;
  activeBallots: number;
  exhaustedBallots: number;
  eliminatedAlias: string | null;
}

export interface FlowGeometry {
  width: number;
  height: number;
  plotTop: number;
  plotBottom: number;
  unit: number;
  columns: FlowColumn[];
  ribbons: FlowRibbon[];
}

const clampNum = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/**
 * A filled Sankey ribbon between two vertical spans, drawn with symmetric cubic
 * control points so it leaves and arrives horizontally.
 */
export function ribbonPath(
  x1: number,
  top1: number,
  bottom1: number,
  x2: number,
  top2: number,
  bottom2: number,
): string {
  const cx1 = x1 + (x2 - x1) * 0.5;
  const cx2 = x2 - (x2 - x1) * 0.5;
  return [
    `M ${x1} ${top1}`,
    `C ${cx1} ${top1}, ${cx2} ${top2}, ${x2} ${top2}`,
    `L ${x2} ${bottom2}`,
    `C ${cx2} ${bottom2}, ${cx1} ${bottom1}, ${x1} ${bottom1}`,
    'Z',
  ].join(' ');
}

export function buildFlowGeometry(
  model: ResultsModel,
  options: Partial<FlowOptions> = {},
): FlowGeometry {
  const o: FlowOptions = { ...DEFAULT_FLOW_OPTIONS, ...options };
  const { rounds, totalBallots } = model;
  const winnerId = model.winner?.id ?? null;

  const denom = Math.max(1, totalBallots);
  const unit = clampNum(o.targetPlotHeight / denom, o.minUnit, o.maxUnit);

  // Height is derived from the tallest column rather than fixed, so a 25-entry
  // first round gets the room it needs instead of collapsing into slivers.
  let plotHeight = o.targetPlotHeight;
  for (const r of rounds) {
    const bandsHeight = r.rows.reduce(
      (sum, row) => sum + Math.max(o.minBand, row.votes * unit) + o.bandGap,
      0,
    );
    const needed = bandsHeight + r.exhaustedBallots * unit + o.bandGap * 2;
    if (needed > plotHeight) plotHeight = needed;
  }

  const plotTop = o.padTop;
  const plotBottom = plotTop + plotHeight;
  const height = plotBottom + o.padBottom;
  const n = Math.max(1, rounds.length);
  const width = o.padX * 2 + n * o.columnWidth + (n - 1) * o.gap;

  const columns: FlowColumn[] = rounds.map((r, i) => {
    const x = o.padX + i * (o.columnWidth + o.gap);

    let y = plotTop;
    const bands: FlowBand[] = r.rows.map((row) => {
      const voteHeight = row.votes * unit;
      const bandHeight = Math.max(o.minBand, voteHeight);
      const band: FlowBand = {
        key: `b-${i}-${row.candidate.id}`,
        candidateId: row.candidate.id,
        roundIndex: i,
        x,
        y,
        width: o.columnWidth,
        height: bandHeight,
        votes: row.votes,
        voteHeight,
        isWinner: row.candidate.isWinner,
        eliminatedHere: row.isEliminatedHere,
        holdsMajority: row.holdsMajority,
        label: row.candidate.alias,
      };
      y += bandHeight + o.bandGap;
      return band;
    });

    const exhaustHeight = r.exhaustedBallots * unit;
    // Anchored to the bottom of the plot, so exhaustion reads as a floor that
    // rises round by round. Nudged down if tall columns would otherwise collide.
    const exhaust: FlowExhaustLane | null =
      r.exhaustedBallots > 0
        ? {
            key: `x-${i}`,
            roundIndex: i,
            x,
            y: Math.max(plotBottom - exhaustHeight, y + o.bandGap),
            width: o.columnWidth,
            height: exhaustHeight,
            count: r.exhaustedBallots,
          }
        : null;

    return {
      roundIndex: i,
      number: r.number,
      x,
      width: o.columnWidth,
      centerX: x + o.columnWidth / 2,
      bands,
      exhaust,
      thresholdY: plotTop + r.threshold * unit,
      threshold: r.threshold,
      activeBallots: r.activeBallots,
      exhaustedBallots: r.exhaustedBallots,
      eliminatedAlias: r.eliminated?.alias ?? null,
    };
  });

  const bandLookup = new Map<string, FlowBand>();
  for (const col of columns) for (const b of col.bands) bandLookup.set(`${b.roundIndex}:${b.candidateId}`, b);

  const ribbons: FlowRibbon[] = [];
  linkColumns(columns, rounds, unit, winnerId, bandLookup, ribbons, o);

  return { width, height, plotTop, plotBottom, unit, columns, ribbons };
}

/**
 * Ribbons between consecutive columns.
 *
 * Only two things travel between rounds and both are drawn:
 *   • CARRY — the votes a surviving entry already held. Faint; it is context.
 *   • TRANSFER — the eliminated entry's ballots moving to each voter's next
 *     surviving preference, plus a separate strand for the ones that ran out of
 *     preferences entirely and stopped counting.
 *
 * Incoming transfers land at the BOTTOM of the receiving band and carried votes
 * sit on top, so the growth of a band is visibly the ballots it just gained.
 */
function linkColumns(
  columns: readonly FlowColumn[],
  rounds: readonly RoundView[],
  unit: number,
  winnerId: string | null,
  bandLookup: ReadonlyMap<string, FlowBand>,
  out: FlowRibbon[],
  o: FlowOptions,
): void {
  for (let i = 0; i < columns.length - 1; i += 1) {
    const colA = columns[i];
    const colB = columns[i + 1];
    const roundA = rounds[i];
    if (!colA || !colB || !roundA) continue;

    const x1 = colA.x + o.columnWidth;
    const x2 = colB.x;
    const transfer = roundA.transfer;
    const movedTo = new Map<string, number>();
    if (transfer) for (const m of transfer.moves) movedTo.set(m.to.id, m.count);

    // --- carried votes -----------------------------------------------------
    for (const bandA of colA.bands) {
      const bandB = bandLookup.get(`${i + 1}:${bandA.candidateId}`);
      if (!bandB) continue; // eliminated here; its ballots move instead
      const retained = bandA.votes * unit;
      if (retained <= 0) continue;
      out.push({
        key: `carry-${i}-${bandA.candidateId}`,
        kind: 'carry',
        d: ribbonPath(x1, bandA.y, bandA.y + retained, x2, bandB.y, bandB.y + retained),
        count: bandA.votes,
        fromRoundIndex: i,
        toWinner: bandA.candidateId === winnerId,
        description: `${bandA.label} keeps ${bandA.votes} into round ${colB.number}`,
      });
    }

    if (colA.exhaust && colB.exhaust) {
      const carried = colA.exhaust.height;
      const incoming = (transfer?.exhausted ?? 0) * unit;
      const topB = colB.exhaust.y + incoming;
      out.push({
        key: `carry-x-${i}`,
        kind: 'carry',
        d: ribbonPath(
          x1,
          colA.exhaust.y,
          colA.exhaust.y + carried,
          x2,
          topB,
          topB + carried,
        ),
        count: colA.exhaust.count,
        fromRoundIndex: i,
        toWinner: false,
        description: `${colA.exhaust.count} already-exhausted ballots stay out of the count`,
      });
    }

    if (!transfer) continue;

    // --- the eliminated entry's ballots ------------------------------------
    const source = bandLookup.get(`${i}:${transfer.from.id}`);
    if (!source) continue;
    let cursor = source.y;

    for (const move of transfer.moves) {
      const target = bandLookup.get(`${i + 1}:${move.to.id}`);
      if (!target) continue;
      const thickness = move.count * unit;
      const top1 = cursor;
      const bottom1 = cursor + thickness;
      // Land on the bottom edge of the receiving band: the gain is the growth.
      const bottom2 = target.y + target.height;
      const top2 = Math.max(target.y, bottom2 - thickness);
      out.push({
        key: `t-${i}-${transfer.from.id}-${move.to.id}`,
        kind: 'transfer',
        d: ribbonPath(x1, top1, bottom1, x2, top2, bottom2),
        count: move.count,
        fromRoundIndex: i,
        toWinner: move.to.id === winnerId,
        description: `${move.count} ballot${move.count === 1 ? '' : 's'} moved from ${transfer.from.alias} to ${move.to.alias}`,
      });
      cursor = bottom1;
    }

    if (transfer.exhausted > 0 && colB.exhaust) {
      const thickness = transfer.exhausted * unit;
      out.push({
        key: `t-${i}-${transfer.from.id}-exhausted`,
        kind: 'exhausted',
        d: ribbonPath(
          x1,
          cursor,
          cursor + thickness,
          x2,
          colB.exhaust.y,
          colB.exhaust.y + thickness,
        ),
        count: transfer.exhausted,
        fromRoundIndex: i,
        toWinner: false,
        description: `${transfer.exhausted} ballot${transfer.exhausted === 1 ? '' : 's'} from ${transfer.from.alias} ran out of preferences and stopped counting`,
      });
    }
  }
}
