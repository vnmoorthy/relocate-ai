"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentCell, type CellDensity } from "@/components/AgentCell";
import { ALL_AGENTS, type PavoTier } from "@/lib/types";
import { tierMeta } from "@/lib/tiers";
import type { DashboardConnection } from "@/lib/dashboard-state";

interface AgentState {
  state: string;
  sinceTs: number;
}

interface RoutingDecision {
  agent_id: string;
  tier: string;
  reason: string;
  turn: number;
  ts: number;
}

interface Props {
  agentStates: Record<string, AgentState>;
  transcripts: Record<
    string,
    Array<{ role: string; text: string; ts: number; turn: number; tier?: string }>
  >;
  routingDecisions: RoutingDecision[];
  totalDecisions: number;
  tierCounts: Partial<Record<PavoTier, number>>;
  eventId: string | null;
  connection: DashboardConnection;
}

/* ──────────────────────────────────────────────────────────────────────────
   Orbital layout solver

   The roster grew from 17 to 29 nodes, which the old "one ellipse, shrink the
   card until it fits" heuristic could not hold: it sized each ring on its own,
   so the two rings ended up with different card widths, and nothing ever
   checked that a card on the inner ring missed the card diagonally outside it.

   This solver is exhaustive instead of heuristic. It searches, largest card
   first, over {card width} × {card height} × {ring split} × {inner ring radii}
   and returns the first candidate whose ACTUAL laid-out boxes pass a real
   collision test — every pair of node rects separated, every rect inside the
   stage, every rect clear of the router core's keep-out disc. If nothing fits
   (stage too small or too short) it returns null and the stage falls back to
   the compact grid, so an overlapping orbital view is unrepresentable.

   Two rings, not one: 29 cards on a single ellipse would have to shrink below
   a readable callsign width. Two concentric rings also carry meaning — the
   outer ring is the buyer plus the 16 specialists that contact a counterparty,
   the inner ring is the 12 that prepare an artifact for the customer.
   ────────────────────────────────────────────────────────────────────────── */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ring {
  count: number;
  rx: number;
  ry: number;
  /** Angle of the ring's first node, in degrees (-90 = straight up). */
  rot: number;
}

interface OrbitLayout {
  cardW: number;
  cardH: number;
  density: CellDensity;
  coreSize: number;
  /** Radius of the disc around the core that no node may enter. */
  keepOut: number;
  rings: Ring[];
}

/** Breathing room from the stage edge to the outermost node. */
const MARGIN = 14;
/** Minimum clear space between two node rects. */
const GAP_X = 12;
const GAP_Y = 10;
/** Node heights: the 3-row console card, then the folded 2-row card. */
const CARD_H_COMPACT = 66;
const CARD_H_MICRO = 52;
/** Card widths tried largest-first. 128px still fits "Concierge" + "DISP". */
const CARD_WIDTHS = [176, 168, 160, 152, 144, 136, 128];
/** Below this width the 3-row card truncates callsigns — fold a row instead. */
const MIN_COMPACT_W = 144;
/** buyer + 16 counterparty-facing specialists; the rest prepare artifacts. */
const PREFERRED_OUTER = 17;
/** Under these stage dimensions the orbit is not attempted at all. */
const MIN_ORBIT_W = 1024;
const MIN_ORBIT_H = 520;

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The core's visual radius (its outermost ring) plus a hairline of margin. */
const keepOutFor = (coreSize: number) => coreSize * 0.469 + 10;

function coreSizeFor(w: number, h: number) {
  return clamp(196, Math.min(h * 0.4, w * 0.22), 300);
}

function ringBoxes(ring: Ring, cardW: number, cardH: number, cx: number, cy: number): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < ring.count; i++) {
    const a = ((ring.rot + (i * 360) / ring.count) * Math.PI) / 180;
    out.push({
      x: cx + Math.cos(a) * ring.rx,
      y: cy + Math.sin(a) * ring.ry,
      w: cardW,
      h: cardH,
    });
  }
  return out;
}

function overlaps(a: Box, b: Box, gapX = GAP_X, gapY = GAP_Y) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gapX &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gapY
  );
}

/** Distance from a point to the nearest edge of a box (0 if inside). */
function boxDistance(box: Box, px: number, py: number) {
  const dx = Math.max(0, Math.abs(box.x - px) - box.w / 2);
  const dy = Math.max(0, Math.abs(box.y - py) - box.h / 2);
  return Math.hypot(dx, dy);
}

function ringFits(
  boxes: Box[],
  w: number,
  h: number,
  keepOut: number,
  cx: number,
  cy: number,
) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.x - b.w / 2 < 4 || b.x + b.w / 2 > w - 4) return false;
    if (b.y - b.h / 2 < 4 || b.y + b.h / 2 > h - 4) return false;
    if (boxDistance(b, cx, cy) < keepOut) return false;
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(b, boxes[j])) return false;
    }
  }
  return true;
}

function ringsClear(a: Box[], b: Box[]) {
  for (const p of a) {
    for (const q of b) if (overlaps(p, q)) return false;
  }
  return true;
}

/**
 * Solve the tightest non-overlapping orbit for `count` nodes on a `w`×`h`
 * stage, or null when no configuration fits.
 */
export function solveOrbit(w: number, h: number, count: number): OrbitLayout | null {
  if (w < MIN_ORBIT_W || h < MIN_ORBIT_H || count < 2) return null;

  const cx = w / 2;
  const cy = h / 2;
  const coreSize = coreSizeFor(w, h);
  const keepOut = keepOutFor(coreSize);

  // Split candidates, nearest the roster's natural 17/12 boundary first.
  const splits: number[] = [PREFERRED_OUTER];
  for (let d = 1; d <= 6; d++) {
    splits.push(PREFERRED_OUTER + d, PREFERRED_OUTER - d);
  }

  const densities: Array<{ cardH: number; density: CellDensity; minW: number }> = [
    { cardH: CARD_H_COMPACT, density: "compact", minW: MIN_COMPACT_W },
    { cardH: CARD_H_MICRO, density: "micro", minW: 0 },
  ];

  // Density before width: the 3-row console card is the design's native form,
  // so it is only traded away once it can no longer reach a readable width.
  for (const { cardH, density, minW } of densities) {
    for (const cardW of CARD_WIDTHS) {
      if (cardW < minW) continue;
      const rx = (w - cardW) / 2 - MARGIN;
      const ry = (h - cardH) / 2 - MARGIN;
      if (rx <= 0 || ry <= 0) continue;

      // 1 — single ring, if the roster is small enough for one orbit.
      const solo: Ring = { count, rx, ry, rot: -90 };
      if (ringFits(ringBoxes(solo, cardW, cardH, cx, cy), w, h, keepOut, cx, cy)) {
        return { cardW, cardH, density, coreSize, keepOut, rings: [solo] };
      }

      // 2 — two concentric rings.
      for (const outerCount of splits) {
        if (outerCount >= count || outerCount < Math.ceil(count / 2)) continue;
        const innerCount = count - outerCount;
        const outer: Ring = { count: outerCount, rx, ry, rot: -90 };
        const outerBoxes = ringBoxes(outer, cardW, cardH, cx, cy);
        if (!ringFits(outerBoxes, w, h, keepOut, cx, cy)) continue;

        for (let fy = 0.9; fy >= 0.42; fy -= 0.02) {
          const ryIn = ry * fy;
          // Any flatter and the inner ring is inside the core: stop descending.
          if (ryIn - cardH / 2 < keepOut) break;
          for (let fx = 0.9; fx >= 0.4; fx -= 0.04) {
            const rxIn = rx * fx;
            if (rxIn - cardW / 2 < keepOut) break;
            const inner: Ring = {
              count: innerCount,
              rx: rxIn,
              ry: ryIn,
              // Half-step offset: interleaves the rings and leaves the four
              // cardinal headings clear for the HUD marks.
              rot: -90 + 180 / innerCount,
            };
            const innerBoxes = ringBoxes(inner, cardW, cardH, cx, cy);
            if (!ringFits(innerBoxes, w, h, keepOut, cx, cy)) continue;
            if (!ringsClear(outerBoxes, innerBoxes)) continue;
            return { cardW, cardH, density, coreSize, keepOut, rings: [outer, inner] };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Swarm-from-singularity stage — mission-control theater.
 *
 * Pre-call: only the router core is visible — agent count + swarm status —
 * sitting on a faint polar grid with a slow radar sweep.
 *
 * On sufficiently wide screens, console nodes orbit the core on two rings:
 * the outer ring is the concierge plus every specialist that contacts a
 * counterparty, the inner ring is the specialists that prepare an artifact.
 * Compact screens use a readable grid and keep non-dispatched conditional
 * agents in standby rather than implying that they ran.
 *
 * The stage height is capped to one viewport minus the fixed nav, so the whole
 * swarm can be read without scrolling any node under the site header.
 *
 * During the call: every routing decision fires a tier-colored comet from the
 * core out along the spoke to the executing node (mint=Gemma-local,
 * amber=Gemini Flash, magenta=Claude Opus).
 */
export function SwarmStage({
  agentStates,
  transcripts,
  routingDecisions,
  totalDecisions,
  tierCounts,
  eventId,
  connection,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const demoMode = connection === "demo";

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setStageSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const N = ALL_AGENTS.length;
  const cx = stageSize.w / 2;
  const cy = stageSize.h / 2;

  // Quantise the solve input so a drag-resize re-solves a handful of times
  // rather than once per animation frame.
  const solveW = Math.round(stageSize.w / 8) * 8;
  const solveH = Math.round(stageSize.h / 8) * 8;
  const layout = useMemo(() => solveOrbit(solveW, solveH, N), [solveW, solveH, N]);

  // Node geometry, derived from the solved rings.
  const positions = useMemo(() => {
    if (!layout) return [];
    const out: Array<{
      x: number;
      y: number;
      cellCx: number;
      cellCy: number;
      cardW: number;
      cardH: number;
      ring: number;
    }> = [];
    let index = 0;
    layout.rings.forEach((ring, ringIndex) => {
      for (let i = 0; i < ring.count && index < N; i++, index++) {
        const a = ((ring.rot + (i * 360) / ring.count) * Math.PI) / 180;
        const ex = cx + Math.cos(a) * ring.rx;
        const ey = cy + Math.sin(a) * ring.ry;
        out.push({
          x: ex - layout.cardW / 2,
          y: ey - layout.cardH / 2,
          cellCx: ex,
          cellCy: ey,
          cardW: layout.cardW,
          cardH: layout.cardH,
          ring: ringIndex,
        });
      }
    });
    return out;
  }, [layout, cx, cy, N]);

  const callStarted = !!eventId;

  const returnParticles = routingDecisions.slice(0, 16).map((decision) => ({
    id: `${decision.agent_id}-${decision.turn}-${decision.ts}`,
    agent_id: decision.agent_id,
    tier: decision.tier,
  }));
  const localShare = totalDecisions
    ? Math.round(((tierCounts["gemma-local"] ?? 0) / totalDecisions) * 100)
    : 0;

  const terminalCounts = Object.values(agentStates).reduce(
    (counts, agent) => {
      if (agent.state === "submitted") counts.submitted += 1;
      if (agent.state === "succeeded") counts.succeeded += 1;
      if (agent.state === "needs-user-action") counts.action += 1;
      if (agent.state === "failed" || agent.state === "error") counts.failed += 1;
      return counts;
    },
    { submitted: 0, succeeded: 0, action: 0, failed: 0 },
  );

  // The orbit renders only when the solver proved a collision-free layout for
  // this exact stage size; everything else gets the readable stacked grid.
  const useMobileGrid = stageSize.w === 0 || !layout;

  // HUD corner brackets — thin framing at the four corners of the panel
  // interior, shared by both the orbital stage and the compact grid.
  const hudCorners = (
    <>
      <span className="hud-corner hud-corner--tl" aria-hidden="true" />
      <span className="hud-corner hud-corner--tr" aria-hidden="true" />
      <span className="hud-corner hud-corner--bl" aria-hidden="true" />
      <span className="hud-corner hud-corner--br" aria-hidden="true" />
    </>
  );

  // Two-column phone grid: the full status word would push the callsign into
  // an ellipsis, so the narrow grid borrows the orbit's 4-char status codes.
  const gridDensity: CellDensity =
    stageSize.w > 0 && stageSize.w < 420 ? "compact" : "full";

  if (useMobileGrid) {
    return (
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden swarm-stage"
        aria-label="Agent swarm"
      >
        <div className="absolute inset-0 swarm-bg" />
        {hudCorners}
        <div className="relative z-10 p-3 swarm-scroll">
          <div className="text-center mb-4 pt-1">
            <div className="tm-label text-[var(--ink-300)]">Relocate · agent swarm</div>
            <div className="swarm-mini-core mt-2">
              <span className="swarm-mini-sweep" aria-hidden="true" />
              <span className="swarm-mini-ring" aria-hidden="true" />
              <span className="core-numeral">{ALL_AGENTS.length}</span>
            </div>
            <p className="tm-label text-[var(--ink-500)] mt-1.5">
              agents · 1 concierge + {ALL_AGENTS.length - 1} specialists
            </p>
          </div>
          {callStarted && (
            <>
              <p className="mb-3 text-center tm-label text-[var(--ink-500)]" aria-live="polite">
                {totalDecisions} decisions · {terminalCounts.submitted} submitted · {terminalCounts.succeeded} succeeded · {terminalCounts.action} need action · {terminalCounts.failed} failed
              </p>
            <div className="swarm-grid grid grid-cols-2 md:grid-cols-3 gap-2">
              {ALL_AGENTS.map((agent) => (
                <div key={agent.id} className={`h-[88px] min-w-0 ${agent.id === "buyer" ? "swarm-cell-buyer" : ""}`}>
                  <AgentCell
                    agentId={agent.id}
                    name={agent.name}
                    category={agent.category}
                    state={agentStates[agent.id]?.state}
                    sinceTs={agentStates[agent.id]?.sinceTs}
                    transcript={transcripts[agent.id] ?? []}
                    demoMode={demoMode}
                    density={gridDensity}
                  />
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Orbital view geometry ────────────────────────────────────────────────
  const outerRing = layout.rings[0];
  const innerRing = layout.rings[1] ?? null;
  // Pre-call the core is the whole composition, so it stays at full size; once
  // the swarm spawns it contracts to the radius the rings were solved against.
  const coreSize = callStarted
    ? layout.coreSize
    : Math.min(320, stageSize.h * 0.46, stageSize.w * 0.3);
  const coreKeep = keepOutFor(coreSize);
  // Compass rose — fine ticks on the annulus just outside the core.
  const tickR = coreKeep + 14;

  const nodeBoxes: Box[] = callStarted
    ? positions.map((p) => ({ x: p.cellCx, y: p.cellCy, w: p.cardW, h: p.cardH }))
    : [];

  // Cardinal HUD marks (compass convention: 000 up, clockwise). Each label is
  // pushed out from the core along its heading until it clears every node
  // rect, so the marks never land underneath a console card.
  const cardinals = [
    { label: "000", deg: -90 },
    { label: "090", deg: 0 },
    { label: "180", deg: 90 },
    { label: "270", deg: 180 },
  ].map(({ label, deg }) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const reach = Math.abs(cos) > 0.5
      ? outerRing.rx - layout.cardW / 2 - 16
      : outerRing.ry - layout.cardH / 2 - 16;
    for (let r = reach; r >= tickR + 14; r -= 6) {
      const box: Box = { x: cx + cos * r, y: cy + sin * r, w: 30, h: 16 };
      if (nodeBoxes.every((b) => !overlaps(box, b, 6, 6))) {
        return { label, cos, sin, r };
      }
    }
    return null;
  });

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden swarm-stage swarm-stage--orbit"
      aria-label="Agent swarm"
    >
      <div className="absolute inset-0 swarm-bg" />
      {hudCorners}

      {/* Polar radar grid — barely-there structure behind everything. The
          orbit paths are drawn at the solved ring radii, so the console nodes
          sit ON their track rather than floating over an unrelated grid. */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0 }}
        aria-hidden="true"
        focusable="false"
      >
        <line x1={0} y1={cy} x2={stageSize.w} y2={cy} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
        <line x1={cx} y1={0} x2={cx} y2={stageSize.h} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />

        {/* Orbit tracks */}
        {layout.rings.map((ring, i) => (
          <ellipse
            key={`orbit-${i}`}
            cx={cx}
            cy={cy}
            rx={ring.rx}
            ry={ring.ry}
            fill="none"
            stroke={`rgba(255,255,255,${i === 0 ? 0.05 : 0.04})`}
            strokeWidth={1}
          />
        ))}
        {/* One intermediate track between the core and the inner orbit */}
        <ellipse
          cx={cx}
          cy={cy}
          rx={(innerRing ?? outerRing).rx * 0.62}
          ry={(innerRing ?? outerRing).ry * 0.62}
          fill="none"
          stroke="rgba(255,255,255,0.028)"
          strokeWidth={1}
        />

        {/* Compass rose — 15° ticks around the router core */}
        {Array.from({ length: 24 }, (_, k) => {
          const major = k % 6 === 0;
          const a = (k * 15 * Math.PI) / 180;
          const r1 = tickR - (major ? 9 : 5);
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          return (
            <line
              key={`tick-${k}`}
              x1={cx + cos * r1}
              y1={cy + sin * r1}
              x2={cx + cos * tickR}
              y2={cy + sin * tickR}
              stroke={`rgba(255,255,255,${major ? 0.09 : 0.06})`}
              strokeWidth={1}
            />
          );
        })}

        {/* Cardinal HUD markings — extended tick + degree label at
            000/090/180/270, placed in the clear space between the orbits. */}
        {cardinals.map((mark) =>
          mark ? (
            <g key={`cardinal-${mark.label}`}>
              <line
                x1={cx + mark.cos * (mark.r - 20)}
                y1={cy + mark.sin * (mark.r - 20)}
                x2={cx + mark.cos * (mark.r - 9)}
                y2={cy + mark.sin * (mark.r - 9)}
                stroke="rgba(255,255,255,0.14)"
                strokeWidth={1}
              />
              <text
                x={cx + mark.cos * mark.r}
                y={cy + mark.sin * mark.r}
                textAnchor="middle"
                dominantBaseline="central"
                className="tm-label"
                style={{ fontSize: 9 }}
                fill="var(--ink-700)"
              >
                {mark.label}
              </text>
            </g>
          ) : null,
        )}
      </svg>

      {/* Spokes — hub-and-spoke data paths; dashes flow out of the core rim,
          brighter + faster while an agent is live */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1 }}
        aria-hidden="true"
        focusable="false"
      >
        {callStarted &&
          ALL_AGENTS.map((agent, i) => {
            const p = positions[i];
            if (!p) return null;
            const seg = spokeSegment(cx, cy, p, coreKeep);
            if (!seg) return null;
            const state = agentStates[agent.id]?.state;
            const active = state === "in-progress" || state === "calling";
            const isBuyer = agent.id === "buyer";
            const stroke = isBuyer
              ? active
                ? "rgba(129,140,248,0.70)"
                : "rgba(129,140,248,0.30)"
              : active
                ? "rgba(255,255,255,0.55)"
                : "rgba(255,255,255,0.16)";
            return (
              <line
                key={agent.id}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke={stroke}
                strokeWidth={1}
                strokeDasharray="2 10"
                className={`swarm-spoke ${active ? "swarm-spoke--active" : ""}`}
              />
            );
          })}
      </svg>

      {/* Routing comets (core → node, tier-colored, short fading trail) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 2 }}
        aria-hidden="true"
        focusable="false"
      >
        {returnParticles.map((p) => {
          const idx = ALL_AGENTS.findIndex((s) => s.id === p.agent_id);
          if (idx === -1 || !positions[idx]) return null;
          const seg = spokeSegment(cx, cy, positions[idx], coreKeep);
          if (!seg) return null;
          const color = tierMeta(p.tier).color;
          // Path: core rim → node edge. The comet is PAVO dispatching the
          // routing decision OUT to the agent that's executing it.
          const pathStr = `path("M ${seg.x1} ${seg.y1} L ${seg.x2} ${seg.y2}")`;
          const segments = [
            { r: 5, fillOpacity: 1, delay: 0, glow: true },
            { r: 3.2, fillOpacity: 0.5, delay: 0.08, glow: false },
            { r: 2, fillOpacity: 0.25, delay: 0.16, glow: false },
          ];
          return (
            <g key={p.id}>
              {segments.map((seg2, si) => (
                <circle
                  key={si}
                  r={seg2.r}
                  fill={color}
                  fillOpacity={seg2.fillOpacity}
                  style={{
                    offsetPath: pathStr,
                    animation: `swarmReturn 1.4s ease-out ${seg2.delay}s both`,
                    filter: seg2.glow ? `drop-shadow(0 0 10px ${color})` : undefined,
                  }}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Router core — the sun of the composition */}
      <div
        className="absolute swarm-core"
        style={
          {
            left: cx - coreSize / 2,
            top: cy - coreSize / 2,
            width: coreSize,
            height: coreSize,
            zIndex: 3,
            "--core-size": `${coreSize}px`,
          } as CSSProperties
        }
      >
        <div className="swarm-core-glow" aria-hidden="true" />
        <div className="swarm-sweep" aria-hidden="true" />
        <div className="swarm-core-ring swarm-core-ring-outer" aria-hidden="true" />
        <div className="swarm-core-ring swarm-core-ring-mid" aria-hidden="true" />
        <div className="swarm-core-ring swarm-core-ring-inner" aria-hidden="true" />
        <div className="swarm-core-disc" aria-hidden="true" />
        <div className="swarm-core-center">
          {!callStarted ? (
            <div className="flex flex-col items-center gap-1 px-1">
              <span className="tm-label text-[var(--ink-500)]">
                Relocate · swarm
              </span>
              <span className="core-numeral mt-1">
                {ALL_AGENTS.length}
              </span>
              <span className="tm-label text-[var(--ink-500)] mt-0.5">
                agents standing by
              </span>
              <span className="tm-label text-[var(--ink-700)] mt-2 text-center leading-relaxed">
                one concierge ·<br />{ALL_AGENTS.length - 1} specialists coordinate your move
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="tm-label text-[var(--ink-500)]">
                PAVO router
              </span>
              <span className="core-numeral mt-1">
                {totalDecisions}
              </span>
              <span className="tm-label text-[var(--ink-500)] mt-0.5">
                decisions
              </span>
              <span className="mt-2 tm-label">
                <span className="text-[var(--ink-100)]">{localShare}%</span>
                <span className="text-[var(--ink-500)] ml-1.5">local-route share</span>
              </span>
              <span className="core-divider" aria-hidden="true" />
              <span className="tm-label text-[var(--ink-300)]">
                {terminalCounts.submitted} submitted · {terminalCounts.succeeded} succeeded
              </span>
              <span className="tm-label text-[var(--ink-300)] mt-1">
                {terminalCounts.action} action · {terminalCounts.failed} failed
              </span>
            </div>
          )}
        </div>
      </div>

      {/* All N nodes on the solved rings — outer ring first, then inner */}
      {callStarted &&
        ALL_AGENTS.map((agent, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const delay = i * 45;
          const cellStyle: CSSProperties & { "--from-x": string; "--from-y": string } = {
            left: pos.x,
            top: pos.y,
            width: pos.cardW,
            height: pos.cardH,
            zIndex: pos.ring === 0 ? 4 : 5,
            animation: `swarmSpawn 0.95s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms backwards`,
            "--from-x": `${cx - pos.x - pos.cardW / 2}px`,
            "--from-y": `${cy - pos.y - pos.cardH / 2}px`,
          };
          return (
            <div
              key={agent.id}
              className={`absolute swarm-cell ${agent.id === "buyer" ? "swarm-cell-buyer" : ""} ${
                pos.ring === 0 ? "" : "swarm-cell-inner"
              }`}
              style={cellStyle}
            >
              <AgentCell
                agentId={agent.id}
                name={agent.name}
                category={agent.category}
                state={agentStates[agent.id]?.state}
                sinceTs={agentStates[agent.id]?.sinceTs}
                transcript={transcripts[agent.id] ?? []}
                demoMode={demoMode}
                density={layout.density}
              />
            </div>
          );
        })}
    </div>
  );
}

/**
 * Spoke geometry: from the core's rim out to the edge of the node card, so the
 * dashes never run underneath the core telemetry or across a console face.
 */
function spokeSegment(
  cx: number,
  cy: number,
  pos: { cellCx: number; cellCy: number; cardW: number; cardH: number },
  keepOut: number,
) {
  const dx = pos.cellCx - cx;
  const dy = pos.cellCy - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  // Distance from the card centre to its own boundary along the spoke.
  const tx = Math.abs(ux) > 1e-6 ? pos.cardW / 2 / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-6 ? pos.cardH / 2 / Math.abs(uy) : Infinity;
  const inset = Math.min(tx, ty);
  const end = Math.max(keepOut, len - inset);
  return {
    x1: cx + ux * keepOut,
    y1: cy + uy * keepOut,
    x2: cx + ux * end,
    y2: cy + uy * end,
  };
}
