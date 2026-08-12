"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyDashboardEvent,
  createDashboardState,
  dashboardEventKey,
  parseDashboardMessage,
  reconnectDelay,
  withConnection,
  type DashboardState,
} from "./dashboard-state";
import { buildDemoTimeline } from "./demo-replay";
import type { WSEvent } from "./types";

export type { DashboardState } from "./dashboard-state";

const FALLBACK_DELAY_MS = 1800;
const REPLAY_LOOP_GAP_MS = 4000;

export function isPlaceholderWsUrl(url: string): boolean {
  if (!url) return true;
  if (url.includes("example.com") || url.includes("CHANGE_ME") || url.includes("REPLACE_ME")) {
    return true;
  }
  return !url.startsWith("ws://") && !url.startsWith("wss://");
}

export function useDashboardWS(wsUrl: string): DashboardState {
  const placeholder = isPlaceholderWsUrl(wsUrl);
  const [state, setState] = useState<DashboardState>(() =>
    createDashboardState(placeholder ? "demo" : "connecting"),
  );
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | undefined;
    let replayTimers: number[] = [];
    let reconnectAttempt = 0;
    let hasConnected = false;
    let replayActive = false;
    let seenEventId: string | null = null;
    const seenEvents = new Set<string>();

    const clearReplayTimers = () => {
      for (const timer of replayTimers) window.clearTimeout(timer);
      replayTimers = [];
    };

    const stopReplay = () => {
      clearReplayTimers();
      replayActive = false;
    };

    const acceptEvent = (event: WSEvent) => {
      if (cancelled) return;
      if (seenEventId && seenEventId !== event.event_id) seenEvents.clear();
      seenEventId = event.event_id;
      const key = dashboardEventKey(event);
      if (seenEvents.has(key)) return;
      seenEvents.add(key);
      setState((current) => applyDashboardEvent(current, event));
    };

    const startReplay = () => {
      if (cancelled || hasConnected || replayActive) return;
      replayActive = true;
      clearReplayTimers();
      seenEvents.clear();
      seenEventId = "mkt_demo_replay";
      setState(createDashboardState("demo", "mkt_demo_replay"));

      const timeline = buildDemoTimeline();
      const startedAt = Date.now();
      for (const item of timeline) {
        const timer = window.setTimeout(() => {
          if (cancelled || hasConnected || !replayActive) return;
          acceptEvent({ ...item.event, ts: (startedAt + item.at_ms) / 1000 } as WSEvent);
        }, item.at_ms);
        replayTimers.push(timer);
      }

      const lastAt = timeline.at(-1)?.at_ms ?? 0;
      const loopTimer = window.setTimeout(() => {
        if (cancelled || hasConnected) return;
        replayActive = false;
        startReplay();
      }, lastAt + REPLAY_LOOP_GAP_MS);
      replayTimers.push(loopTimer);
    };

    if (placeholder) {
      const timer = window.setTimeout(startReplay, 0);
      replayTimers.push(timer);
      return () => {
        cancelled = true;
        stopReplay();
      };
    }

    const scheduleReconnect = (connect: () => void) => {
      if (cancelled || reconnectTimer !== undefined) return;
      const delay = reconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;
      if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
        return;
      }

      if (!replayActive) {
        setState((current) =>
          withConnection(current, hasConnected ? "reconnecting" : "connecting"),
        );
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch {
        startReplay();
        scheduleReconnect(connect);
        return;
      }
      wsRef.current = socket;

      socket.onopen = () => {
        if (cancelled || wsRef.current !== socket) return;
        const switchingFromDemo = replayActive;
        hasConnected = true;
        reconnectAttempt = 0;
        window.clearTimeout(fallbackTimer);
        stopReplay();
        if (switchingFromDemo) seenEvents.clear();
        setState((current) =>
          switchingFromDemo ? createDashboardState("live") : withConnection(current, "live"),
        );
      };

      socket.onmessage = (message) => {
        const event = parseDashboardMessage(message.data);
        if (!event) {
          setState((current) => ({ ...current, protocolErrors: current.protocolErrors + 1 }));
          return;
        }
        acceptEvent(event);
      };

      socket.onclose = () => {
        if (cancelled || wsRef.current !== socket) return;
        wsRef.current = null;
        if (hasConnected) {
          setState((current) => withConnection(current, "reconnecting"));
        } else {
          startReplay();
        }
        scheduleReconnect(connect);
      };

      socket.onerror = () => {
        // The close handler owns retry and UI state transitions.
      };
    };

    const fallbackTimer = window.setTimeout(startReplay, FALLBACK_DELAY_MS);
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.clearTimeout(fallbackTimer);
      stopReplay();
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
    };
  }, [placeholder, wsUrl]);

  return state;
}
