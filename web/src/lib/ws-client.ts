"use client";

import { useEffect, useRef, useState } from "react";
import type { WSEvent } from "./types";
import { buildDemoTimeline } from "./demo-replay";

export interface DashboardState {
  transcripts: Record<string, Array<{ role: string; text: string; ts: number; turn: number; tier?: string }>>;
  agentStates: Record<string, { state: string; sinceTs: number }>;
  routingDecisions: Array<{ agent_id: string; tier: string; reason: string; turn: number; ts: number }>;
  pavoCents: number;
  baselineCents: number;
  sponsorEvents: Array<{ sponsor: string; action: string; detail?: string; ts: number }>;
  // v2: live field-collection state from the buyer. Keys are field names from
  // buyer_schema.BUYER_FIELDS; values are truncated display strings/numbers/bools.
  collectedFields: Record<string, string | number | boolean>;
  connected: boolean;
  eventId: string | null;
  // True when we couldn't reach a real orchestrator and are playing the demo
  // event timeline client-side. Surfaced so the UI can show a "DEMO" badge.
  demoMode: boolean;
}

const INITIAL: DashboardState = {
  transcripts: {},
  agentStates: {},
  routingDecisions: [],
  pavoCents: 0,
  baselineCents: 0,
  sponsorEvents: [],
  collectedFields: {},
  connected: false,
  eventId: null,
  demoMode: false,
};

// How long to wait for a real WebSocket before falling back to demo replay.
// Short so visitors on the static deploy never see a blank stage.
const FALLBACK_DELAY_MS = 800;
// Loop interval after the timeline ends. Cells stay in their "closed" state
// across the gap (we don't reset state), so the swarm never looks empty.
const REPLAY_LOOP_GAP_MS = 1500;

/** Heuristic: the WS URL is a placeholder (will never connect) — skip the
 *  WebSocket attempt entirely and go straight to demo replay. */
function isPlaceholderWsUrl(url: string): boolean {
  if (!url) return true;
  if (url.includes("example.com") || url.includes("CHANGE_ME") || url.includes("REPLACE_ME")) return true;
  // Anything that isn't ws:// or wss:// is malformed.
  return !url.startsWith("ws://") && !url.startsWith("wss://");
}

export function useDashboardWS(wsUrl: string): DashboardState {
  const [state, setState] = useState<DashboardState>(INITIAL);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryHandle: number | undefined;
    let fallbackHandle: number | undefined;
    let replayTimers: number[] = [];
    let everConnected = false;

    const clearReplay = () => {
      for (const t of replayTimers) window.clearTimeout(t);
      replayTimers = [];
    };

    const startReplay = () => {
      if (cancelled || everConnected) return;
      clearReplay();
      setState((s) => ({ ...s, demoMode: true, connected: true, eventId: "mkt_demo_replay" }));
      const timeline = buildDemoTimeline();
      const t0 = Date.now();
      for (const { at_ms, event } of timeline) {
        const handle = window.setTimeout(() => {
          if (cancelled || everConnected) return;
          const stamped = { ...event, ts: (t0 + at_ms) / 1000 } as WSEvent;
          setState((s) => applyEvent(s, stamped));
        }, at_ms);
        replayTimers.push(handle);
      }
      // Loop: re-arm without resetting state. New dispatch events overwrite
      // agent_state="closed" → "dispatched" → ... seamlessly, so the swarm
      // never blanks out between iterations.
      const last_ms = timeline.length ? timeline[timeline.length - 1].at_ms : 0;
      const loopHandle = window.setTimeout(() => {
        if (cancelled || everConnected) return;
        startReplay();
      }, last_ms + REPLAY_LOOP_GAP_MS);
      replayTimers.push(loopHandle);
    };

    const connect = () => {
      if (cancelled) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        // Browsers throw on invalid URLs (e.g. when wsUrl is the placeholder
        // on the static deploy). Skip straight to demo mode.
        startReplay();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        everConnected = true;
        clearReplay();
        if (fallbackHandle) window.clearTimeout(fallbackHandle);
        setState((s) => ({ ...s, connected: true, demoMode: false }));
      };

      ws.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as WSEvent;
          setState((s) => applyEvent(s, ev));
        } catch {
          /* ignore malformed */
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        if (everConnected) {
          // Real orchestrator we had a session with — try to reconnect.
          setState((s) => ({ ...s, connected: false }));
          retryHandle = window.setTimeout(connect, 1500);
        }
        // If we never connected, fallbackHandle will fire startReplay() below.
      };

      ws.onerror = () => {
        // onclose will fire next; fallbackHandle handles the "never connected" case.
      };
    };

    // If the URL is obviously a placeholder (static deploy), skip the WS
    // attempt entirely and start the replay on the next tick.
    if (isPlaceholderWsUrl(wsUrl)) {
      const h = window.setTimeout(startReplay, 50);
      replayTimers.push(h);
      return () => {
        cancelled = true;
        clearReplay();
      };
    }

    fallbackHandle = window.setTimeout(() => {
      if (!everConnected && !cancelled) startReplay();
    }, FALLBACK_DELAY_MS);

    connect();

    return () => {
      cancelled = true;
      if (retryHandle) window.clearTimeout(retryHandle);
      if (fallbackHandle) window.clearTimeout(fallbackHandle);
      clearReplay();
      wsRef.current?.close();
    };
  }, [wsUrl]);

  return state;
}

function applyEvent(s: DashboardState, ev: WSEvent): DashboardState {
  switch (ev.type) {
    case "transcript_turn": {
      const prev = s.transcripts[ev.agent_id] ?? [];
      const next = [...prev, { role: ev.role, text: ev.text, ts: ev.ts, turn: ev.turn, tier: ev.pavo_tier }];
      // Keep last 8 turns per cell for display.
      const trimmed = next.slice(-8);
      return {
        ...s,
        transcripts: { ...s.transcripts, [ev.agent_id]: trimmed },
        eventId: s.eventId ?? ev.event_id,
      };
    }
    case "routing_decision": {
      const next = [
        { agent_id: ev.agent_id, tier: ev.tier, reason: ev.reason, turn: ev.turn, ts: ev.ts },
        ...s.routingDecisions,
      ].slice(0, 20);
      return { ...s, routingDecisions: next };
    }
    case "agent_state":
      return {
        ...s,
        agentStates: {
          ...s.agentStates,
          [ev.agent_id]: { state: ev.state, sinceTs: ev.ts },
        },
      };
    case "cost_update":
      return { ...s, pavoCents: ev.pavo_cents, baselineCents: ev.baseline_cents };
    case "event_complete":
      return s;
    case "sponsor_event": {
      const next = [
        { sponsor: ev.sponsor, action: ev.action, detail: ev.detail, ts: ev.ts },
        ...s.sponsorEvents,
      ].slice(0, 12);
      return { ...s, sponsorEvents: next };
    }
    case "fields_collected": {
      // Merge — never overwrite previously-collected values.
      const next = { ...s.collectedFields };
      for (const [k, v] of Object.entries(ev.values)) {
        if (!(k in next)) next[k] = v;
      }
      return { ...s, collectedFields: next, eventId: s.eventId ?? ev.event_id };
    }
    default:
      return s;
  }
}
