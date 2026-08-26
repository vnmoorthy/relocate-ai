"use client";

import { useEffect, useState } from "react";
import { AgentGlyph } from "@/components/AgentGlyph";
import { publicFeedText, redactDisplayText } from "@/lib/privacy";
import { tierMeta } from "@/lib/tiers";

/**
 * Node density. The orbital stage packs 29 nodes around the router, so the
 * card has to give ground as the ring tightens — but only ever by shortening
 * chrome, never by dropping the callsign or the telemetry line.
 *
 *   full    — grid view: full status word + category row (the original card)
 *   compact — orbit: 4-char status code, category row kept
 *   micro   — tight orbit: 4-char status code, 12px callsign, category row
 *             folded away (still announced to screen readers) and the elapsed
 *             clock dropped — the pulsing state dot carries "still running"
 */
export type CellDensity = "full" | "compact" | "micro";

interface Props {
  agentId: string;
  name: string;
  category: string;
  state: string | undefined;
  sinceTs: number | undefined;
  transcript: Array<{ role: string; text: string; ts: number; turn: number; tier?: string }>;
  demoMode: boolean;
  density?: CellDensity;
}

/**
 * Console-node state map. Status renders as a small dot + word — the glow
 * treatment lives on the node border (LIVE pulse, FAILED red, ACTION amber).
 */
const STATE: Record<string, { label: string; short: string; dot: string; text: string; pulse?: boolean }> = {
  idle: { label: "STANDBY", short: "STBY", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  dispatched: { label: "DISPATCHED", short: "DISP", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  calling: { label: "CALLING", short: "CALL", dot: "bg-[var(--amber)]", text: "text-[var(--amber)]" },
  "in-progress": { label: "LIVE", short: "LIVE", dot: "bg-[var(--red)]", text: "text-[var(--red)]", pulse: true },
  submitted: { label: "SUBMITTED", short: "SUB", dot: "bg-[var(--tier-haiku)]", text: "text-[var(--tier-haiku)]" },
  succeeded: { label: "DONE", short: "DONE", dot: "bg-[var(--mint)]", text: "text-[var(--mint)]" },
  "needs-user-action": { label: "ACTION", short: "ACT", dot: "bg-[var(--amber)]", text: "text-[var(--amber)]" },
  failed: { label: "FAILED", short: "FAIL", dot: "bg-[var(--red)]", text: "text-[var(--red)]" },
  closed: { label: "ENDED", short: "END", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  voicemail: { label: "VOICEMAIL", short: "VM", dot: "bg-[var(--ink-500)]", text: "text-[var(--ink-500)]" },
  error: { label: "ERROR", short: "ERR", dot: "bg-[var(--red)]", text: "text-[var(--red)]" },
};

export function AgentCell({
  agentId,
  name,
  category,
  state,
  sinceTs,
  transcript,
  demoMode,
  density = "full",
}: Props) {
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
  // Concierge-only voice indicator — a tiny equalizer while the call is hot.
  const voiceActive = agentId === "buyer" && (state === "in-progress" || state === "calling");
  const micro = density === "micro";
  const running = state === "in-progress" || state === "calling";
  const clock = running && sinceTs
    ? `${String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:${String(elapsedSec % 60).padStart(2, "0")}`
    : null;

  return (
    <article
      aria-labelledby={`agent-${agentId}-title`}
      className={`node-console ${isLive ? "node-console--live" : ""} ${
        isFailed ? "node-console--failed" : ""
      } ${needsAction ? "node-console--action" : ""}`}
    >
      {/* 300ms state-transition flash — remounts whenever the state changes */}
      <span key={state ?? "idle"} className="node-flash" aria-hidden="true" />

      {/* Row 1 — glyph + callsign + status */}
      <div className={`flex items-center justify-between min-w-0 ${micro ? "gap-1" : "gap-1.5"}`}>
        <span className="flex items-center gap-1 min-w-0">
          {/* The concierge's glyph IS a voice waveform, so while the call is
              hot it animates in place rather than doubling up with a second
              equalizer — which is also what buys the callsign its last 20px
              on an orbit card. */}
          {voiceActive ? (
            <span className={`voice-eq shrink-0 ${s.text}`} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
          ) : (
            <AgentGlyph agentId={agentId} className="node-glyph shrink-0" />
          )}
          <h3
            id={`agent-${agentId}-title`}
            className={`font-display leading-none text-[var(--ink-100)] truncate min-w-0 ${
              micro ? "text-[12px]" : "text-[13px]"
            }`}
          >
            {name}
          </h3>
        </span>
        <span className={`flex items-center shrink-0 ${micro ? "gap-1" : "gap-1.5"}`}>
          <span
            className={`h-[5px] w-[5px] rounded-full ${s.dot} ${s.pulse ? "live-dot" : ""}`}
            aria-hidden="true"
          />
          <span
            className={`tm-label tracking-[0.06em] ${s.text}`}
            aria-label={`${name} status: ${s.label.toLowerCase()}`}
          >
            {density === "full" ? s.label : s.short}
          </span>
        </span>
      </div>

      {/* Row 2 — category micro-label + live elapsed clock. Micro folds the
          row away: the category stays in the accessibility tree and the clock
          gives up its space to the callsign. */}
      {micro ? (
        <span className="sr-only">{category}</span>
      ) : (
        <div className="mt-[3px] flex items-center justify-between gap-2 min-w-0">
          <span className="tm-label text-[var(--ink-700)] truncate">{category}</span>
          {clock ? (
            <span className="font-mono-tight text-[10px] tabular-nums text-[var(--ink-300)] shrink-0">
              {clock}
            </span>
          ) : null}
        </div>
      )}

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
