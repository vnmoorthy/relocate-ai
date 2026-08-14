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

/**
 * Console-node state map. Status renders as a small dot + word — the glow
 * treatment lives on the node border (LIVE pulse, FAILED red, ACTION amber).
 */
const STATE: Record<string, { label: string; dot: string; text: string; pulse?: boolean }> = {
  idle: { label: "STANDBY", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  dispatched: { label: "DISPATCHED", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  calling: { label: "CALLING", dot: "bg-[var(--amber)]", text: "text-[var(--amber)]" },
  "in-progress": { label: "LIVE", dot: "bg-[var(--red)]", text: "text-[var(--red)]", pulse: true },
  submitted: { label: "SUBMITTED", dot: "bg-[var(--tier-haiku)]", text: "text-[var(--tier-haiku)]" },
  succeeded: { label: "DONE", dot: "bg-[var(--mint)]", text: "text-[var(--mint)]" },
  "needs-user-action": { label: "ACTION", dot: "bg-[var(--amber)]", text: "text-[var(--amber)]" },
  failed: { label: "FAILED", dot: "bg-[var(--red)]", text: "text-[var(--red)]" },
  closed: { label: "ENDED", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  voicemail: { label: "VOICEMAIL", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  error: { label: "ERROR", dot: "bg-[var(--red)]", text: "text-[var(--red)]" },
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
  const lastTurn = transcript.length > 0 ? transcript[transcript.length - 1] : undefined;
  const lastAgentTurn = [...transcript].reverse().find((t) => t.role === "agent");
  const isLive = state === "in-progress";
  const isFailed = state === "failed" || state === "error";
  const needsAction = state === "needs-user-action";

  return (
    <article
      aria-labelledby={`agent-${agentId}-title`}
      className={`node-console ${isLive ? "node-console--live" : ""} ${
        isFailed ? "node-console--failed" : ""
      } ${needsAction ? "node-console--action" : ""}`}
    >
      {/* 300ms state-transition flash — remounts whenever the state changes */}
      <span key={state ?? "idle"} className="node-flash" aria-hidden="true" />

      {/* Row 1 — callsign + status */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <h3
          id={`agent-${agentId}-title`}
          className="font-display text-[13px] leading-none text-[var(--ink-100)] truncate"
        >
          {name}
        </h3>
        <span className="flex items-center gap-1.5 shrink-0">
          <span
            className={`h-[5px] w-[5px] rounded-full ${s.dot} ${s.pulse ? "live-dot" : ""}`}
            aria-hidden="true"
          />
          <span
            className={`tm-label ${s.text}`}
            aria-label={`${name} status: ${s.label.toLowerCase()}`}
          >
            {s.label}
          </span>
        </span>
      </div>

      {/* Row 2 — category micro-label + live elapsed clock */}
      <div className="mt-[3px] flex items-center justify-between gap-2 min-w-0">
        <span className="tm-label text-[var(--ink-700)] truncate">{category}</span>
        {(state === "in-progress" || state === "calling") && sinceTs ? (
          <span className="font-mono-tight text-[10px] tabular-nums text-[var(--ink-300)] shrink-0">
            {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:
            {String(elapsedSec % 60).padStart(2, "0")}
          </span>
        ) : null}
      </div>

      {/* Row 3 — one telemetry line: latest transcript turn or terminal outcome */}
      <div
        className="mt-auto pt-1.5 border-t border-[var(--border-soft)] flex items-baseline gap-1.5 min-w-0"
        role="log"
        aria-live={isLive ? "polite" : "off"}
        aria-label={`${name} transcript, sensitive values redacted`}
      >
        {state === "submitted" && lastAgentTurn ? (
          <span
            className="font-mono-tight text-[11px] leading-snug text-[var(--tier-haiku)] node-line flex-1 min-w-0"
            title="Provider accepted the request; the underlying service change is not confirmed complete."
          >
            ↗ submitted · {extractBid(lastAgentTurn.text)}
          </span>
        ) : state === "needs-user-action" && lastAgentTurn ? (
          <span className="font-mono-tight text-[11px] leading-snug text-[var(--amber)] node-line flex-1 min-w-0">
            ! user action · {extractBid(lastAgentTurn.text)}
          </span>
        ) : state === "succeeded" && lastAgentTurn ? (
          <span className="font-mono-tight text-[11px] leading-snug text-[var(--mint)] node-line flex-1 min-w-0">
            ✓ succeeded · {extractBid(lastAgentTurn.text)}
          </span>
        ) : state === "closed" ? (
          <span className="font-mono-tight text-[11px] leading-snug text-[var(--ink-300)] node-line flex-1 min-w-0">
            ended · outcome not reported
          </span>
        ) : lastTurn ? (
          <>
            <span
              className={`tm-label shrink-0 ${
                lastTurn.role === "agent" ? "text-[var(--ink-300)]" : "text-[var(--ink-500)]"
              }`}
            >
              {lastTurn.role === "agent" ? "AGT" : lastTurn.role === "counterparty" ? "REP" : "USR"}
            </span>
            <span className="font-mono-tight text-[11px] leading-snug text-[var(--ink-300)] node-line flex-1 min-w-0">
              {publicFeedText(
                lastTurn.text,
                demoMode,
                "Live transcript hidden on this public dashboard.",
              )}
            </span>
            {isLive && lastTurn.role === "agent" && (
              <span className="cursor-blink shrink-0 text-[11px] leading-none" aria-hidden="true" />
            )}
          </>
        ) : (
          <span className="font-mono-tight text-[11px] leading-snug text-[var(--ink-700)] node-line flex-1 min-w-0">
            standby
          </span>
        )}
        {lastAgentTurn?.tier && (
          <span
            className={`tm-label shrink-0 px-1.5 py-px rounded-[4px] tier-pill-${tierMeta(lastAgentTurn.tier).pillClass}`}
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
