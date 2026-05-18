"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Decision {
  agent_id: string;
  tier: string;
  reason: string;
  turn: number;
  ts: number;
}

interface Props {
  decisions: Decision[];
}

const TIERS = [
  {
    key: "gemma-local",
    label: "Gemma 2-2B",
    sub: "local · M3 Air (Apple Silicon)",
    cost: "$0.0001/turn",
    color: "var(--tier-local)",
    pillClass: "tier-pill-local",
  },
  {
    key: "gemini-flash",
    label: "Gemini Flash 2.5",
    sub: "cloud · Google DeepMind",
    cost: "$0.0023/turn",
    color: "var(--tier-flash)",
    pillClass: "tier-pill-flash",
  },
  {
    key: "claude-opus",
    label: "Claude Opus 4.7",
    sub: "cloud · escalation only",
    cost: "$0.0420/turn",
    color: "var(--tier-opus)",
    pillClass: "tier-pill-opus",
  },
];

type Particle = { id: string; tier: string; bornAt: number };

export function PAVOFlow({ decisions }: Props) {
  // Track which decisions we've already converted to particles; only spawn for new ones.
  const seenRef = useRef<Set<string>>(new Set());
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const fresh: Particle[] = [];
    for (const d of decisions) {
      const id = `${d.agent_id}-${d.turn}-${d.ts}`;
      if (seenRef.current.has(id)) continue;
      seenRef.current.add(id);
      fresh.push({ id, tier: d.tier, bornAt: Date.now() });
    }
    if (fresh.length === 0) return;
    setParticles((prev) => [...prev.slice(-40), ...fresh]);
    // Auto-expire after animation duration so DOM stays small.
    const expire = window.setTimeout(() => {
      setParticles((prev) => prev.filter((p) => Date.now() - p.bornAt < 3000));
    }, 3000);
    return () => window.clearTimeout(expire);
  }, [decisions]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of decisions) c[d.tier] = (c[d.tier] ?? 0) + 1;
    return c;
  }, [decisions]);

  const total = decisions.length;
  const localCount = counts["gemma-local"] ?? 0;
  const localShare = total ? Math.round((localCount / total) * 100) : 0;

  const recentReasons = decisions.slice(0, 6);

  return (
    <section className="panel-elev p-5 relative overflow-hidden">
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
            PAVO Routing
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] live-dot" />
            <span className="text-[10px] tracking-[0.16em] text-[var(--red)] uppercase font-semibold">
              Live
            </span>
          </span>
          <span className="text-[11px] text-[var(--ink-500)]">
            Pipeline-Aware Voice Orchestration · TMLR 2026
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Metric label="Decisions" value={String(total)} accent="mint" />
          <Metric label="Local share" value={`${localShare}%`} accent="mint" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        {TIERS.map((t) => {
          const tierParticles = particles.filter((p) => p.tier === t.key);
          const tierCount = counts[t.key] ?? 0;
          return (
            <div key={t.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-[var(--ink-100)]">
                    {t.label}
                  </span>
                  <span className="text-[10px] text-[var(--ink-500)]">{t.sub}</span>
                </div>
                <span
                  className="font-mono-tight text-[22px] font-bold"
                  style={{ color: t.color }}
                >
                  {tierCount}
                </span>
              </div>
              <div className="pavo-lane">
                {tierParticles.map((p) => (
                  <span
                    key={p.id}
                    className="pavo-particle"
                    style={{
                      background: t.color,
                      boxShadow: `0 0 12px 2px ${t.color}`,
                      animationDuration: t.key === "gemma-local" ? "1.6s" : t.key === "gemini-flash" ? "2.2s" : "3.0s",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tight text-[var(--ink-500)] whitespace-nowrap">
                <span className="truncate">{t.cost}</span>
                <span className="shrink-0">
                  {tierCount === 0 ? "idle" : tierCount === 1 ? "1 turn" : `${tierCount} turns`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {recentReasons.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--border-soft)]">
          <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
            Recent routing decisions
          </span>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono-tight text-[11px]">
            {recentReasons.map((d, i) => (
              <li
                key={`${d.ts}-${i}`}
                className="rise-in flex items-center gap-2 truncate"
              >
                <span className={`px-1.5 py-0 rounded text-[9px] font-semibold tier-pill-${shortTier(d.tier)}`}>
                  {tierBadge(d.tier)}
                </span>
                <span className="text-[var(--ink-300)] shrink-0">{d.agent_id}#{d.turn}</span>
                <span className="text-[var(--ink-500)] truncate">{d.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: "mint" | "cyan" | "amber" }) {
  const color = accent === "mint" ? "var(--mint)" : accent === "cyan" ? "var(--cyan)" : "var(--amber)";
  return (
    <div className="flex flex-col items-end">
      <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">{label}</span>
      <span className="font-mono-tight text-2xl font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function shortTier(t: string): "local" | "flash" | "opus" | "mock" {
  if (t === "gemma-local") return "local";
  if (t === "gemini-flash") return "flash";
  if (t === "claude-opus" || t === "claude-haiku") return "opus";
  return "mock";
}

function tierBadge(t: string): string {
  if (t === "gemma-local") return "G-2B";
  if (t === "gemini-flash") return "Gem";
  if (t === "claude-opus") return "C-Opus";
  if (t === "claude-haiku") return "C-Hku";
  return "Mock";
}
