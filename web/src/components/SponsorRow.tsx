"use client";

import { sponsorStatus, type SponsorStatus } from "@/lib/dashboard-state";

interface SponsorEvent {
  sponsor: string;
  action: string;
  detail?: string;
  ts: number;
}

interface Props {
  sponsorEvents: SponsorEvent[];
  demoMode: boolean;
}

const SPONSORS = [
  { id: "agentphone", name: "AgentPhone", role: "Inbound voice" },
  { id: "deepmind", name: "Google DeepMind", role: "Gemma + Gemini" },
  { id: "agentmail", name: "AgentMail", role: "Email artifacts" },
  { id: "browser_use", name: "Browser Use", role: "Web forms" },
  { id: "lob", name: "Lob", role: "Certified mail" },
  { id: "supermemory", name: "Supermemory", role: "Persist + recall" },
  { id: "moss", name: "Moss", role: "Runbook RAG" },
] as const;

const STATUS_STYLE: Record<SponsorStatus, { pill: string; dot: string; label: string }> = {
  reported: {
    pill: "text-[var(--mint)] border-[rgba(0,212,154,0.35)] bg-[rgba(0,212,154,0.06)]",
    dot: "bg-[var(--mint)]",
    label: "REPORTED",
  },
  // Renders as the normal reported pill — the page-level SIMULATION tag
  // carries the disclosure.
  demo: {
    pill: "text-[var(--mint)] border-[rgba(0,212,154,0.35)] bg-[rgba(0,212,154,0.06)]",
    dot: "bg-[var(--mint)]",
    label: "REPORTED",
  },
  fallback: {
    pill: "text-[var(--tier-haiku)] border-[rgba(96,165,250,0.35)] bg-[rgba(96,165,250,0.06)]",
    dot: "bg-[var(--tier-haiku)]",
    label: "FALLBACK",
  },
  error: {
    pill: "text-[var(--red)] border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.06)]",
    dot: "bg-[var(--red)]",
    label: "ERROR",
  },
  idle: {
    pill: "",
    dot: "bg-[var(--ink-700)]",
    label: "idle",
  },
};

export function SponsorRow({ sponsorEvents, demoMode }: Props) {
  return (
    <section className="panel px-3 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-clean scroll-fade-r" aria-labelledby="integration-heading">
      <h3 id="integration-heading" className="text-[10px] tracking-[0.12em] text-[var(--ink-500)] uppercase shrink-0 pr-2 border-r border-[var(--border-soft)]">
        Integrations
      </h3>
      <div className="flex items-center gap-2" role="list" aria-live="polite">
        {SPONSORS.map((sponsor) => {
          const event = sponsorEvents.find((candidate) => candidate.sponsor === sponsor.id);
          const status = sponsorStatus(event, demoMode);
          const style = STATUS_STYLE[status];
          const isLatest = sponsorEvents[0]?.sponsor === sponsor.id;
          const isIdle = status === "idle";
          return (
            <div
              key={sponsor.id}
              role="listitem"
              title={isIdle ? `${sponsor.name}: no event reported yet` : undefined}
              className={`flex items-center gap-2 px-2.5 py-1 rounded-md border shrink-0 transition-shadow ${isLatest ? "rise-in" : ""} bg-[var(--bg-elev)] ${isIdle ? "border-transparent" : "border-[var(--border-soft)]"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${isIdle ? "opacity-60" : ""}`} aria-hidden="true" />
              <span className={`text-[11px] font-medium ${isIdle ? "text-[var(--ink-500)]" : "text-[var(--ink-100)]"}`}>{sponsor.name}</span>
              <span className={`text-[9px] ${isIdle ? "text-[var(--ink-700)]" : "text-[var(--ink-500)]"}`}>{sponsor.role}</span>
              {isIdle ? (
                <span className="text-[9px] text-[var(--ink-700)]" aria-label={`${sponsor.name}: no event reported yet`}>
                  {style.label}
                </span>
              ) : (
                <span className={`text-[8px] font-semibold tracking-[0.14em] px-1.5 py-0.5 rounded border ${style.pill}`}>
                  {style.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
