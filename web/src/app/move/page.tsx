"use client";

import { useEffect, useState } from "react";
import {
  MoveDetail,
  MoveDetailSkeleton,
  type MoveConn,
} from "@/components/MoveDetail";
import { parseDashboardMessage, reconnectDelay, withJitter } from "@/lib/dashboard-state";
import { discoverLiveApi, publicWsUrl } from "@/lib/live-config";
import {
  moveIdFromHash,
  moveSnapshotUrl,
  parseMoveSnapshot,
  pruneMoveOverlay,
  type MoveOverlayEntry,
  type MoveSnapshot,
} from "@/lib/move-page";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const THROTTLE_RETRY_MS = 20_000;
const ERROR_RETRY_MS = 15_000;

type Conn = MoveConn;

type LoadedPhase =
  | { kind: "unavailable" }
  | { kind: "not-found" }
  | { kind: "retry"; reason: "throttled" | "error" }
  | { kind: "ready"; api: string; snapshot: MoveSnapshot };

type Phase = LoadedPhase | { kind: "boot" } | { kind: "no-id" };

/**
 * Everything the loader effect owns, keyed by the move id it was loaded for.
 * Deriving "boot" from a key mismatch (instead of resetting state inside the
 * effect) keeps every setState call asynchronous — no cascading renders.
 */
interface LiveView {
  forId: string;
  phase: LoadedPhase | null; // null = discovery/snapshot still in flight
  conn: Conn;
  overlay: Record<string, MoveOverlayEntry>;
  finalizedLive: boolean;
}

function emptyView(forId: string): LiveView {
  return { forId, phase: null, conn: "connecting", overlay: {}, finalizedLive: false };
}

const EMPTY_OVERLAY: Record<string, MoveOverlayEntry> = {};

/**
 * Shareable per-move tracking page (static route; the move id rides in the
 * URL hash so the link survives static hosting: /move/#mkt_abc123).
 *
 * Data flow: hash id → discovery (live.json) → snapshot fetch → public WS
 * feed filtered to this event id, overlaying live agent_state events on the
 * snapshot. No secrets: the page only ever sees the redacted public surface.
 *
 * The tracker itself lives in <MoveDetail>, shared byte-for-byte with the
 * signed-in workspace at /app — this page owns only the loading around it.
 */
export default function MovePage() {
  // undefined = hash not read yet; null = read but missing/invalid.
  const [moveId, setMoveId] = useState<string | null | undefined>(undefined);
  const [rawView, setRawView] = useState<LiveView | null>(null);
  // Bumped after the unlock card is accepted, so the newly-running
  // specialists appear without waiting for the next live event.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // The id lives in the hash; react to hashchange so a pasted new link works
  // without a reload.
  useEffect(() => {
    const read = () => setMoveId(moveIdFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (typeof moveId !== "string") return;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let everOpened = false;

    // Every update goes through here: a stale view for another move id is
    // replaced wholesale, so no synchronous reset is ever needed.
    const patch = (mutate: (current: LiveView) => LiveView) => {
      setRawView((prev) => mutate(prev && prev.forId === moveId ? prev : emptyView(moveId)));
    };

    const scheduleSnapshotRetry = (api: string, delayMs: number) => {
      if (cancelled) return;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void loadSnapshot(api, true), delayMs);
    };

    const scheduleReconnect = (api: string) => {
      if (cancelled) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(
        () => connect(api),
        withJitter(reconnectDelay(reconnectAttempt)),
      );
      reconnectAttempt += 1;
    };

    // Set from the snapshot before connect(); the socket only opens after a
    // successful snapshot load, so it is always populated by then.
    let publicRef = "";

    const connect = (api: string) => {
      if (cancelled || socket) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(publicWsUrl(api));
      } catch {
        patch((v) => ({ ...v, conn: "offline" }));
        scheduleReconnect(api);
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (cancelled || socket !== ws) return;
        reconnectAttempt = 0;
        patch((v) => ({ ...v, conn: "live" }));
        // After a drop, events were missed — resync from the snapshot.
        if (everOpened) void loadSnapshot(api, true);
        everOpened = true;
      };
      ws.onmessage = (message) => {
        if (cancelled || socket !== ws) return;
        const event = parseDashboardMessage(message.data);
        // The public feed publishes the alias, never the real move id.
        if (!event || !publicRef || event.event_id !== publicRef) return;
        if (event.type === "agent_state") {
          patch((v) => ({
            ...v,
            overlay: {
              ...v.overlay,
              [event.agent_id]: {
                state: event.state,
                ts: event.ts,
                terminalOutcome: event.terminal_outcome ?? null,
              },
            },
          }));
        } else if (event.type === "event_finalized") {
          patch((v) => ({ ...v, finalizedLive: true }));
        } else if (event.type === "reply_received") {
          // Replies live in the snapshot (server-side dedupe + redaction);
          // a silent refetch keeps this page from double-counting.
          void loadSnapshot(api, true);
        }
      };
      ws.onclose = () => {
        if (cancelled || socket !== ws) return;
        socket = null;
        patch((v) => ({ ...v, conn: "offline" }));
        scheduleReconnect(api);
      };
      ws.onerror = () => {
        // onclose owns retry + badge transitions.
      };
    };

    const loadSnapshot = async (api: string, silent: boolean) => {
      try {
        const res = await fetch(moveSnapshotUrl(api, moveId), { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          patch((v) => ({ ...v, phase: { kind: "not-found" } }));
          return;
        }
        if (res.status === 503) {
          patch((v) => ({ ...v, phase: { kind: "unavailable" } }));
          return;
        }
        if (res.status === 429) {
          if (!silent) patch((v) => ({ ...v, phase: { kind: "retry", reason: "throttled" } }));
          scheduleSnapshotRetry(api, THROTTLE_RETRY_MS);
          return;
        }
        if (!res.ok) throw new Error(`snapshot http ${res.status}`);
        const snapshot = parseMoveSnapshot(await res.json());
        if (cancelled) return;
        if (!snapshot) throw new Error("snapshot payload malformed");
        publicRef = snapshot.public_ref;
        // A fresh snapshot is authoritative for everything it already knows
        // about; only live events newer than the snapshot itself survive it.
        patch((v) => ({
          ...v,
          phase: { kind: "ready", api, snapshot },
          overlay: pruneMoveOverlay(v.overlay, snapshot.ts),
        }));
        connect(api);
      } catch {
        if (cancelled) return;
        if (!silent) patch((v) => ({ ...v, phase: { kind: "retry", reason: "error" } }));
        scheduleSnapshotRetry(api, ERROR_RETRY_MS);
      }
    };

    void (async () => {
      const api = await discoverLiveApi();
      if (cancelled) return;
      if (!api) {
        patch((v) => ({ ...v, phase: { kind: "unavailable" }, conn: "offline" }));
        return;
      }
      await loadSnapshot(api, false);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(reconnectTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    };
  }, [moveId, refreshNonce]);

  const view = rawView && rawView.forId === moveId ? rawView : null;
  const phase: Phase =
    moveId === null ? { kind: "no-id" } : (view?.phase ?? { kind: "boot" });
  const conn: Conn = view?.conn ?? "connecting";
  const overlay = view?.overlay ?? EMPTY_OVERLAY;
  const finalizedLive = view?.finalizedLive ?? false;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className="site-nav site-nav--scrolled">
        <nav
          aria-label="Primary"
          className="w-full max-w-[880px] mx-auto px-5 sm:px-8 flex items-center justify-between gap-4"
        >
          <a href={`${BASE_PATH}/`} className="nav-wordmark">Relocate</a>
          <span className="tm-label text-[var(--text-quaternary)]">Move tracking</span>
        </nav>
      </header>

      <main
        id="main-content"
        className="flex-1 w-full max-w-[880px] mx-auto px-5 sm:px-8 pt-[calc(var(--nav-h)+2.5rem)] pb-20"
      >
        {phase.kind === "boot" && <MoveDetailSkeleton />}

        {phase.kind === "no-id" && (
          <Notice
            title={<>No move<br />reference</>}
            body="This tracking link is missing its move id. Open the link exactly as it was shared with you — it ends with #mkt_…"
          />
        )}

        {phase.kind === "not-found" && (
          <Notice
            title={<>We can&rsquo;t find<br />that move</>}
            body="That reference doesn't match any move on this deployment. Check the link, or start a new move from the home page."
          />
        )}

        {phase.kind === "unavailable" && (
          <Notice
            title={<>Tracking is<br />offline</>}
            body="This deployment isn't serving public move pages right now."
          />
        )}

        {phase.kind === "retry" && (
          <Notice
            title={<>One<br />moment</>}
            body={
              phase.reason === "throttled"
                ? "Too many refreshes from this connection — we'll retry automatically in a few seconds."
                : "The tracker couldn't load this move just now — retrying automatically."
            }
            showHome={false}
          />
        )}

        {phase.kind === "ready" && (
          <MoveDetail
            snapshot={phase.snapshot}
            overlay={overlay}
            conn={conn}
            finalizedLive={finalizedLive}
            api={phase.api}
            onUnlocked={() => setRefreshNonce((n) => n + 1)}
          />
        )}
      </main>

      <footer className="w-full border-t border-[var(--border-subtle)] mt-auto">
        <div className="max-w-[880px] mx-auto px-5 sm:px-8 py-10 flex flex-wrap items-center justify-between gap-4">
          <a href={`${BASE_PATH}/`} className="footer-link">Relocate</a>
          <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--text-quaternary)]">
            Live tracking · honest states
          </span>
        </div>
      </footer>
    </>
  );
}

function Notice({
  title,
  body,
  showHome = true,
}: {
  title: React.ReactNode;
  body: string;
  showHome?: boolean;
}) {
  return (
    <div>
      <p className="kicker mb-4">Your move</p>
      <h1 className="display-sub">{title}</h1>
      <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        {body}
      </p>
      {showHome && (
        <a href={`${BASE_PATH}/`} className="arrow-link mt-8">Back to Relocate →</a>
      )}
    </div>
  );
}
