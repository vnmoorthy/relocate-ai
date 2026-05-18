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
    sub: "local · M3 Air",
    cost: "$0.0001",
    color: "var(--tier-local)",
  },
  {
    key: "gemini-flash",
    label: "Gemini Flash 2.5",
    sub: "cloud · Google",
    cost: "$0.0023",
    color: "var(--tier-flash)",
  },
  {
    key: "claude-opus",
    label: "Claude Opus 4.7",
    sub: "cloud · escalation",
    cost: "$0.0420",
    color: "var(--tier-opus)",
  },
];

type Particle = { id: string; tier: string; bornAt: number };

export function PAVOFlow({ decisions }: Props) {
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

  const recentReasons = decisions.slice(0, 4);

  return (
    <section className="panel-elev p-4 relative overflow-hidden">
      {/* Header — clean two-line layout, compact for narrow side column */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] tracking-[0.18em] text-[var(--ink-500)] uppercase shrink-0">
            PAVO routing
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)] live-dot" />
            <span className="text-[9px] tracking-[0.16em] text-[var(--red)] uppercase font-semibold">
              Live
            </span>
          </span>
        </div>
        <div className="flex items-baseline gap-3 shrink-0">
          <CountPill label="DEC" value={total} />
          <CountPill label="LOCAL" value={`${localShare}%`} />
        </div>
      </div>
      <p className="text-[10px] text-[var(--ink-500)] mb-3">
        Pipeline-Aware Voice Orchestration · TMLR 2026
      </p>

      {/* Tier rows — vertical stack so wide cost / count values never collide */}
      <div className="flex flex-col gap-2.5">
        {TIERS.map((t) => {
          const tierParticles = particles.filter((p) => p.tier === t.key);
          const tierCount = counts[t.key] ?? 0;
          const turnLabel =
            tierCount === 0 ? "idle" : tierCount === 1 ? "1 turn" : `${tierCount} turns`;
          return (
            <div key={t.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] font-semibold text-[var(--ink-100)] truncate">
                    {t.label}
                  </span>
                  <span className="text-[10px] text-[var(--ink-500)] truncate">
                    {t.sub}
                  </span>
                </div>
                <span
                  className="font-mono-tight text-[20px] font-bold tabular-nums shrink-0"
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
                      animationDuration:
                        t.key === "gemma-local" ? "1.6s" : t.key === "gemini-flash" ? "2.2s" : "3.0s",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tight text-[var(--ink-500)]">
                <span className="tabular-nums">{t.cost}/turn</span>
                <span className="tabular-nums">{turnLabel}</span>
              </div>
            </div>
          );
        })}
      </div>

      {recentReasons.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border-soft)]">
          <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
            Recent decisions
          </span>
          <ul className="mt-1.5 flex flex-col gap-1 font-mono-tight text-[10px]">
            {recentReasons.map((d, i) => (
              <li
                key={`${d.ts}-${i}`}
                className="rise-in flex items-center gap-1.5 min-w-0"
              >
                <span
                  className={`px-1 py-0 rounded text-[9px] font-semibold shrink-0 tier-pill-${shortTier(
                    d.tier,
                  )}`}
                >
                  {tierBadge(d.tier)}
                </span>
                <span className="text-[var(--ink-300)] truncate">
                  {d.agent_id}
                  <span className="text-[var(--ink-500)]">#{d.turn}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CountPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[8px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
        {label}
      </span>
      <span className="font-mono-tight text-[18px] font-bold text-[var(--mint)] tabular-nums">
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
