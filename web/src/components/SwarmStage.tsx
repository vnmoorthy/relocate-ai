"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AgentCell } from "@/components/AgentCell";
import { ALL_AGENTS, type PavoTier } from "@/lib/types";
import { tierMeta } from "@/lib/tiers";
import type { DashboardConnection } from "@/lib/dashboard-state";

const PHONE_E164 = "+16184149537";
const PHONE_DISPLAY = "+1 (618) 414-9537";

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
 * Swarm-from-singularity stage.
 *
 * Pre-call: only the glowing singularity is visible — phone number + tap-to-call CTA.
 *
 * On sufficiently wide screens, agent cells orbit the singularity. Compact
 * screens use a readable grid and keep non-dispatched conditional agents in
 * standby rather than implying that they ran.
 *
 * During the call: every routing decision spawns a tier-colored particle that flies
 * from the originating cell back to the core (mint=Gemma-local, amber=Gemini Flash,
 * magenta=Claude Opus).
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
  const liveConnected = connection === "live";
  const stageModeLabel = connection === "demo"
    ? "demo replay"
    : connection === "live"
      ? "live dashboard"
      : connection === "reconnecting"
        ? "dashboard reconnecting"
        : connection === "offline"
          ? "dashboard offline"
          : "awaiting live service";

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

  // Uniform cell geometry — adaptive sizing that never overlaps. Algorithm:
  //   1. Try single-ring layout. If that forces cardW below MIN_CARD_W, split
  //      into two concentric rings (outer + inner). Each ring sizes itself.
  //   2. The buyer (index 0) always anchors the OUTER ring at -90° (top).
  //   3. Ramanujan I perimeter approximation for ellipses.
  const N = ALL_AGENTS.length;
  const MARGIN = 24;
  const GAP = 18;
  const MAX_CARD_W = 168;
  const MIN_CARD_W = 140;            // smaller looks cramped — switch to two-ring instead
  const ASPECT = 96 / 168;           // preserve card aspect ratio
  const cx = stageSize.w / 2;
  const cy = stageSize.h / 2;

  // Geometry helper for one ring of cells on an ellipse.
  const ringFor = (count: number, radiusScale: number) => {
    const rx0 = Math.max(0, (stageSize.w * radiusScale - MAX_CARD_W - MARGIN) / 2);
    const ry0 = Math.max(0, (stageSize.h * radiusScale - MAX_CARD_W * ASPECT - MARGIN) / 2);
    const peri = stageSize.w > 0
      ? Math.PI * (3 * (rx0 + ry0) - Math.sqrt((3 * rx0 + ry0) * (rx0 + 3 * ry0)))
      : count * 200;
    const widthForFit = Math.max(100, Math.floor(peri / count) - GAP);
    const cardW = Math.min(MAX_CARD_W, widthForFit);
    const cardH = Math.round(cardW * ASPECT);
    const rx = Math.max(0, (stageSize.w * radiusScale - cardW - MARGIN) / 2);
    const ry = Math.max(0, (stageSize.h * radiusScale - cardH - MARGIN) / 2);
    return { cardW, cardH, rx, ry, peri };
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
  // ring at typical card sizes, tight enough to keep the singularity readable.
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
        aria-label={`${stageModeLabel} agent swarm`}
      >
        <div className="absolute inset-0 swarm-bg" />
        <div className="relative z-10 p-3">
          <div className="text-center mb-4">
            <div className={`text-[9px] tracking-[0.24em] uppercase ${demoMode ? "text-[var(--amber)]" : "text-[var(--mint)]"}`}>
              Relocate · {stageModeLabel}
            </div>
            <a
              href={`tel:${PHONE_E164}`}
              className="font-mono-tight text-[22px] font-bold text-[var(--mint)] block mt-1"
            >
              {PHONE_DISPLAY}
            </a>
            <a
              href={`tel:${PHONE_E164}`}
              className="mt-2 inline-flex items-center gap-1.5 bg-[var(--mint)] text-black font-display font-semibold text-[12px] tracking-[0.05em] px-4 py-1.5 rounded-full"
            >
              <span aria-hidden="true">📞</span>
              <span>CALL NOW</span>
            </a>
          </div>
          {callStarted && (
            <>
              <p className="mb-3 text-center text-[10px] font-mono-tight text-[var(--ink-500)]" aria-live="polite">
                {totalDecisions} decisions · {terminalCounts.submitted} {demoMode ? "simulated submissions" : "submitted"} · {terminalCounts.succeeded} succeeded · {terminalCounts.action} need action · {terminalCounts.failed} failed
              </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {ALL_AGENTS.map((agent) => (
                <div key={agent.id} className="h-[126px] min-w-0">
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

  return (
    <div ref={containerRef} className="relative w-full min-h-[760px] overflow-hidden swarm-stage" aria-label={`${stageModeLabel} agent swarm`}>
      <div className="absolute inset-0 swarm-bg" />

      {/* Connection lines (only after call started) */}
      {callStarted && (
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
                ? "rgba(92,244,255,0.55)"
                : "rgba(92,244,255,0.20)"
              : active
                ? "rgba(0,255,163,0.40)"
                : "rgba(0,255,163,0.10)";
            return (
              <line
                key={agent.id}
                x1={cx}
                y1={cy}
                x2={p.cellCx}
                y2={p.cellCy}
                stroke={stroke}
                strokeWidth={active ? 1.5 : 0.6}
                strokeDasharray={isBuyer ? "0" : "3 5"}
                className={active ? "swarm-line-active" : ""}
              />
            );
          })}
        </svg>
      )}

      {/* Return-flow particles (cell → core, tier-colored) */}
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
          // Path: core (cx,cy) → cell. Particle is PAVO dispatching the
          // routing decision OUT to the agent that's executing it.
          return (
            <circle
              key={p.id}
              r={3.5}
              fill={color}
              style={{
                offsetPath: `path("M ${cx} ${cy} L ${target.cellCx} ${target.cellCy}")`,
                animation: `swarmReturn 1.4s ease-out forwards`,
                filter: `drop-shadow(0 0 8px ${color})`,
              }}
            />
          );
        })}
      </svg>

      {/* Singularity core */}
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
        <div className="swarm-core-ring swarm-core-ring-outer" aria-hidden="true" />
        <div className="swarm-core-ring swarm-core-ring-mid" aria-hidden="true" />
        <div className="swarm-core-ring swarm-core-ring-inner" aria-hidden="true" />
        <div className="swarm-core-center">
          {!callStarted ? (
            <div className="flex flex-col items-center gap-1.5 px-1 pointer-events-auto">
              <span className="text-[8px] tracking-[0.24em] uppercase text-[var(--ink-500)]">
                Relocate · {stageModeLabel}
              </span>
              <a
                href={`tel:${PHONE_E164}`}
                aria-label={`Call Relocate at ${PHONE_DISPLAY}`}
                className="font-mono-tight text-[20px] font-bold text-[var(--mint)] hover:text-white transition-colors leading-none whitespace-nowrap"
              >
                {PHONE_DISPLAY}
              </a>
              <a
                href={`tel:${PHONE_E164}`}
                aria-label={`Call Relocate now at ${PHONE_DISPLAY}`}
                className="mt-2 inline-flex items-center gap-1.5 bg-[var(--mint)] text-black font-display font-semibold text-[12px] tracking-[0.05em] px-4 py-1.5 rounded-full hover:bg-white hover:shadow-[0_0_20px_4px_rgba(0,255,163,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] transition-all"
              >
                <span aria-hidden="true" className="text-[14px]">📞</span>
                <span>CALL NOW</span>
              </a>
              <span className="text-[9px] tracking-[0.15em] uppercase text-[var(--ink-500)] mt-2 text-center leading-tight">
                one phone call ·<br />{ALL_AGENTS.length - 1} agents handle your move
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] tracking-[0.24em] uppercase text-[var(--ink-500)]">
                {demoMode ? "Demo router" : liveConnected ? "PAVO event feed" : "Dashboard"}
              </span>
              <span className="font-display text-[44px] leading-none mt-1 text-[var(--mint)] font-mono-tight">
                {totalDecisions}
              </span>
              <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-500)] mt-0.5">
                decisions
              </span>
              <span className="mt-2 text-[10px] font-mono-tight">
                <span className="text-[var(--mint)]">{localShare}%</span>
                <span className="text-[var(--ink-500)] ml-1">local-route share</span>
              </span>
              <span className="text-[9px] font-mono-tight text-[var(--ink-500)] mt-1">
                {terminalCounts.submitted} {demoMode ? "simulated" : "submitted"} · {terminalCounts.succeeded} succeeded
              </span>
              <span className="text-[8px] font-mono-tight text-[var(--ink-500)] mt-1">
                {terminalCounts.action} action · {terminalCounts.failed} failed
              </span>
              <span className="text-[8px] font-mono-tight text-[var(--ink-500)] mt-1">
                {demoMode ? "synthetic session" : "event identifier hidden"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* All N cells — adaptive sizing (single ring or two concentric rings) */}
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
