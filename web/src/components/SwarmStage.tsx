"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgentCell } from "@/components/AgentCell";
import { ALL_AGENTS } from "@/lib/types";

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
  eventId: string | null;
}

/**
 * Swarm-from-singularity stage.
 *
 * - Pre-call: only the glowing singularity is on screen, with the public phone
 *   number and a tap-to-call button.
 * - On first event: 16 agent cells burst out from the core in two concentric rings:
 *     - Inner ring (radius ~200px): 7 LIVE cells (buyer + 6 specialists currently on stage).
 *     - Outer ring (radius ~360px): 9 BACKLOG cells (the rest of the relocation fleet —
 *       DMV, voter, bank, school, PCP, vet, gym, pharmacy, subscriptions).
 * - During the call: every routing decision spawns a tier-colored particle that flies
 *   from the originating cell back to the core.
 */
export function SwarmStage({ agentStates, transcripts, routingDecisions, eventId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

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

  // Inner ring: smaller cells, more transcript real estate (LIVE specialists).
  const innerCardW = 208;
  const innerCardH = 130;
  // Outer ring: compact "chip" cards for backlog agents (just name + state).
  const outerCardW = 156;
  const outerCardH = 78;

  const cx = stageSize.w / 2;
  const cy = stageSize.h / 2;

  const liveAgents = useMemo(() => {
    const buyer = ALL_AGENTS.find((a) => a.id === "buyer");
    const liveSpec = ALL_AGENTS.filter((a) => a.live && a.id !== "buyer");
    return buyer ? [buyer, ...liveSpec] : [...liveSpec];
  }, []);
  const backlogAgents = useMemo(() => ALL_AGENTS.filter((a) => !a.live), []);

  // Compute ring radii based on stage size, with sensible floors.
  // Inner ring (7 cells of width 208): chord 2r*sin(π/7) > 208 ⇒ r > 240. Floor 240.
  // Outer ring (9 cells of width 156): chord 2r*sin(π/9) > 156 ⇒ r > 228. We push the
  // outer to ~floor(maxAllowed) to give visual separation.
  const innerR = 220;
  const outerR = Math.max(
    370,
    Math.min((stageSize.w - outerCardW - 24) / 2, (stageSize.h - outerCardH - 24) / 2),
  );

  const innerPositions = useMemo(() => {
    return liveAgents.map((_, i) => {
      const n = liveAgents.length;
      const angle = (-90 + (i * 360) / n) * (Math.PI / 180);
      return {
        x: cx + Math.cos(angle) * innerR - innerCardW / 2,
        y: cy + Math.sin(angle) * innerR - innerCardH / 2,
        cellCx: cx + Math.cos(angle) * innerR,
        cellCy: cy + Math.sin(angle) * innerR,
      };
    });
  }, [liveAgents, cx, cy, innerR]);

  const outerPositions = useMemo(() => {
    const n = backlogAgents.length;
    return backlogAgents.map((_, i) => {
      // Offset outer ring by half-step so cells stagger between inner-ring cells visually.
      const angle = (-90 + (i + 0.5) * (360 / n)) * (Math.PI / 180);
      return {
        x: cx + Math.cos(angle) * outerR - outerCardW / 2,
        y: cy + Math.sin(angle) * outerR - outerCardH / 2,
        cellCx: cx + Math.cos(angle) * outerR,
        cellCy: cy + Math.sin(angle) * outerR,
      };
    });
  }, [backlogAgents, cx, cy, outerR]);

  const callStarted = !!eventId;

  // Mark every agent as first-seen on call start (so they spawn-burst from center).
  const firstSeenRef = useRef<Record<string, number>>({});
  Object.keys(agentStates).forEach((id) => {
    if (firstSeenRef.current[id] === undefined) {
      firstSeenRef.current[id] = Date.now();
    }
  });
  useEffect(() => {
    if (!callStarted) return;
    for (const a of ALL_AGENTS) {
      if (firstSeenRef.current[a.id] === undefined) {
        firstSeenRef.current[a.id] = Date.now();
      }
    }
  }, [callStarted]);

  // Routing-decision return particles
  type Particle = { id: string; agent_id: string; tier: string; bornAt: number };
  const [returnParticles, setReturnParticles] = useState<Particle[]>([]);
  const seenDecisionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh: Particle[] = [];
    for (const d of routingDecisions) {
      const key = `${d.agent_id}-${d.turn}-${d.ts}`;
      if (seenDecisionsRef.current.has(key)) continue;
      seenDecisionsRef.current.add(key);
      fresh.push({ id: key, agent_id: d.agent_id, tier: d.tier, bornAt: Date.now() });
    }
    if (fresh.length === 0) return;
    setReturnParticles((prev) => [...prev.slice(-30), ...fresh]);
    const t = window.setTimeout(() => {
      setReturnParticles((prev) => prev.filter((p) => Date.now() - p.bornAt < 2500));
    }, 2500);
    return () => window.clearTimeout(t);
  }, [routingDecisions]);

  // Decisions + local share
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of routingDecisions) c[d.tier] = (c[d.tier] ?? 0) + 1;
    return c;
  }, [routingDecisions]);
  const totalDecisions = routingDecisions.length;
  const localShare = totalDecisions
    ? Math.round(((counts["gemma-local"] ?? 0) / totalDecisions) * 100)
    : 0;

  const positionFor = (agentId: string) => {
    const li = liveAgents.findIndex((a) => a.id === agentId);
    if (li >= 0) return innerPositions[li];
    const bi = backlogAgents.findIndex((a) => a.id === agentId);
    if (bi >= 0) return outerPositions[bi];
    return null;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden swarm-stage">
      <div className="absolute inset-0 swarm-bg" />

      {/* Connection lines (only after call started) */}
      {callStarted && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          {liveAgents.map((agent, i) => {
            const p = innerPositions[i];
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
                strokeWidth={active ? 1.5 : 0.7}
                strokeDasharray={isBuyer ? "0" : "3 5"}
                className={active ? "swarm-line-active" : ""}
              />
            );
          })}
          {/* Outer ring: thinner, fainter lines from core */}
          {backlogAgents.map((agent, i) => {
            const p = outerPositions[i];
            if (!p) return null;
            return (
              <line
                key={agent.id}
                x1={cx}
                y1={cy}
                x2={p.cellCx}
                y2={p.cellCy}
                stroke="rgba(0,255,163,0.05)"
                strokeWidth={0.5}
                strokeDasharray="2 6"
              />
            );
          })}
        </svg>
      )}

      {/* Return particles */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 2 }}>
        {returnParticles.map((p) => {
          const pos = positionFor(p.agent_id);
          if (!pos) return null;
          const color = tierColor(p.tier);
          return (
            <circle
              key={p.id}
              r={3.5}
              fill={color}
              style={{
                offsetPath: `path("M ${pos.cellCx} ${pos.cellCy} L ${cx} ${cy}")`,
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
          left: cx - 130,
          top: cy - 130,
          width: 260,
          height: 260,
          zIndex: 3,
        }}
      >
        <div className="swarm-core-ring swarm-core-ring-outer" />
        <div className="swarm-core-ring swarm-core-ring-mid" />
        <div className="swarm-core-ring swarm-core-ring-inner" />
        <div className="swarm-core-center">
          {!callStarted ? (
            <div className="flex flex-col items-center gap-1.5 px-1 pointer-events-auto">
              <span className="text-[8px] tracking-[0.24em] uppercase text-[var(--ink-500)]">
                Relocate · live
              </span>
              <a
                href={`tel:${PHONE_E164}`}
                aria-label={`Call Relocate at ${PHONE_DISPLAY}`}
                className="font-mono-tight text-[19px] font-bold text-[var(--mint)] hover:text-white transition-colors leading-none"
              >
                {PHONE_DISPLAY}
              </a>
              <a
                href={`tel:${PHONE_E164}`}
                className="mt-2 inline-flex items-center gap-1.5 bg-[var(--mint)] text-black font-display font-semibold text-[12px] tracking-[0.05em] px-4 py-1.5 rounded-full hover:bg-white hover:shadow-[0_0_20px_4px_rgba(0,255,163,0.45)] transition-all"
              >
                <span className="text-[14px]">📞</span>
                <span>CALL NOW</span>
              </a>
              <span className="text-[9px] tracking-[0.15em] uppercase text-[var(--ink-500)] mt-2 text-center leading-tight">
                one phone call ·<br />16 agents handle your move
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] tracking-[0.24em] uppercase text-[var(--ink-500)]">
                PAVO core
              </span>
              <span className="font-display text-[44px] leading-none mt-1 text-[var(--mint)] font-mono-tight">
                {totalDecisions}
              </span>
              <span className="text-[9px] tracking-[0.18em] uppercase text-[var(--ink-500)] mt-0.5">
                decisions
              </span>
              <span className="mt-2 text-[10px] font-mono-tight">
                <span className="text-[var(--mint)]">{localShare}%</span>
                <span className="text-[var(--ink-500)] ml-1">on M3 Air</span>
              </span>
              <span className="text-[9px] font-mono-tight text-[var(--ink-500)] mt-1">
                event {eventId}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* INNER RING — LIVE agents with full transcripts */}
      {callStarted &&
        liveAgents.map((agent, i) => {
          const pos = innerPositions[i];
          if (!pos) return null;
          const hasSpawned = !!firstSeenRef.current[agent.id];
          const delay = i * 70;
          return (
            <div
              key={agent.id}
              className={`absolute swarm-cell ${agent.id === "buyer" ? "swarm-cell-buyer" : ""}`}
              style={{
                left: pos.x,
                top: pos.y,
                width: innerCardW,
                height: innerCardH,
                zIndex: 4,
                animation: hasSpawned
                  ? `swarmSpawn 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms backwards`
                  : "none",
                ["--from-x" as any]: `${cx - pos.x - innerCardW / 2}px`,
                ["--from-y" as any]: `${cy - pos.y - innerCardH / 2}px`,
              }}
            >
              <AgentCell
                agentId={agent.id}
                name={agent.name}
                category={agent.category}
                state={agentStates[agent.id]?.state}
                sinceTs={agentStates[agent.id]?.sinceTs}
                transcript={transcripts[agent.id] ?? []}
              />
            </div>
          );
        })}

      {/* OUTER RING — BACKLOG agents as compact chips */}
      {callStarted &&
        backlogAgents.map((agent, i) => {
          const pos = outerPositions[i];
          if (!pos) return null;
          const hasSpawned = !!firstSeenRef.current[agent.id];
          // Outer chips spawn LATER (after the inner ring) so the visual ripples outward.
          const delay = (liveAgents.length * 70) + i * 60;
          const state = agentStates[agent.id]?.state ?? "queued";
          return (
            <div
              key={agent.id}
              className="absolute swarm-cell"
              style={{
                left: pos.x,
                top: pos.y,
                width: outerCardW,
                height: outerCardH,
                zIndex: 4,
                animation: hasSpawned
                  ? `swarmSpawn 0.85s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms backwards`
                  : "none",
                ["--from-x" as any]: `${cx - pos.x - outerCardW / 2}px`,
                ["--from-y" as any]: `${cy - pos.y - outerCardH / 2}px`,
              }}
            >
              <BacklogChip name={agent.name} category={agent.category} state={state} />
            </div>
          );
        })}
    </div>
  );
}

/** Compact card for backlog agents — name + state only, designed to fit on the outer ring. */
function BacklogChip({
  name,
  category,
  state,
}: {
  name: string;
  category: string;
  state: string;
}) {
  const stateStyle: Record<string, { dot: string; text: string; pulse: boolean }> = {
    queued: { dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]", pulse: false },
    dispatched: { dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]", pulse: false },
    calling: { dot: "bg-[var(--amber)]", text: "text-[var(--amber)]", pulse: false },
    "in-progress": { dot: "bg-[var(--red)]", text: "text-[var(--red)]", pulse: true },
    closed: { dot: "bg-[var(--mint)]", text: "text-[var(--mint)]", pulse: false },
    error: { dot: "bg-[var(--red)]", text: "text-[var(--red)]", pulse: false },
  };
  const s = stateStyle[state] ?? stateStyle.queued;
  return (
    <div className="panel h-full px-3 py-2 flex flex-col justify-between">
      <div>
        <div className="font-display text-[12px] text-[var(--ink-100)] leading-tight truncate">
          {name}
        </div>
        <div className="text-[8px] tracking-[0.18em] uppercase text-[var(--ink-500)] mt-0.5 truncate">
          {category}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`h-1 w-1 rounded-full ${s.dot} ${s.pulse ? "live-dot" : ""}`} />
        <span className={`text-[8px] font-semibold tracking-[0.14em] uppercase ${s.text}`}>
          {state === "queued" ? "queued" : state}
        </span>
      </div>
    </div>
  );
}

function tierColor(t: string): string {
  if (t === "gemma-local") return "#00ffa3";
  if (t === "gemini-flash") return "#ffc94a";
  if (t === "claude-opus" || t === "claude-haiku") return "#ff4dc1";
  return "#6e6e7a";
}
