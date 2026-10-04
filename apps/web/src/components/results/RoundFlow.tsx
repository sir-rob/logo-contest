/**
 * The round-by-round flow — one column per round, ballots visibly moving
 * between them.
 *
 * Hand-built SVG. No charting library: the repo does not have one and adding
 * one would drag in a colour scale, a font stack and a tooltip that all fight
 * the design system for the sake of a single screen.
 *
 * Reading it: every column is the full electorate, top to bottom. Each entry's
 * band is as tall as the ballots it holds, entries keep the same lane in every
 * column, and the floor that rises from the bottom is the exhausted pile.
 * Between columns, the eliminated entry's band splits into the bands that
 * received its ballots — plus a hatched strand for the ballots that ran out of
 * preferences and stopped counting.
 *
 * ACCESSIBILITY: this whole subtree is `aria-hidden`. It is a restatement of
 * `RoundTable`, which is always in the DOM and is the accessible
 * representation. One accessible source beats two that can drift apart.
 */

import { motion, useReducedMotion } from 'framer-motion';
import type { FlowGeometry, ResultsModel } from './results-model';
import { buildFlowGeometry } from './results-model';

const EASE: [number, number, number, number] = [0.2, 0, 0, 1];

/* Colour comes from tokens, never from a hard-coded hex or a stock Tailwind
 * class. The accent is spent on exactly one thing here: the eventual winner's
 * path through the count. Everything else is ink at varying weight. */
const INK = 'hsl(var(--ink))';
const ACCENT = 'hsl(var(--accent))';
const LINE_STRONG = 'hsl(var(--line-strong))';
const INK_MUTED = 'hsl(var(--ink-muted))';
const INK_SUBTLE = 'hsl(var(--ink-subtle))';

interface RoundFlowProps {
  model: ResultsModel;
  className?: string;
}

export function RoundFlow({ model, className }: RoundFlowProps): JSX.Element {
  const geometry: FlowGeometry = buildFlowGeometry(model);
  const prefersReduced = useReducedMotion() ?? false;

  const { width, height, plotTop, plotBottom, columns, ribbons } = geometry;

  /** Reduced motion gets the same final frame, just without the travel. */
  const enter = (delay: number) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.28, delay, ease: EASE },
        };

  return (
    <div className={className} aria-hidden="true">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="presentation"
        focusable="false"
        className="block h-auto w-full overflow-visible"
        style={{ fontFamily: 'var(--font-ui)', fontVariantNumeric: 'tabular-nums' }}
      >
        <defs>
          {/* Exhausted ballots are hatched, not tinted. The strand has to be
              distinguishable from a transfer without relying on colour. */}
          <pattern
            id="rcv-exhausted-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke={INK} strokeWidth="1.4" strokeOpacity="0.28" />
          </pattern>
        </defs>

        {/* ---- ribbons, behind the bands ---------------------------------- */}
        <g>
          {ribbons.map((ribbon) => {
            const isCarry = ribbon.kind === 'carry';
            const isExhausted = ribbon.kind === 'exhausted';
            const accented = ribbon.toWinner;

            const fill = isExhausted
              ? 'url(#rcv-exhausted-hatch)'
              : accented
                ? ACCENT
                : INK;
            const fillOpacity = isExhausted ? 1 : isCarry ? (accented ? 0.1 : 0.05) : accented ? 0.2 : 0.13;

            return (
              <motion.path
                key={ribbon.key}
                d={ribbon.d}
                fill={fill}
                fillOpacity={fillOpacity}
                stroke={isCarry ? 'none' : accented ? ACCENT : INK}
                strokeOpacity={isCarry ? 0 : accented ? 0.5 : 0.28}
                strokeWidth={isCarry ? 0 : 0.75}
                {...enter(0.08 + ribbon.fromRoundIndex * 0.06)}
              >
                <title>{ribbon.description}</title>
              </motion.path>
            );
          })}
        </g>

        {/* ---- columns ----------------------------------------------------- */}
        {columns.map((column) => {
          const delay = column.roundIndex * 0.06;

          return (
            <motion.g key={`col-${column.roundIndex}`} {...enter(delay)}>
              {/* header */}
              <text
                x={column.x}
                y={18}
                fill={INK}
                fontSize="11"
                fontWeight="600"
                letterSpacing="0.08em"
              >
                {`ROUND ${column.number}`}
              </text>
              <text x={column.x} y={33} fill={INK_MUTED} fontSize="11">
                {`${column.activeBallots} counting`}
              </text>
              {column.exhaustedBallots > 0 ? (
                <text x={column.x} y={46} fill={INK_SUBTLE} fontSize="10">
                  {`${column.exhaustedBallots} exhausted`}
                </text>
              ) : null}

              {/* majority line — a band reaching it from the top has a majority */}
              <line
                x1={column.x - 4}
                y1={column.thresholdY}
                x2={column.x + column.width + 4}
                y2={column.thresholdY}
                stroke={INK}
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={column.x + column.width + 4}
                y={column.thresholdY - 4}
                fill={INK_MUTED}
                fontSize="9"
                textAnchor="end"
              >
                {`majority ${column.threshold}`}
              </text>

              {/* bands */}
              {column.bands.map((band) => {
                const accented = band.isWinner;
                const roomForText = band.height >= 13;
                const dimmed = band.eliminatedHere;
                return (
                  <g key={band.key} opacity={dimmed ? 0.55 : 1}>
                    <rect
                      x={band.x}
                      y={band.y}
                      width={band.width}
                      height={band.height}
                      rx="2"
                      fill={accented ? ACCENT : INK}
                      fillOpacity={accented ? 0.14 : 0.07}
                      stroke={accented ? ACCENT : LINE_STRONG}
                      strokeOpacity={accented ? 0.7 : 1}
                      strokeWidth={accented ? 1.2 : 1}
                      strokeDasharray={dimmed ? '3 2' : undefined}
                    >
                      <title>
                        {`${band.label} — ${band.votes} ballot${band.votes === 1 ? '' : 's'} in round ${column.number}${
                          dimmed ? `, eliminated in round ${column.number}` : ''
                        }`}
                      </title>
                    </rect>
                    {roomForText ? (
                      <>
                        <text
                          x={band.x + 7}
                          y={band.y + band.height / 2 + 3.5}
                          fill={INK}
                          fontSize="10.5"
                          fontWeight={accented ? 600 : 400}
                        >
                          {band.label}
                        </text>
                        <text
                          x={band.x + band.width - 7}
                          y={band.y + band.height / 2 + 3.5}
                          fill={dimmed ? INK_MUTED : INK}
                          fontSize="10.5"
                          textAnchor="end"
                        >
                          {dimmed ? `${band.votes} · out R${column.number}` : band.votes}
                        </text>
                      </>
                    ) : null}
                  </g>
                );
              })}

              {/* exhausted lane */}
              {column.exhaust ? (
                <g>
                  <rect
                    x={column.exhaust.x}
                    y={column.exhaust.y}
                    width={column.exhaust.width}
                    height={column.exhaust.height}
                    rx="2"
                    fill="url(#rcv-exhausted-hatch)"
                    stroke={LINE_STRONG}
                    strokeWidth="1"
                  >
                    <title>
                      {`${column.exhaust.count} exhausted ballot${
                        column.exhaust.count === 1 ? '' : 's'
                      } by round ${column.number}`}
                    </title>
                  </rect>
                  {column.exhaust.height >= 13 ? (
                    <text
                      x={column.exhaust.x + 7}
                      y={column.exhaust.y + column.exhaust.height / 2 + 3.5}
                      fill={INK_MUTED}
                      fontSize="10.5"
                    >
                      {`Exhausted ${column.exhaust.count}`}
                    </text>
                  ) : null}
                </g>
              ) : null}

              {/* footer: who left, stated in words rather than by colour alone */}
              {column.eliminatedAlias ? (
                <text x={column.x} y={plotBottom + 22} fill={INK_MUTED} fontSize="10.5">
                  {`− ${column.eliminatedAlias}`}
                </text>
              ) : null}
              {column.eliminatedAlias ? (
                <text x={column.x} y={plotBottom + 35} fill={INK_SUBTLE} fontSize="9.5">
                  {`eliminated in round ${column.number}`}
                </text>
              ) : null}
            </motion.g>
          );
        })}

        {/* plot baseline — a hairline, the way every other edge in this app is */}
        <line
          x1="0"
          y1={plotBottom + 8}
          x2={width}
          y2={plotBottom + 8}
          stroke={LINE_STRONG}
          strokeWidth="1"
        />
        <line x1="0" y1={plotTop - 8} x2={width} y2={plotTop - 8} stroke={LINE_STRONG} strokeWidth="1" />
      </svg>
    </div>
  );
}
