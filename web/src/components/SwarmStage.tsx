"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AgentCell } from "@/components/AgentCell";
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

/**
 * Swarm-from-singularity stage — mission-control theater.
 *
 * Pre-call: only the router core is visible — agent count + swarm status —
 * sitting on a faint polar grid with a slow radar sweep.
 *
 * On sufficiently wide screens, console nodes orbit the core. Compact screens
 * use a readable grid and keep non-dispatched conditional agents in standby
 * rather than implying that they ran.
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
      setStageSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Uniform node geometry — adaptive sizing that never overlaps. Algorithm:
  //   1. Try single-ring layout. If that forces cardW below MIN_CARD_W, split
  //      into two concentric rings (outer + inner). Each ring sizes itself.
  //   2. The buyer (index 0) always anchors the OUTER ring at -90° (top).
  //   3. Ramanujan I perimeter approximation for ellipses.
  const N = ALL_AGENTS.length;
  const MARGIN = 24;
  const GAP = 18;
  const MAX_CARD_W = 172;
  const MIN_CARD_W = 140;            // smaller looks cramped — switch to two-ring instead
  const CARD_H = 72;                 // fixed console-node height (orbital view)
  const cx = stageSize.w / 2;
  const cy = stageSize.h / 2;

  // Geometry helper for one ring of nodes on an ellipse.
  const ringFor = (count: number, radiusScale: number) => {
    const rx0 = Math.max(0, (stageSize.w * radiusScale - MAX_CARD_W - MARGIN) / 2);
    const ry0 = Math.max(0, (stageSize.h * radiusScale - CARD_H - MARGIN) / 2);
    const peri = stageSize.w > 0
      ? Math.PI * (3 * (rx0 + ry0) - Math.sqrt((3 * rx0 + ry0) * (rx0 + 3 * ry0)))
      : count * 200;
    const widthForFit = Math.max(100, Math.floor(peri / count) - GAP);
    const cardW = Math.min(MAX_CARD_W, widthForFit);
    const rx = Math.max(0, (stageSize.w * radiusScale - cardW - MARGIN) / 2);
    const ry = Math.max(0, (stageSize.h * radiusScale - CARD_H - MARGIN) / 2);
    return { cardW, cardH: CARD_H, rx, ry, peri };
  };

  // Try single ring first; if the cardW it'd need is below MIN_CARD_W, split.
  const single = ringFor(N, 1.0);
  const useTwoRings = stageSize.w > 0 && single.cardW < MIN_CARD_W;

  // Two-ring partition: outer gets the first ceil(N/2), inner gets the rest.
  // The buyer (index 0) stays on the outer ring at the top.
  const outerCount = useTwoRings ? Math.ceil(N / 2) : N;
  const innerCount = useTwoRings ? N - outerCount : 0;
  const outer = useTwoRings ? ringFor(outerCount, 1.0) : single;
  // Inner ring sized to 60% radius — wide enough to never collide with the outer
  // ring at typical node sizes, tight enough to keep the core readable.
  const inner = useTwoRings ? ringFor(Math.max(1, innerCount), 0.60) : null;

  // Build positions for every agent. Outer indices: 0, 1, ..., outerCount-1
  // → those map to ALL_AGENTS[0..outerCount-1]. Inner indices follow.
  const positions = ALL_AGENTS.map((_, i) => {
      const onOuter = i < outerCount;
      const ring = onOuter ? outer : (inner ?? outer);
      const idxInRing = onOuter ? i : (i - outerCount);
      const countInRing = onOuter ? outerCount : (innerCount || 1);
      // Buyer (i=0) at -90°; rest clockwise.
      const angle = (-90 + (idxInRing * 360) / countInRing) * (Math.PI / 180);
      const ex = cx + Math.cos(angle) * ring.rx;
      const ey = cy + Math.sin(angle) * ring.ry;
      return {
        x: ex - ring.cardW / 2,
        y: ey - ring.cardH / 2,
        cellCx: ex,
        cellCy: ey,
        cardW: ring.cardW,
        cardH: ring.cardH,
        onOuter,
      };
    });

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

  // Below this stage width the elliptical swarm starts looking cramped no
  // matter the ring count, so we fall back to a 2-column stacked grid.
  // Anything >= COMPACT_SWARM_THRESHOLD renders the cinematic swarm.
  const COMPACT_SWARM_THRESHOLD = 1280;
  const useMobileGrid = stageSize.w === 0 || stageSize.w < COMPACT_SWARM_THRESHOLD;

  if (useMobileGrid) {
    return (
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden swarm-stage"
        aria-label="Agent swarm"
      >
        <div className="absolute inset-0 swarm-bg" />
        <div className="relative z-10 p-3">
          <div className="text-center mb-4 pt-1">
            <div className="tm-label text-[var(--ink-300)]">Relocate · agent swarm</div>
            <div className="font-display text-[34px] leading-none tabular-nums text-[var(--ink-100)] mt-1.5">
              {ALL_AGENTS.length}
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
                <div key={agent.id} className="h-[88px] min-w-0">
                  <AgentCell
                    agentId={agent.id}
                    name={agent.name}
                    category={agent.category}
                    state={agentStates[agent.id]?.state}
                    sinceTs={agentStates[agent.id]?.sinceTs}
                    transcript={transcripts[agent.id] ?? []}
                    demoMode={demoMode}
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

  // Polar-grid geometry for the radar backdrop.
  const gridBase = Math.min(stageSize.w, stageSize.h) / 2;
  const gridRings = [0.34, 0.62, 0.9, 1.24].map((f) => gridBase * f);
  const tickR = gridBase * 0.9;

  return (
    <div ref={containerRef} className="relative w-full min-h-[760px] overflow-hidden swarm-stage" aria-label="Agent swarm">
      <div className="absolute inset-0 swarm-bg" />

      {/* Polar radar grid — barely-there structure behind everything */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0 }}
        aria-hidden="true"
        focusable="false"
      >
        <line x1={0} y1={cy} x2={stageSize.w} y2={cy} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
        <line x1={cx} y1={0} x2={cx} y2={stageSize.h} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
        {gridRings.map((r, ri) => (
          <circle
            key={ri}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={`rgba(255,255,255,${ri === 2 ? 0.05 : 0.035})`}
            strokeWidth={1}
          />
        ))}
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
      </svg>

      {/* Spokes — hub-and-spoke data paths; dashes flow out of the core,
          brighter + faster while an agent is live */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1 }}
        aria-hidden="true"
        focusable="false"
      >
        {ALL_AGENTS.map((agent, i) => {
          const p = positions[i];
          if (!p) return null;
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
              x1={cx}
              y1={cy}
              x2={p.cellCx}
              y2={p.cellCy}
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
          const target = positions[idx];
          const color = tierMeta(p.tier).color;
          // Path: core (cx,cy) → node. The comet is PAVO dispatching the
          // routing decision OUT to the agent that's executing it.
          const pathStr = `path("M ${cx} ${cy} L ${target.cellCx} ${target.cellCy}")`;
          const segments = [
            { r: 5, fillOpacity: 1, delay: 0, glow: true },
            { r: 3.2, fillOpacity: 0.5, delay: 0.08, glow: false },
            { r: 2, fillOpacity: 0.25, delay: 0.16, glow: false },
          ];
          return (
            <g key={p.id}>
              {segments.map((seg, si) => (
                <circle
                  key={si}
                  r={seg.r}
                  fill={color}
                  fillOpacity={seg.fillOpacity}
                  style={{
                    offsetPath: pathStr,
                    animation: `swarmReturn 1.4s ease-out ${seg.delay}s both`,
                    filter: seg.glow ? `drop-shadow(0 0 10px ${color})` : undefined,
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
        style={{
          left: cx - 160,
          top: cy - 160,
          width: 320,
          height: 320,
          zIndex: 3,
        }}
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

      {/* All N nodes — adaptive sizing (single ring or two concentric rings) */}
      {callStarted &&
        ALL_AGENTS.map((agent, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const delay = i * 55;
          const cellStyle: CSSProperties & { "--from-x": string; "--from-y": string } = {
            left: pos.x,
            top: pos.y,
            width: pos.cardW,
            height: pos.cardH,
            zIndex: pos.onOuter ? 4 : 5,
            animation: `swarmSpawn 0.95s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms backwards`,
            "--from-x": `${cx - pos.x - pos.cardW / 2}px`,
            "--from-y": `${cy - pos.y - pos.cardH / 2}px`,
          };
          return (
            <div
              key={agent.id}
              className={`absolute swarm-cell ${agent.id === "buyer" ? "swarm-cell-buyer" : ""} ${
                pos.onOuter ? "" : "swarm-cell-inner"
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
              />
            </div>
          );
        })}
    </div>
  );
}
