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
 * Pre-call: only the glowing singularity is visible — phone number + tap-to-call CTA.
 *
 * On first event: 12 agent cells burst out from the core and arrange on a single
 * circular orbit around the singularity. All 12 cells are the same size, same affordances —
 * they all do real work (subject to conditional dispatch in marketplace.pick_specialists).
 *
 * During the call: every routing decision spawns a tier-colored particle that flies
 * from the originating cell back to the core (mint=Gemma-local, amber=Gemini Flash,
 * magenta=Claude Opus).
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

  // Uniform cell geometry — all 12 cells the same size.
  const cardW = 168;
  const cardH = 96;
  const cx = stageSize.w / 2;
  const cy = stageSize.h / 2;

  // Elliptical orbit: stages are wider than they are tall, so a circle wastes
  // horizontal room. Use the full width for rx, full height for ry.
  const N = ALL_AGENTS.length; // 12
  const rx = Math.max(0, (stageSize.w - cardW - 24) / 2);
  const ry = Math.max(0, (stageSize.h - cardH - 24) / 2);

  const positions = useMemo(() => {
    return ALL_AGENTS.map((_, i) => {
      // Index 0 (buyer) at the top (-90°), then clockwise.
      const angle = (-90 + (i * 360) / N) * (Math.PI / 180);
      const ex = cx + Math.cos(angle) * rx;
      const ey = cy + Math.sin(angle) * ry;
      return {
        x: ex - cardW / 2,
        y: ey - cardH / 2,
        cellCx: ex,
        cellCy: ey,
      };
    });
  }, [cx, cy, rx, ry]);

  const callStarted = !!eventId;

  // Spawn-once tracker. On first eventId arriving, mark all agents as "spawning" at once.
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

  // Decision counter + local share
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of routingDecisions) c[d.tier] = (c[d.tier] ?? 0) + 1;
    return c;
  }, [routingDecisions]);
  const totalDecisions = routingDecisions.length;
  const localShare = totalDecisions
    ? Math.round(((counts["gemma-local"] ?? 0) / totalDecisions) * 100)
    : 0;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden swarm-stage">
      <div className="absolute inset-0 swarm-bg" />

      {/* Connection lines (only after call started) */}
      {callStarted && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 1 }}
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
      >
        {returnParticles.map((p) => {
          const idx = ALL_AGENTS.findIndex((s) => s.id === p.agent_id);
          if (idx === -1 || !positions[idx]) return null;
          const start = positions[idx];
          const color = tierColor(p.tier);
          return (
            <circle
              key={p.id}
              r={3.5}
              fill={color}
              style={{
                offsetPath: `path("M ${start.cellCx} ${start.cellCy} L ${cx} ${cy}")`,
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
                one phone call ·<br />12 agents handle your move
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

      {/* All 12 cells — uniform size, single orbit, real transcripts and states */}
      {callStarted &&
        ALL_AGENTS.map((agent, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const hasSpawned = !!firstSeenRef.current[agent.id];
          const delay = i * 55;
          return (
            <div
              key={agent.id}
              className={`absolute swarm-cell ${agent.id === "buyer" ? "swarm-cell-buyer" : ""}`}
              style={{
                left: pos.x,
                top: pos.y,
                width: cardW,
                height: cardH,
                zIndex: 4,
                animation: hasSpawned
                  ? `swarmSpawn 0.95s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms backwards`
                  : "none",
                ["--from-x" as any]: `${cx - pos.x - cardW / 2}px`,
                ["--from-y" as any]: `${cy - pos.y - cardH / 2}px`,
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
    </div>
  );
}

function tierColor(t: string): string {
  if (t === "gemma-local") return "#00ffa3";
  if (t === "gemini-flash") return "#ffc94a";
  if (t === "claude-opus" || t === "claude-haiku") return "#ff4dc1";
  return "#6e6e7a";
}
