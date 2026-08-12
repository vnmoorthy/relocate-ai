"use client";

import { useMemo } from "react";
import { PAVO_TIERS, tierMeta } from "@/lib/tiers";
import type { PavoTier } from "@/lib/types";
import type { DashboardConnection } from "@/lib/dashboard-state";
import { publicFeedText } from "@/lib/privacy";

interface Decision {
  agent_id: string;
  tier: string;
  reason: string;
  turn: number;
  ts: number;
}

interface Props {
  decisions: Decision[];
  totalDecisions: number;
  tierCounts: Partial<Record<PavoTier, number>>;
  connection: DashboardConnection;
}

export function PAVOFlow({ decisions, totalDecisions, tierCounts, connection }: Props) {
  const demoMode = connection === "demo";
  const connectionMeta = routingConnectionMeta(connection);
  const localCount = tierCounts["gemma-local"] ?? 0;
  const localShare = totalDecisions ? Math.round((localCount / totalDecisions) * 100) : 0;
  const recentReasons = decisions.slice(0, 4);
  const recentParticles = decisions.slice(0, 16);
  const visibleTiers = useMemo(
    () =>
      PAVO_TIERS.filter(
        (tier) =>
          (tierCounts[tier.key] ?? 0) > 0 ||
          tier.key === "gemma-local" ||
          tier.key === "gemini-flash" ||
          tier.key === "claude-opus",
      ),
    [tierCounts],
  );

  return (
    <section className="panel-elev p-4 relative overflow-hidden" aria-labelledby="pavo-routing-heading">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 id="pavo-routing-heading" className="text-[10px] tracking-[0.18em] text-[var(--ink-500)] uppercase shrink-0">
            PAVO routing
          </h3>
          <span className="inline-flex items-center gap-1 shrink-0" role="status">
            <span className={`h-1.5 w-1.5 rounded-full ${connectionMeta.dot}`} aria-hidden="true" />
            <span className={`text-[9px] tracking-[0.16em] uppercase font-semibold ${connectionMeta.text}`}>
              {connectionMeta.label}
            </span>
          </span>
        </div>
        <div className="flex items-baseline gap-3 shrink-0">
          <CountPill label="DEC" value={totalDecisions} />
          <CountPill label="LOCAL" value={`${localShare}%`} />
        </div>
      </div>
      <p className="text-[10px] text-[var(--ink-500)] mb-3">
        {demoMode
          ? "Synthetic routing decisions · no model calls"
          : connection === "live"
            ? "Reported routing events · provider availability depends on configuration"
            : "No active routing feed"}
      </p>

      <div className="flex flex-col gap-2.5">
        {visibleTiers.map((tier) => {
          const tierParticles = recentParticles.filter((decision) => decision.tier === tier.key);
          const tierCount = tierCounts[tier.key] ?? 0;
          const turnLabel = tierCount === 0 ? "idle" : tierCount === 1 ? "1 turn" : `${tierCount} turns`;
          return (
            <div key={tier.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] font-semibold text-[var(--ink-100)] truncate">{tier.label}</span>
                  <span className="text-[10px] text-[var(--ink-500)] truncate">{tier.subtitle}</span>
                </div>
                <span className="font-mono-tight text-[20px] font-bold tabular-nums shrink-0" style={{ color: tier.color }}>
                  {tierCount}
                </span>
              </div>
              <div className="pavo-lane" aria-hidden="true">
                {tierParticles.map((decision) => (
                  <span
                    key={`${decision.agent_id}-${decision.turn}-${decision.ts}`}
                    className="pavo-particle"
                    style={{
                      background: tier.color,
                      boxShadow: `0 0 12px 2px ${tier.color}`,
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tight text-[var(--ink-500)]">
                <span>{tier.availabilityLabel}</span>
                <span className="tabular-nums">{turnLabel}</span>
              </div>
            </div>
          );
        })}
      </div>

      {recentReasons.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border-soft)]">
          <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">Recent decisions</span>
          <ul className="mt-1.5 flex flex-col gap-1 font-mono-tight text-[10px]">
            {recentReasons.map((decision) => {
              const tier = tierMeta(decision.tier);
              return (
                <li key={`${decision.agent_id}-${decision.turn}-${decision.ts}`} className="rise-in flex items-start gap-1.5 min-w-0">
                  <span className={`px-1 py-0 rounded text-[9px] font-semibold shrink-0 tier-pill-${tier.pillClass}`}>
                    {tier.shortLabel}
                  </span>
                  <span className="text-[var(--ink-300)] min-w-0">
                    <span>{decision.agent_id}#{decision.turn}</span>
                    <span className="text-[var(--ink-500)] block truncate">
                      {publicFeedText(
                        decision.reason,
                        demoMode,
                        "Routing reason hidden on this public dashboard.",
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function routingConnectionMeta(connection: DashboardConnection) {
  switch (connection) {
    case "live":
      return {
        label: "Live",
        dot: "bg-[var(--red)] live-dot",
        text: "text-[var(--red)]",
      };
    case "demo":
      return {
        label: "Demo",
        dot: "bg-[var(--amber)]",
        text: "text-[var(--amber)]",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        dot: "bg-[var(--tier-haiku)]",
        text: "text-[var(--tier-haiku)]",
      };
    case "offline":
      return {
        label: "Offline",
        dot: "bg-[var(--ink-500)]",
        text: "text-[var(--ink-500)]",
      };
    case "connecting":
      return {
        label: "Connecting",
        dot: "bg-[var(--ink-500)]",
        text: "text-[var(--ink-500)]",
      };
  }
}

function CountPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[8px] tracking-[0.18em] text-[var(--ink-500)] uppercase">{label}</span>
      <span className="font-mono-tight text-[18px] font-bold text-[var(--mint)] tabular-nums">{value}</span>
    </div>
  );
}
