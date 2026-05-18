"use client";

import { ArtifactsPanel } from "@/components/ArtifactsPanel";
import { CostTicker } from "@/components/CostTicker";
import { PAVOFlow } from "@/components/PAVOFlow";
import { SponsorRow } from "@/components/SponsorRow";
import { SwarmStage } from "@/components/SwarmStage";
import { useDashboardWS } from "@/lib/ws-client";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/dashboard";

export default function Dashboard() {
  const s = useDashboardWS(WS_URL);

  return (
    <main className="min-h-screen flex flex-col gap-3 p-4">
      {/* === Header === */}
      <header className="flex items-center justify-between px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[28px] text-[var(--ink-100)] tracking-tight">
              Relocate
            </span>
            <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-500)]">
              AI Relocation OS
            </span>
            <span className="text-[var(--ink-700)]">·</span>
            <a
              href="https://huggingface.co/datasets/vnmoorthy/pavo-bench"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[var(--ink-300)] hover:text-[var(--mint)] underline decoration-dotted underline-offset-2"
            >
              built on PAVO · TMLR 2026
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono-tight">
          <span className="text-[var(--ink-500)]">
            {new Date().toLocaleTimeString("en-US", { hour12: false })}
          </span>
          <span
            className={`flex items-center gap-1.5 ${
              s.connected ? "text-[var(--mint)]" : "text-[var(--red)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                s.connected ? "bg-[var(--mint)] live-dot" : "bg-[var(--red)]"
              }`}
            />
            <span className="tracking-[0.14em] uppercase font-semibold">
              {s.connected ? "Live" : "Disconnected"}
            </span>
          </span>
        </div>
      </header>

      {/* === Swarm stage (the centerpiece) + side panels === */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-[820px]">
        <div className="col-span-9 min-h-[820px] flex">
          <SwarmStage
            agentStates={s.agentStates}
            transcripts={s.transcripts}
            routingDecisions={s.routingDecisions}
            eventId={s.eventId}
          />
        </div>
        <div className="col-span-3 flex flex-col gap-3 min-h-0">
          <PAVOFlow decisions={s.routingDecisions} />
          <ArtifactsPanel sponsorEvents={s.sponsorEvents} />
        </div>
      </div>

      {/* === Sponsor row + cost ticker === */}
      <SponsorRow sponsorEvents={s.sponsorEvents} />
      <CostTicker
        pavoCents={s.pavoCents}
        baselineCents={s.baselineCents}
        decisions={s.routingDecisions.length}
      />

      {/* === Foot citation === */}
      <footer className="px-1 pb-1 flex items-center justify-end text-[9px] tracking-[0.16em] uppercase text-[var(--ink-700)]">
        <span>
          50,000-turn benchmark · CC-BY 4.0 ·{" "}
          <a
            href="https://huggingface.co/datasets/vnmoorthy/pavo-bench"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--ink-500)] hover:text-[var(--mint)]"
          >
            huggingface.co/datasets/vnmoorthy/pavo-bench
          </a>
        </span>
      </footer>
    </main>
  );
}
