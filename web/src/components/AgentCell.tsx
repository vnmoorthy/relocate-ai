"use client";

import { useEffect, useState } from "react";
import { publicFeedText, redactDisplayText } from "@/lib/privacy";
import { tierMeta } from "@/lib/tiers";

interface Props {
  agentId: string;
  name: string;
  category: string;
  state: string | undefined;
  sinceTs: number | undefined;
  transcript: Array<{ role: string; text: string; ts: number; turn: number; tier?: string }>;
  demoMode: boolean;
}

const STATE: Record<
  string,
  { label: string; dot: string; ring: string; text: string; pulse?: boolean }
> = {
  idle: {
    label: "STANDBY",
    dot: "bg-[var(--ink-500)]",
    ring: "ring-[var(--border-mid)]",
    text: "text-[var(--ink-500)]",
  },
  dispatched: {
    label: "DISPATCHED",
    dot: "bg-[var(--ink-500)]",
    ring: "ring-[var(--border-mid)]",
    text: "text-[var(--ink-500)]",
  },
  calling: {
    label: "CALLING",
    dot: "bg-[var(--amber)]",
    ring: "ring-[rgba(255,201,74,0.30)]",
    text: "text-[var(--amber)]",
  },
  "in-progress": {
    label: "LIVE",
    dot: "bg-[var(--red)]",
    ring: "ring-[rgba(255,92,92,0.40)]",
    text: "text-[var(--red)]",
    pulse: true,
  },
  submitted: {
    label: "SUBMITTED",
    dot: "bg-[var(--tier-haiku)]",
    ring: "ring-[rgba(96,165,250,0.35)]",
    text: "text-[var(--tier-haiku)]",
  },
  succeeded: {
    label: "DONE",
    dot: "bg-[var(--mint)]",
    ring: "ring-[rgba(0,212,154,0.30)]",
    text: "text-[var(--mint)]",
  },
  "needs-user-action": {
    label: "ACTION",
    dot: "bg-[var(--amber)]",
    ring: "ring-[rgba(251,191,36,0.35)]",
    text: "text-[var(--amber)]",
  },
  failed: {
    label: "FAILED",
    dot: "bg-[var(--red)]",
    ring: "ring-[rgba(248,113,113,0.40)]",
    text: "text-[var(--red)]",
  },
  closed: {
    label: "ENDED",
    dot: "bg-[var(--ink-500)]",
    ring: "ring-[var(--border-mid)]",
    text: "text-[var(--ink-500)]",
  },
  voicemail: {
    label: "VOICEMAIL",
    dot: "bg-[var(--ink-500)]",
    ring: "ring-[var(--border-mid)]",
    text: "text-[var(--ink-500)]",
  },
  error: {
    label: "ERROR",
    dot: "bg-[var(--red)]",
    ring: "ring-[rgba(255,92,92,0.40)]",
    text: "text-[var(--red)]",
  },
};

export function AgentCell({ agentId, name, category, state, sinceTs, transcript, demoMode }: Props) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (
      !sinceTs ||
      state === "submitted" ||
      state === "succeeded" ||
      state === "needs-user-action" ||
      state === "failed" ||
      state === "closed" ||
      state === "error" ||
      state === "voicemail"
    ) return;
    const tick = () => setElapsedSec(Math.max(0, Math.floor(Date.now() / 1000 - sinceTs)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [sinceTs, state]);

  const s = STATE[state ?? "idle"] ?? STATE.idle;
  const lastTurns = transcript.slice(-4);
  const lastAgentTurn = [...transcript].reverse().find((t) => t.role === "agent");
  const isLive = state === "in-progress";

  return (
    <article
      aria-labelledby={`agent-${agentId}-title`}
      className={`panel relative flex flex-col h-full overflow-hidden transition-shadow ${
        isLive ? "live-pulse" : ""
      }`}
    >
      {/* Top status strip */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-[var(--border-soft)]">
        <div className="flex flex-col">
          <h3 id={`agent-${agentId}-title`} className="font-display text-[13px] text-[var(--ink-100)] leading-tight">
            {name}
          </h3>
          <span className="text-[10px] tracking-[0.12em] text-[var(--ink-500)] uppercase">
            {category}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <div className={`flex items-center gap-1.5 ring-1 ${s.ring} rounded-full px-2 py-0.5 whitespace-nowrap`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "live-dot" : ""}`} aria-hidden="true" />
            <span className={`text-[10px] font-semibold tracking-[0.12em] whitespace-nowrap ${s.text}`} aria-label={`${name} status: ${s.label.toLowerCase()}`}>
              {s.label}
            </span>
          </div>
          {(state === "in-progress" || state === "calling") && sinceTs && (
            <span className="text-[10px] font-mono-tight text-[var(--ink-300)]">
              {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:
              {String(elapsedSec % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      </div>

      {/* Transcript */}
      <div
        className="flex-1 min-h-0 overflow-hidden transcript-clip px-3 py-2 flex flex-col gap-1.5 text-[11px] leading-snug"
        role="log"
        aria-live={isLive ? "polite" : "off"}
        aria-label={`${name} transcript, sensitive values redacted`}
      >
        {lastTurns.length === 0 ? (
          <span className="text-[var(--ink-500)] italic text-[10px]">Idle…</span>
        ) : (
          lastTurns.map((t, i) => {
            const isAgent = t.role === "agent";
            const tierColor = t.tier ? tierMeta(t.tier).color : undefined;
            const isLast = i === lastTurns.length - 1;
            return (
              <div
                key={`${t.ts}-${i}`}
                className="rise-in flex items-start gap-2"
              >
                {/* Vertical tier bar (only on agent turns) */}
                <span
                  className="shrink-0 w-[2px] self-stretch rounded-sm"
                  style={{ background: isAgent ? tierColor ?? "var(--border-mid)" : "var(--border-soft)" }}
                />
                <span
                  className={`shrink-0 text-[9px] font-semibold tracking-widest pt-px ${
                    isAgent ? "text-[var(--mint)]" : "text-[var(--ink-500)]"
                  }`}
                >
                  {isAgent ? "AGT" : t.role === "counterparty" ? "REP" : "USR"}
                </span>
                <span className="text-[var(--ink-300)] break-words flex-1 min-w-0 line-clamp-2">
                  {publicFeedText(
                    t.text,
                    demoMode,
                    "Live transcript hidden on this public dashboard.",
                  )}
                  {isAgent && isLast && isLive && (
                    <span className="cursor-blink" />
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer: bid summary if closed, or tier badge if live */}
      <div className="px-3 pb-2 pt-1 flex items-center justify-between gap-2 border-t border-[var(--border-soft)] min-h-[22px] shrink-0 bg-[var(--bg-elev-1)]">
        {state === "submitted" && lastAgentTurn ? (
          <span className="text-[10px] font-mono-tight text-[var(--tier-haiku)] truncate" title="Provider accepted the request; the underlying service change is not confirmed complete.">
            ↗ submitted · {extractBid(lastAgentTurn.text)}
          </span>
        ) : state === "needs-user-action" && lastAgentTurn ? (
          <span className="text-[10px] font-mono-tight text-[var(--amber)] truncate">
            ! user action · {extractBid(lastAgentTurn.text)}
          </span>
        ) : state === "succeeded" && lastAgentTurn ? (
          <span className="text-[10px] font-mono-tight text-[var(--mint)] truncate">
            ✓ succeeded · {extractBid(lastAgentTurn.text)}
          </span>
        ) : state === "closed" ? (
          <span className="text-[10px] font-mono-tight text-[var(--ink-300)] truncate">
            ended · outcome not reported
          </span>
        ) : (
          <span className="text-[10px] tracking-widest text-[var(--ink-500)] uppercase">
            #{agentId}
          </span>
        )}
        {lastAgentTurn?.tier && (
          <span
            className={`text-[10px] font-semibold tracking-[0.1em] px-1.5 py-0.5 rounded tier-pill-${tierMeta(lastAgentTurn.tier).pillClass}`}
          >
            {tierMeta(lastAgentTurn.tier).shortLabel}
          </span>
        )}
      </div>
    </article>
  );
}

function extractBid(text: string): string {
  // Try to find a "Bid:" line; fall back to truncated last sentence.
  const m = text.match(/Bid:\s*(.*?)(?:\.|$)/i);
  if (m) return redactDisplayText(m[1].trim().slice(0, 70));
  return redactDisplayText(text.slice(0, 70));
}
