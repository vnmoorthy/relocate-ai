"use client";

import { useEffect, useRef, useState } from "react";
import type { WSEvent } from "./types";

export interface DashboardState {
  // Per-agent transcript turns (last 6 each)
  transcripts: Record<string, Array<{ role: string; text: string; ts: number; turn: number; tier?: string }>>;
  // Per-agent state machine
  agentStates: Record<string, { state: string; sinceTs: number }>;
  // Last 20 routing decisions, newest first
  routingDecisions: Array<{ agent_id: string; tier: string; reason: string; turn: number; ts: number }>;
  // Cost ticker
  pavoCents: number;
  baselineCents: number;
  // Sponsor events (for the integrations row)
  sponsorEvents: Array<{ sponsor: string; action: string; detail?: string; ts: number }>;
  // Connected flag
  connected: boolean;
  eventId: string | null;
}

const INITIAL: DashboardState = {
  transcripts: {},
  agentStates: {},
  routingDecisions: [],
  pavoCents: 0,
  baselineCents: 0,
  sponsorEvents: [],
  connected: false,
  eventId: null,
};

export function useDashboardWS(wsUrl: string): DashboardState {
  const [state, setState] = useState<DashboardState>(INITIAL);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryHandle: number | undefined;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, connected: true }));
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
        setState((s) => ({ ...s, connected: false }));
        retryHandle = window.setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        // onclose will fire next
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (retryHandle) window.clearTimeout(retryHandle);
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
    default:
      return s;
  }
}
