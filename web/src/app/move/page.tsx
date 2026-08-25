"use client";

import { useEffect, useMemo, useState } from "react";
import { AgentGlyph } from "@/components/AgentGlyph";
import { parseDashboardMessage, reconnectDelay, withJitter } from "@/lib/dashboard-state";
import { discoverLiveApi, publicWsUrl } from "@/lib/live-config";
import {
  cityFromAddress,
  formatMoveDate,
  mergeMoveTasks,
  moveAgentName,
  moveIdFromHash,
  moveSnapshotUrl,
  moveTaskCounts,
  parseMoveSnapshot,
  replyLine,
  shortMoveRef,
  sortQuotedReplies,
  type MoveReply,
  type MoveReplyQuote,
  type MoveSnapshot,
  type MoveTaskView,
} from "@/lib/move-page";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const THROTTLE_RETRY_MS = 20_000;
const ERROR_RETRY_MS = 15_000;

// Reused verbatim from the dashboard's submitted tooltip — same honest wording.
const SUBMITTED_TOOLTIP =
  "Provider accepted the request; the underlying service change is not confirmed complete.";

type Conn = "connecting" | "live" | "offline";

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
  overlay: Record<string, { state: string }>;
  finalizedLive: boolean;
}

function emptyView(forId: string): LiveView {
  return { forId, phase: null, conn: "connecting", overlay: {}, finalizedLive: false };
}

const EMPTY_OVERLAY: Record<string, { state: string }> = {};

/** Status dot + word — same palette and labels as the dashboard's AgentCell. */
const STATE_META: Record<string, { label: string; dot: string; text: string; pulse?: boolean }> = {
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

/**
 * Shareable per-move tracking page (static route; the move id rides in the
 * URL hash so the link survives static hosting: /move/#mkt_abc123).
 *
 * Data flow: hash id → discovery (live.json) → snapshot fetch → public WS
 * feed filtered to this event id, overlaying live agent_state events on the
 * snapshot. No secrets: the page only ever sees the redacted public surface.
 */
export default function MovePage() {
  // undefined = hash not read yet; null = read but missing/invalid.
  const [moveId, setMoveId] = useState<string | null | undefined>(undefined);
  const [rawView, setRawView] = useState<LiveView | null>(null);

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
        if (!event || event.event_id !== moveId) return;
        if (event.type === "agent_state") {
          patch((v) => ({
            ...v,
            overlay: { ...v.overlay, [event.agent_id]: { state: event.state } },
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
        // A fresh snapshot is authoritative; live events re-apply on top.
        patch((v) => ({ ...v, phase: { kind: "ready", api, snapshot }, overlay: {} }));
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
  }, [moveId]);

  const view = rawView && rawView.forId === moveId ? rawView : null;
  const phase: Phase =
    moveId === null ? { kind: "no-id" } : (view?.phase ?? { kind: "boot" });
  const conn: Conn = view?.conn ?? "connecting";
  const overlay = view?.overlay ?? EMPTY_OVERLAY;
  const finalizedLive = view?.finalizedLive ?? false;

  const snapshot = phase.kind === "ready" ? phase.snapshot : null;
  const tasks = useMemo(
    () => (snapshot ? mergeMoveTasks(snapshot.specialists, overlay) : []),
    [snapshot, overlay],
  );
  const counts = useMemo(() => moveTaskCounts(tasks), [tasks]);
  const quotedReplies = useMemo(
    () => (snapshot ? sortQuotedReplies(snapshot.replies) : []),
    [snapshot],
  );
  const ownTasks = tasks.filter((task) => task.state === "needs-user-action");
  const finalized = (snapshot?.finalized ?? false) || finalizedLive;

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
        {phase.kind === "boot" && <LoadingSkeleton />}

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

        {phase.kind === "ready" && snapshot && (
          <>
            {/* ── Header ─────────────────────────────────────────────── */}
            <p className="kicker mb-4">Your move · {shortMoveRef(snapshot.event_id)}</p>
            <h1 className="display-sub mv-route">
              <span>{cityFromAddress(snapshot.route.origin_address) || "Origin"}</span>
              <svg
                className="mv-route-arrow"
                aria-hidden="true"
                viewBox="0 0 32 16"
                fill="none"
              >
                <path d="M0 8h29M23 1.5l7 6.5-7 6.5" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              <span className="sr-only">to</span>
              <span>{cityFromAddress(snapshot.route.destination_address) || "Destination"}</span>
            </h1>
            <p className="mt-5 text-[13.5px] leading-[1.65] text-[var(--text-secondary)] break-words">
              {snapshot.route.origin_address || "—"}
              <span className="text-[var(--text-quaternary)]" aria-hidden="true"> → </span>
              <span className="sr-only"> to </span>
              {snapshot.route.destination_address || "—"}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {snapshot.route.move_date && (
                <span className="mv-chip">{formatMoveDate(snapshot.route.move_date)}</span>
              )}
              {snapshot.flags.has_pets && <span className="mv-chip mv-chip--flag">Pets</span>}
              {snapshot.flags.has_children && <span className="mv-chip mv-chip--flag">Kids</span>}
              {snapshot.flags.has_car && <span className="mv-chip mv-chip--flag">Car</span>}
              {snapshot.flags.has_visa && <span className="mv-chip mv-chip--flag">Visa</span>}
            </div>

            {/* ── Progress strip ─────────────────────────────────────── */}
            <section aria-labelledby="mv-progress-heading" className="mt-10">
              <h2 id="mv-progress-heading" className="sr-only">Dispatch progress</h2>
              <div className="mv-panel">
                <div className="mv-panel-bar">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="tm-label text-[var(--text-tertiary)] truncate">
                      Dispatch tracker
                    </span>
                    {finalized && (
                      <span className="tm-label text-[var(--text-secondary)] shrink-0">
                        Finalized
                      </span>
                    )}
                  </span>
                  <ConnBadge conn={conn} />
                </div>
                <div className="mv-panel-body">
                  <div className="mv-counts" aria-live="polite">
                    <Count
                      n={counts.submitted}
                      label="Submitted"
                      className="text-[var(--tier-haiku)]"
                      title={SUBMITTED_TOOLTIP}
                    />
                    <Count n={counts.action} label="Need you" className="text-[var(--amber)]" />
                    <Count n={counts.failed} label="Failed" className="text-[var(--red)]" />
                    <Count n={counts.working} label="Working" className="text-[var(--ink-300)]" />
                    {counts.done > 0 && (
                      <Count n={counts.done} label="Done" className="text-[var(--mint)]" />
                    )}
                  </div>
                  <div
                    className="mv-bar"
                    role="img"
                    aria-label={`${counts.done} done, ${counts.submitted} submitted, ${counts.action} need you, ${counts.failed} failed, ${counts.working} working — ${counts.total} tasks total`}
                  >
                    {counts.done > 0 && (
                      <span style={{ flexGrow: counts.done }} className="bg-[var(--mint)]" />
                    )}
                    {counts.submitted > 0 && (
                      <span style={{ flexGrow: counts.submitted }} className="bg-[var(--tier-haiku)]" />
                    )}
                    {counts.action > 0 && (
                      <span style={{ flexGrow: counts.action }} className="bg-[var(--amber)]" />
                    )}
                    {counts.failed > 0 && (
                      <span style={{ flexGrow: counts.failed }} className="bg-[var(--red)]" />
                    )}
                    {counts.working > 0 && (
                      <span
                        style={{ flexGrow: counts.working }}
                        className="bg-[rgba(255,255,255,0.18)]"
                      />
                    )}
                  </div>
                  <p className="mv-honest">
                    Submitted means the provider accepted the request — the underlying service
                    change is not confirmed complete.
                  </p>
                </div>
              </div>
            </section>

            {/* ── Quote comparison ───────────────────────────────────── */}
            {quotedReplies.length >= 2 && (
              <section aria-labelledby="mv-quotes-heading" className="mt-10">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="mv-quotes-heading" className="kicker">Quotes</h2>
                  <span className="tm-label text-[var(--text-quaternary)] shrink-0">
                    {quotedReplies.length} to compare
                  </span>
                </div>
                <div className="mv-quote-panel">
                  <ul className="mv-quote-list">
                    {quotedReplies.map((reply, index) => (
                      <QuoteRow
                        key={`${reply.fromDomain}-${reply.receivedAt ?? index}`}
                        reply={reply}
                        lowest={index === 0}
                      />
                    ))}
                  </ul>
                  <p className="mv-quote-foot">
                    You choose — Relocate never books or signs anything without you.
                  </p>
                </div>
              </section>
            )}

            {/* ── Replies ────────────────────────────────────────────── */}
            {snapshot.replies.length > 0 && (
              <section aria-labelledby="mv-replies-heading" className="mt-10">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="mv-replies-heading" className="kicker">Replies</h2>
                  <span className="tm-label text-[var(--tier-haiku)] shrink-0">
                    {snapshot.replies.length} received
                  </span>
                </div>
                <ul className="mv-list">
                  {snapshot.replies.map((reply, index) => {
                    const agentName = moveAgentName(reply.agentId);
                    return (
                      <li
                        key={`${reply.fromDomain}-${reply.receivedAt ?? index}`}
                        className="mv-row"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="h-[5px] w-[5px] rounded-full bg-[var(--tier-haiku)] shrink-0"
                            aria-hidden="true"
                          />
                          <h3 className="font-display text-[14px] leading-none text-[var(--ink-100)] truncate">
                            {reply.fromDomain || "unknown sender"}
                          </h3>
                          {agentName && (
                            <span className="tm-label text-[var(--ink-700)] hidden sm:inline shrink-0">
                              RE: {agentName}
                            </span>
                          )}
                          <span className="tm-label text-[var(--ink-700)] ml-auto shrink-0">
                            {reply.receivedAt
                              ? new Date(reply.receivedAt * 1000).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : ""}
                          </span>
                        </div>
                        <p className="mv-row-line">{replyLine(reply.quote)}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* ── What you still own ─────────────────────────────────── */}
            <section aria-labelledby="mv-own-heading" className="mt-10">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="mv-own-heading" className="kicker">What you still own</h2>
                {ownTasks.length > 0 && (
                  <span className="tm-label text-[var(--amber)] shrink-0">
                    {ownTasks.length} waiting
                  </span>
                )}
              </div>
              {ownTasks.length === 0 ? (
                <p className="mv-empty">Nothing needs you right now.</p>
              ) : (
                <ul className="mv-own-list">
                  {ownTasks.map((task) => (
                    <li key={task.agentId} className="mv-own-row">
                      <span className="mv-own-box" aria-hidden="true" />
                      <div className="min-w-0">
                        <span className="font-display text-[13px] leading-none text-[var(--amber)]">
                          {task.name}
                        </span>
                        <p>{task.line}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Task list ──────────────────────────────────────────── */}
            <section aria-labelledby="mv-tasks-heading" className="mt-10">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="mv-tasks-heading" className="kicker">Task list</h2>
                <span className="tm-label text-[var(--text-quaternary)] shrink-0">
                  {tasks.length} specialist{tasks.length === 1 ? "" : "s"}
                </span>
              </div>
              {tasks.length === 0 ? (
                <p className="mv-empty">
                  Specialists are being briefed — rows appear here as the swarm fans out.
                </p>
              ) : (
                <ul className="mv-list">
                  {tasks.map((task) => (
                    <TaskRow key={task.agentId} task={task} />
                  ))}
                </ul>
              )}
            </section>
          </>
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

/** LIVE / OFFLINE connection badge for the public event feed. */
function ConnBadge({ conn }: { conn: Conn }) {
  const meta =
    conn === "live"
      ? { label: "Live", text: "text-[var(--brand)]", dot: "bg-[var(--brand)]" }
      : conn === "connecting"
        ? { label: "Linking", text: "text-[var(--text-tertiary)]", dot: "bg-[var(--text-tertiary)]" }
        : { label: "Offline", text: "text-[var(--text-tertiary)]", dot: "bg-[var(--text-tertiary)]" };
  return (
    <span className={`tm-label flex items-center gap-1.5 shrink-0 ${meta.text}`} role="status">
      <span className={`h-[5px] w-[5px] rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function Count({
  n,
  label,
  className,
  title,
}: {
  n: number;
  label: string;
  className: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0" title={title}>
      <span className={`mv-count-num ${className}`}>{n}</span>
      <span className="tm-label text-[var(--text-tertiary)]">{label}</span>
    </div>
  );
}

function TaskRow({ task }: { task: MoveTaskView }) {
  const meta = STATE_META[task.state] ?? STATE_META.dispatched;
  const mod =
    task.state === "needs-user-action"
      ? "mv-row--action"
      : task.state === "failed" || task.state === "error"
        ? "mv-row--failed"
        : task.state === "in-progress" || task.state === "calling"
          ? "mv-row--live"
          : "";
  return (
    <li className={`mv-row ${mod}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <AgentGlyph agentId={task.agentId} className="mv-glyph" />
        <h3 className="font-display text-[14px] leading-none text-[var(--ink-100)] truncate">
          {task.name}
        </h3>
        <span className="tm-label text-[var(--ink-700)] hidden sm:inline truncate">
          {task.category}
        </span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span
            className={`h-[5px] w-[5px] rounded-full ${meta.dot} ${meta.pulse ? "live-dot" : ""}`}
            aria-hidden="true"
          />
          <span
            className={`tm-label tracking-[0.06em] ${meta.text}`}
            aria-label={`${task.name} status: ${meta.label.toLowerCase()}`}
          >
            {meta.label}
          </span>
        </span>
      </div>
      <p className="mv-row-line">{task.line}</p>
    </li>
  );
}

/** One quote in the comparison panel — cheapest-first ordering happens upstream. */
function QuoteRow({
  reply,
  lowest,
}: {
  reply: MoveReply & { quote: MoveReplyQuote };
  lowest: boolean;
}) {
  return (
    <li className="mv-quote-row">
      <div className="flex items-center gap-2.5 min-w-0">
        <h3 className="font-display text-[14px] leading-none text-[var(--ink-100)] truncate">
          {reply.fromDomain || "unknown sender"}
        </h3>
        {lowest && <span className="tm-label text-[var(--mint)] shrink-0">Lowest</span>}
        <span className="mv-quote-total ml-auto shrink-0">{reply.quote.totalDisplay}</span>
      </div>
      {(reply.quote.depositDisplay !== null || reply.quote.availability) && (
        <p className="mv-quote-meta">
          {reply.quote.depositDisplay !== null && (
            <span>deposit {reply.quote.depositDisplay}</span>
          )}
          {reply.quote.availability && (
            <span className="flex items-center gap-1.5 text-[var(--mint)]">
              {/* Drawn tick — same rationale as the route arrow (webfont coverage). */}
              <svg className="h-[8px] w-[10px]" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                <path d="M1 4.5L3.5 7 9 1" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              availability confirmed
            </span>
          )}
        </p>
      )}
    </li>
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

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your move…</span>
      <div className="mv-skel h-3 w-36" aria-hidden="true" />
      <div className="mv-skel mt-6 h-12 w-4/5 max-w-[440px]" aria-hidden="true" />
      <div className="mv-skel mt-5 h-4 w-2/3 max-w-[380px]" aria-hidden="true" />
      <div className="mv-skel mt-10 h-32 w-full" aria-hidden="true" />
      <div className="mt-10 flex flex-col gap-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mv-skel h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
