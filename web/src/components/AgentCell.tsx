"use client";

import { useEffect, useState } from "react";

interface Props {
  agentId: string;
  name: string;
  category: string;
  state: string | undefined;
  sinceTs: number | undefined;
  transcript: Array<{ role: string; text: string; ts: number; turn: number; tier?: string }>;
}

const STATE: Record<
  string,
  { label: string; dot: string; ring: string; text: string; pulse?: boolean }
> = {
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
  closed: {
    label: "CLOSED",
    dot: "bg-[var(--mint)]",
    ring: "ring-[rgba(0,255,163,0.30)]",
    text: "text-[var(--mint)]",
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

const TIER_BAR: Record<string, string> = {
  "gemma-local": "var(--tier-local)",
  "gemini-flash": "var(--tier-flash)",
  "claude-opus": "var(--tier-opus)",
  "claude-haiku": "var(--tier-opus)",
  "fallback-mock": "var(--tier-mock)",
};

export function AgentCell({ agentId, name, category, state, sinceTs, transcript }: Props) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!sinceTs || state === "closed" || state === "error" || state === "voicemail") return;
    const tick = () => setElapsedSec(Math.floor(Date.now() / 1000 - sinceTs));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [sinceTs, state]);

  const s = STATE[state ?? "dispatched"] ?? STATE.dispatched;
  const lastTurns = transcript.slice(-4);
  const lastAgentTurn = [...transcript].reverse().find((t) => t.role === "agent");
  const isLive = state === "in-progress";

  return (
    <div
      className={`panel relative flex flex-col h-full overflow-hidden transition-shadow ${
        isLive ? "live-pulse" : ""
      }`}
    >
      {/* Top status strip */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-[var(--border-soft)]">
        <div className="flex flex-col">
          <span className="font-display text-[13px] text-[var(--ink-100)] leading-tight">
            {name}
          </span>
          <span className="text-[9px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
            {category}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className={`flex items-center gap-1.5 ring-1 ${s.ring} rounded-full px-2 py-0.5`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "live-dot" : ""}`} />
            <span className={`text-[9px] font-semibold tracking-[0.14em] ${s.text}`}>
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
      <div className="flex-1 overflow-hidden px-3 py-2 flex flex-col gap-1.5 text-[11px] leading-snug">
        {lastTurns.length === 0 ? (
          <span className="text-[var(--ink-500)] italic text-[10px]">Idle…</span>
        ) : (
          lastTurns.map((t, i) => {
            const isAgent = t.role === "agent";
            const tierColor = t.tier ? TIER_BAR[t.tier] : undefined;
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
                <span className="text-[var(--ink-300)] break-words flex-1">
                  {t.text}
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
      <div className="px-3 pb-2 pt-1 flex items-center justify-between border-t border-[var(--border-soft)] min-h-[22px]">
        {state === "closed" && lastAgentTurn ? (
          <span className="text-[9px] font-mono-tight text-[var(--mint)] truncate">
            ✓ {extractBid(lastAgentTurn.text)}
          </span>
        ) : (
          <span className="text-[9px] tracking-widest text-[var(--ink-500)] uppercase">
            #{agentId}
          </span>
        )}
        {lastAgentTurn?.tier && (
          <span
            className={`text-[8px] font-semibold tracking-[0.1em] px-1.5 py-0.5 rounded tier-pill-${shortTier(lastAgentTurn.tier)}`}
          >
            {tierLabel(lastAgentTurn.tier)}
          </span>
        )}
      </div>
    </div>
  );
}

function extractBid(text: string): string {
  // Try to find a "Bid:" line; fall back to truncated last sentence.
  const m = text.match(/Bid:\s*(.*?)(?:\.|$)/i);
  if (m) return m[1].trim().slice(0, 70);
  return text.slice(0, 70);
}

function shortTier(t: string): "local" | "flash" | "opus" | "mock" {
  if (t === "gemma-local") return "local";
  if (t === "gemini-flash") return "flash";
  if (t === "claude-opus" || t === "claude-haiku") return "opus";
  return "mock";
}

function tierLabel(t: string): string {
  if (t === "gemma-local") return "G-2B";
  if (t === "gemini-flash") return "GEM-FL";
  if (t === "claude-opus") return "C-OPUS";
  if (t === "claude-haiku") return "C-HKU";
  return "MOCK";
}
