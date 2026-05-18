"use client";

import { useEffect, useState } from "react";

interface SponsorEvent {
  sponsor: string;
  action: string;
  detail?: string;
  ts: number;
}

interface Props {
  sponsorEvents: SponsorEvent[];
}

type Status = "real" | "stub" | "error" | "idle";

const SPONSORS: Array<{
  id: string;
  name: string;
  role: string;
  status: Status;
}> = [
  { id: "agentphone", name: "AgentPhone", role: "Telephony", status: "real" },
  { id: "deepmind", name: "Google DeepMind", role: "Gemma + Gemini", status: "real" },
  { id: "agentmail", name: "AgentMail", role: "Email receipt", status: "real" },
  { id: "supermemory", name: "Supermemory", role: "Relocate history", status: "real" },
  { id: "sponge", name: "sponge", role: "Agent payments", status: "error" },
  { id: "browser_use", name: "Browser Use", role: "USPS COA", status: "stub" },
  { id: "stripe", name: "Stripe", role: "Mover deposit", status: "stub" },
  { id: "moss", name: "Moss", role: "Runbook RAG", status: "stub" },
];

const STATUS_STYLE: Record<Status, { pill: string; dot: string }> = {
  real: {
    pill: "text-[var(--mint)] border-[rgba(0,255,163,0.35)] bg-[rgba(0,255,163,0.06)]",
    dot: "bg-[var(--mint)]",
  },
  stub: {
    pill: "text-[var(--ink-500)] border-[var(--border-mid)] bg-[rgba(255,255,255,0.02)]",
    dot: "bg-[var(--ink-500)]",
  },
  error: {
    pill: "text-[var(--red)] border-[rgba(255,92,92,0.35)] bg-[rgba(255,92,92,0.06)]",
    dot: "bg-[var(--red)]",
  },
  idle: {
    pill: "text-[var(--ink-500)] border-[var(--border-soft)] bg-transparent",
    dot: "bg-[var(--ink-700)]",
  },
};

const STATUS_LABEL: Record<Status, string> = {
  real: "REAL",
  stub: "STUB",
  error: "ERR",
  idle: "IDLE",
};

export function SponsorRow({ sponsorEvents }: Props) {
  // Track recent firings for the "just fired" pulse effect.
  const [recentlyFired, setRecentlyFired] = useState<Record<string, number>>({});

  useEffect(() => {
    const updates: Record<string, number> = {};
    const now = Date.now();
    for (const ev of sponsorEvents) {
      if (now - ev.ts * 1000 < 4000) {
        updates[ev.sponsor] = ev.ts;
      }
    }
    setRecentlyFired(updates);
  }, [sponsorEvents]);

  return (
    <section className="panel px-3 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-clean">
      <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase shrink-0 pr-2 border-r border-[var(--border-soft)]">
        Sponsors
      </span>
      {SPONSORS.map((s) => {
        const style = STATUS_STYLE[s.status];
        const justFired = !!recentlyFired[s.id];
        return (
          <div
            key={s.id}
            className={`flex items-center gap-2 px-2.5 py-1 rounded-md border shrink-0 transition-shadow ${
              justFired ? "live-pulse" : ""
            } bg-[var(--bg-elev)] border-[var(--border-soft)]`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
            <span className="text-[11px] font-medium text-[var(--ink-100)]">{s.name}</span>
            <span className="text-[9px] text-[var(--ink-500)]">{s.role}</span>
            <span
              className={`text-[8px] font-semibold tracking-[0.14em] px-1.5 py-0.5 rounded border ${style.pill}`}
            >
              {STATUS_LABEL[s.status]}
            </span>
          </div>
        );
      })}
    </section>
  );
}
