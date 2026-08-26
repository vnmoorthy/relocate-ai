"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  MoveConnBadge,
  MoveDetail,
  MoveDetailSkeleton,
  type MoveConn,
} from "@/components/MoveDetail";
import { StartMove } from "@/components/StartMove";
import { VoiceConcierge } from "@/components/VoiceConcierge";
import { parseDashboardMessage, reconnectDelay, withJitter } from "@/lib/dashboard-state";
import {
  DEMO_UNREACHABLE_MESSAGE,
  bearerHeaders,
  clearDemoSession,
  demoCountChips,
  demoLoginErrorMessage,
  demoLoginUrl,
  hasAccessKey,
  takeAccessKey,
  demoMovesUrl,
  demoSessionStore,
  isSessionActive,
  loadDemoSession,
  nowSeconds,
  parseDemoLogin,
  parseDemoMoves,
  saveDemoSession,
  sortDemoMoves,
  validateDemoLogin,
  type DemoMoveSummary,
  type DemoSession,
} from "@/lib/demo-auth";
import { discoverLiveApi, publicWsUrl } from "@/lib/live-config";
import {
  cityFromAddress,
  formatMoveDate,
  moveIdFromHash,
  moveSnapshotUrl,
  parseMoveSnapshot,
  shortMoveRef,
  type MoveSnapshot,
} from "@/lib/move-page";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Move list refresh cadence while signed in. */
const MOVES_POLL_MS = 20_000;
/** Discovery keeps probing so a tunnel coming back flips the page to live. */
const REDISCOVERY_MS = 60_000;
const THROTTLE_RETRY_MS = 20_000;
const ERROR_RETRY_MS = 15_000;
/** setTimeout fires immediately past this, so a far-off expiry is not scheduled. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type MovesStatus = "idle" | "loading" | "ready" | "error";

interface MovesView {
  status: MovesStatus;
  items: DemoMoveSummary[];
}

const NO_MOVES: MovesView = { status: "idle", items: [] };

type DetailPhase = "loading" | "ready" | "not-found" | "unavailable" | "retry";

/** Detail state, keyed by the move id it was loaded for (same trick as /move). */
interface DetailView {
  forId: string;
  phase: DetailPhase;
  snapshot: MoveSnapshot | null;
  overlay: Record<string, { state: string }>;
  finalizedLive: boolean;
  retryReason: "throttled" | "error" | null;
}

function emptyDetail(forId: string): DetailView {
  return {
    forId,
    phase: "loading",
    snapshot: null,
    overlay: {},
    finalizedLive: false,
    retryReason: null,
  };
}

/**
 * The Relocate product surface: a login-gated workspace at /app.
 *
 * It is a *shared* demo workspace, not per-user auth — the deployment
 * publishes one set of credentials and everyone who signs in sees the same
 * moves. The page says exactly that under the form rather than dressing it up
 * as an account.
 *
 * Data flow mirrors /move: discovery (live.json) → REST for state, the
 * token-less public WS for live deltas. The demo token only ever rides in an
 * Authorization header (the workspace list) or in the intake payload (so a new
 * move joins this workspace); the move snapshot and the feed stay public.
 */
export default function WorkspacePage() {
  // ── Session ─────────────────────────────────────────────────────────────
  const [session, setSession] = useState<DemoSession | null>(null);
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const token = session?.token ?? "";

  // ── Backend discovery ───────────────────────────────────────────────────
  const [api, setApi] = useState<string | null>(null);
  const [apiSettled, setApiSettled] = useState(false);

  // ── Workspace ───────────────────────────────────────────────────────────
  const [moves, setMoves] = useState<MovesView>(NO_MOVES);
  const [movesNonce, setMovesNonce] = useState(0);
  // Bumped when the unlock card is accepted so the detail pane re-reads.
  const [detailNonce, setDetailNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [conn, setConn] = useState<MoveConn>("connecting");

  const paneRef = useRef<HTMLElement | null>(null);
  // Read by the socket handler, which outlives any single selection.
  const publicRefRef = useRef("");
  const reloadDetailRef = useRef<() => void>(() => {});

  // Restore a stored session; an expired one reads as signed out. Reading
  // sessionStorage has to wait for the client — a static export prerenders
  // with no storage at all, so a lazy initializer would hydrate wrong.
  useEffect(() => {
    const restore = () => {
      setSession(loadDemoSession(demoSessionStore(), nowSeconds()));
      setRestored(true);
    };
    restore();
  }, []);

  // The selected move rides in the hash (/app/#mkt_… — same convention as
  // /move), so a deep link survives static hosting and a reload.
  useEffect(() => {
    const read = () => setSelectedId(moveIdFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const attempt = () => {
      void discoverLiveApi().then((found) => {
        if (cancelled) return;
        setApi(found);
        setApiSettled(true);
        if (!found) retryTimer = window.setTimeout(attempt, REDISCOVERY_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  const signOut = useCallback((why: string | null) => {
    clearDemoSession(demoSessionStore());
    setSession(null);
    setMoves(NO_MOVES);
    setDetail(null);
    setConn("connecting");
    publicRefRef.current = "";
    setNotice(why);
  }, []);

  // The server states an expiry; honour it here instead of waiting for the
  // next 401. Far-future expiries are left to the load-time check.
  useEffect(() => {
    if (!session) return;
    const delayMs = (session.expiresAt - nowSeconds()) * 1000;
    if (delayMs > MAX_TIMEOUT_MS) return;
    const timer = window.setTimeout(
      () => signOut("That demo session expired. Sign in again to pick up where you left off."),
      Math.max(0, delayMs),
    );
    return () => window.clearTimeout(timer);
  }, [session, signOut]);

  // ── Workspace move list ─────────────────────────────────────────────────
  useEffect(() => {
    if (!api || !token) return;
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      let keepPolling = true;
      setMoves((prev) => (prev.status === "ready" ? prev : { ...prev, status: "loading" }));
      try {
        const res = await fetch(demoMovesUrl(api), {
          cache: "no-store",
          headers: bearerHeaders(token),
        });
        if (cancelled) return;
        if (res.status === 401) {
          // The token is gone or expired — stop polling and hand the reader
          // the login form with a reason.
          keepPolling = false;
          signOut("That demo session expired. Sign in again to pick up where you left off.");
          return;
        }
        if (!res.ok) throw new Error(`moves http ${res.status}`);
        const items = sortDemoMoves(parseDemoMoves(await res.json()));
        if (cancelled) return;
        setMoves({ status: "ready", items });
      } catch {
        if (!cancelled) setMoves((prev) => ({ status: "error", items: prev.items }));
      } finally {
        if (!cancelled && keepPolling) timer = window.setTimeout(() => void load(), MOVES_POLL_MS);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, token, movesNonce, signOut]);

  // ── Move snapshot ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!api || !selectedId) {
      publicRefRef.current = "";
      return;
    }
    const moveId = selectedId;
    let cancelled = false;
    let retryTimer: number | undefined;

    const patch = (mutate: (current: DetailView) => DetailView) => {
      setDetail((prev) => mutate(prev && prev.forId === moveId ? prev : emptyDetail(moveId)));
    };

    const load = async (silent: boolean) => {
      try {
        const res = await fetch(moveSnapshotUrl(api, moveId), { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          patch((v) => ({ ...v, phase: "not-found" }));
          return;
        }
        if (res.status === 503) {
          patch((v) => ({ ...v, phase: "unavailable" }));
          return;
        }
        if (res.status === 429) {
          if (!silent) patch((v) => ({ ...v, phase: "retry", retryReason: "throttled" }));
          retryTimer = window.setTimeout(() => void load(true), THROTTLE_RETRY_MS);
          return;
        }
        if (!res.ok) throw new Error(`snapshot http ${res.status}`);
        const snapshot = parseMoveSnapshot(await res.json());
        if (cancelled) return;
        if (!snapshot) throw new Error("snapshot payload malformed");
        publicRefRef.current = snapshot.public_ref;
        // A fresh snapshot is authoritative; live events re-apply on top.
        patch((v) => ({ ...v, phase: "ready", snapshot, overlay: {}, retryReason: null }));
      } catch {
        if (cancelled) return;
        if (!silent) patch((v) => ({ ...v, phase: "retry", retryReason: "error" }));
        retryTimer = window.setTimeout(() => void load(true), ERROR_RETRY_MS);
      }
    };

    reloadDetailRef.current = () => void load(true);
    void load(false);

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      reloadDetailRef.current = () => {};
      publicRefRef.current = "";
    };
  }, [api, selectedId, detailNonce]);

  // ── Public live feed ────────────────────────────────────────────────────
  // One socket for the whole session; events are matched against the selected
  // move's public alias (the feed never carries the real move id).
  useEffect(() => {
    if (!api || !token) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let everOpened = false;

    const scheduleReconnect = () => {
      if (cancelled) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, withJitter(reconnectDelay(reconnectAttempt)));
      reconnectAttempt += 1;
    };

    const patchDetail = (mutate: (current: DetailView) => DetailView) => {
      setDetail((prev) => (prev ? mutate(prev) : prev));
    };

    function connect() {
      if (cancelled || socket) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(publicWsUrl(api as string));
      } catch {
        setConn("offline");
        scheduleReconnect();
        return;
      }
      socket = ws;
      // "Linking" only until the feed has been up once; after a drop the badge
      // stays honest at "Offline" while it retries.
      if (!everOpened) setConn("connecting");

      ws.onopen = () => {
        if (cancelled || socket !== ws) return;
        reconnectAttempt = 0;
        setConn("live");
        // Events were missed while the socket was down — resync from REST.
        if (everOpened) {
          reloadDetailRef.current();
          setMovesNonce((n) => n + 1);
        }
        everOpened = true;
      };
      ws.onmessage = (message) => {
        if (cancelled || socket !== ws) return;
        const event = parseDashboardMessage(message.data);
        const publicRef = publicRefRef.current;
        if (!event || !publicRef || event.event_id !== publicRef) return;
        if (event.type === "agent_state") {
          patchDetail((v) => ({
            ...v,
            overlay: { ...v.overlay, [event.agent_id]: { state: event.state } },
          }));
        } else if (event.type === "event_finalized") {
          patchDetail((v) => ({ ...v, finalizedLive: true }));
        } else if (event.type === "reply_received") {
          // Replies live in the snapshot (server-side dedupe + redaction);
          // a silent refetch keeps this page from double-counting.
          reloadDetailRef.current();
        }
      };
      ws.onclose = () => {
        if (cancelled || socket !== ws) return;
        socket = null;
        setConn("offline");
        scheduleReconnect();
      };
      ws.onerror = () => {
        // onclose owns retry + badge transitions.
      };
    }

    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    };
  }, [api, token]);

  // ── Navigation ──────────────────────────────────────────────────────────
  const revealPane = useCallback(() => {
    // On one column the pane sits below the list; on two it is already in view.
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    paneRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, []);

  const openMove = useCallback(
    (eventId: string) => {
      setSelectedId(eventId);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${encodeURIComponent(eventId)}`,
      );
      revealPane();
    },
    [revealPane],
  );

  const openNewMove = useCallback(() => {
    setSelectedId(null);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    revealPane();
  }, [revealPane]);

  const onMoveStarted = useCallback(
    (eventId: string) => {
      setMovesNonce((n) => n + 1);
      openMove(eventId);
    },
    [openMove],
  );

  const headerConn: MoveConn = api ? conn : apiSettled ? "offline" : "connecting";
  const view = detail && detail.forId === selectedId ? detail : null;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className="site-nav site-nav--scrolled">
        <nav
          aria-label="Primary"
          className="w-full max-w-[1180px] mx-auto px-5 sm:px-8 flex items-center justify-between gap-3 sm:gap-4"
        >
          <a href={`${BASE_PATH}/`} className="nav-wordmark">Relocate</a>
          <div className="flex items-center gap-3 sm:gap-5">
            <span className="tm-label text-[var(--text-quaternary)] hidden sm:inline">
              Demo workspace
            </span>
            {session && <MoveConnBadge conn={headerConn} />}
            {session && (
              <button
                type="button"
                className="wk-signout"
                onClick={() => signOut("Signed out. The workspace itself is untouched.")}
              >
                Sign out
              </button>
            )}
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        className="flex-1 w-full max-w-[1180px] mx-auto px-5 sm:px-8 pt-[calc(var(--nav-h)+2.5rem)] pb-20"
      >
        {!restored ? (
          <p className="sr-only" aria-live="polite">Checking for a saved session…</p>
        ) : !session ? (
          <LoginWall
            api={api}
            apiSettled={apiSettled}
            notice={notice}
            onSignedIn={(next) => {
              setNotice(null);
              setSession(next);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-10 lg:gap-14">
            {/* ── Rail: the workspace's moves ─────────────────────────── */}
            <aside className="min-w-0 lg:sticky lg:top-[calc(var(--nav-h)+2.5rem)] lg:self-start">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="kicker">Your moves</h2>
                {moves.items.length > 0 && (
                  <span className="tm-label text-[var(--text-quaternary)] shrink-0">
                    {moves.items.length}
                  </span>
                )}
              </div>

              {moves.items.length === 0 ? (
                <p className="mv-empty">
                  {moves.status === "loading"
                    ? "Loading this workspace…"
                    : moves.status === "error"
                      ? "Couldn't load the move list just now — retrying automatically."
                      : "No moves in this workspace yet. Start the first one — it appears here as soon as the dispatcher accepts it."}
                </p>
              ) : (
                <ul className="wk-moves">
                  {moves.items.map((move) => (
                    <li key={move.eventId}>
                      <MoveRow
                        move={move}
                        active={move.eventId === selectedId}
                        onOpen={() => openMove(move.eventId)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {moves.status === "error" && moves.items.length > 0 && (
                <p className="wk-rail-note" role="status">
                  Couldn&rsquo;t refresh the list just now — showing the last load, retrying.
                </p>
              )}

              {selectedId && (
                <button type="button" className="btn-outline w-full mt-4" onClick={openNewMove}>
                  Start a move
                </button>
              )}
            </aside>

            {/* ── Pane: one move, or the intake form ──────────────────── */}
            <section
              ref={paneRef}
              aria-label={selectedId ? "Move detail" : "Start a move"}
              className="min-w-0 scroll-mt-[calc(var(--nav-h)+1rem)]"
            >
              {!api ? (
                <PaneNotice
                  title={<>Backend<br />unreachable</>}
                  body={
                    apiSettled
                      ? "This page can't reach the Relocate backend right now. You're still signed in — it keeps retrying, and the workspace comes back on its own."
                      : "Looking for the Relocate backend…"
                  }
                />
              ) : !selectedId ? (
                <>
                  <p className="kicker mb-4">Start a move</p>
                  <h1 className="display-sub">New dispatch</h1>
                  <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
                    Brief the concierge once — out loud. Up to 28 specialists fan
                    out, each one reporting a real terminal state, and everything
                    they can&rsquo;t finish comes back to you as a task you own.
                  </p>
                  <div className="mt-8 max-w-[640px]">
                    <VoiceConcierge
                      api={api}
                      demoToken={token}
                      onDispatched={onMoveStarted}
                    />
                  </div>
                  <details className="mt-10 max-w-[640px] vc-fallback">
                    <summary className="tm-label text-[var(--text-tertiary)] cursor-pointer">
                      Prefer a form?
                    </summary>
                    <div className="mt-6">
                      <StartMove
                        api={api}
                        demoToken={token}
                        onStarted={onMoveStarted}
                        lead="Same dispatch, typed instead of spoken. The move joins this workspace and opens as soon as the dispatcher accepts it."
                      />
                    </div>
                  </details>
                </>
              ) : view === null || view.phase === "loading" ? (
                <MoveDetailSkeleton />
              ) : view.phase === "ready" && view.snapshot ? (
                <MoveDetail
                  snapshot={view.snapshot}
                  overlay={view.overlay}
                  conn={headerConn}
                  finalizedLive={view.finalizedLive}
                  api={api}
                  onUnlocked={() => setDetailNonce((n) => n + 1)}
                />
              ) : view.phase === "not-found" ? (
                <PaneNotice
                  title={<>We can&rsquo;t find<br />that move</>}
                  body="That reference doesn't match any move on this deployment. Pick one from your moves, or start a new dispatch."
                  onBack={openNewMove}
                />
              ) : view.phase === "unavailable" ? (
                <PaneNotice
                  title={<>Tracking is<br />offline</>}
                  body="This deployment isn't serving move pages right now."
                  onBack={openNewMove}
                />
              ) : (
                <PaneNotice
                  title={<>One<br />moment</>}
                  body={
                    view.retryReason === "throttled"
                      ? "Too many refreshes from this connection — we'll retry automatically in a few seconds."
                      : "The tracker couldn't load this move just now — retrying automatically."
                  }
                />
              )}
            </section>
          </div>
        )}
      </main>

      <footer className="w-full border-t border-[var(--border-subtle)] mt-auto">
        <div className="max-w-[1180px] mx-auto px-5 sm:px-8 py-10 flex flex-wrap items-center justify-between gap-4">
          <a href={`${BASE_PATH}/`} className="footer-link">Relocate</a>
          <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--text-quaternary)]">
            Shared demo workspace · honest states
          </span>
        </div>
      </footer>
    </>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────

/**
 * The login wall. The password is never in this bundle — it is posted to the
 * backend, which is the only thing that can verify it.
 */
function LoginWall({
  api,
  apiSettled,
  notice,
  onSignedIn,
}: {
  api: string | null;
  apiSettled: boolean;
  notice: string | null;
  onSignedIn: (session: DemoSession) => void;
}) {
  const uid = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An access link (…/app/?k=KEY) signs a reviewer in without the password
  // ever appearing on a public page. Redeemed once, then stripped from the
  // URL and from history so it does not linger in a shared screen or a
  // back-button trail.
  const [redeeming, setRedeeming] = useState(() => hasAccessKey());

  useEffect(() => {
    if (!api) return;
    const key = takeAccessKey();
    // No key means `redeeming` was never set, so there is nothing to clear.
    if (!key) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(demoLoginUrl(api), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ access_key: key }),
        });
        const body = await readJson(res);
        if (cancelled) return;
        if (res.ok) {
          const next = parseDemoLogin(body);
          if (next && isSessionActive(next, nowSeconds())) {
            saveDemoSession(demoSessionStore(), next);
            onSignedIn(next);
            return;
          }
        }
        setError("That access link isn't valid any more. Ask for a new one, or sign in below.");
      } catch {
        if (!cancelled) setError(DEMO_UNREACHABLE_MESSAGE);
      } finally {
        if (!cancelled) setRedeeming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, onSignedIn]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const invalid = validateDemoLogin(username, password);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!api) {
      setError(apiSettled ? DEMO_UNREACHABLE_MESSAGE : "Still looking for the backend — try again in a second.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(demoLoginUrl(api), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await readJson(res);
      if (res.ok) {
        const next = parseDemoLogin(body);
        if (!next || !isSessionActive(next, nowSeconds())) {
          setError("The backend accepted the sign-in but didn't return a usable session. Try again in a moment.");
          return;
        }
        saveDemoSession(demoSessionStore(), next);
        setPassword("");
        onSignedIn(next);
        return;
      }
      setError(demoLoginErrorMessage(res.status, body));
    } catch {
      setError(DEMO_UNREACHABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  if (redeeming) {
    return (
      <div className="max-w-[460px] mx-auto" aria-busy="true">
        <p className="kicker mb-4">Demo workspace</p>
        <h1 className="display-sub">Opening<br />your workspace</h1>
        <p className="mt-5 text-[15px] leading-[1.65] text-[var(--text-secondary)]">
          Signing you in from your access link…
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[460px] mx-auto">
      <p className="kicker mb-4">Demo workspace</p>
      <h1 className="display-sub">Sign in</h1>
      <p className="mt-5 text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        The live product surface: start a real dispatch and follow every
        specialist&rsquo;s honest terminal state.
      </p>

      {notice && (
        <p className="wk-banner mt-6" role="status">
          {notice}
        </p>
      )}

      <form className="wk-card mt-6" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-5">
          <div className="sm-field">
            <label htmlFor={`${uid}-user`} className="sm-label">Username</label>
            <input
              id={`${uid}-user`}
              name="username"
              type="text"
              className="sm-input"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="sm-field">
            <label htmlFor={`${uid}-pass`} className="sm-label">Password</label>
            <input
              id={`${uid}-pass`}
              name="password"
              type="password"
              className="sm-input"
              autoComplete="current-password"
              // Without these a phone keyboard capitalises the first letter
              // and the sign-in fails on a credential the user typed
              // correctly. The username field already carries them.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-error` : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn-solid w-full mt-7"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

        <p
          id={`${uid}-error`}
          className={`sm-status ${error ? "sm-status--error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {pending ? "Checking with the backend…" : error}
        </p>

        {apiSettled && !api && !error && (
          <p className="sm-status sm-status--error">{DEMO_UNREACHABLE_MESSAGE}</p>
        )}

        <p className="wk-disclosure">
          A shared review workspace, not per-user authentication: everyone
          who signs in lands in the same one and sees the same moves. Treat
          anything you start here as visible to other reviewers. Access is by
          invitation — if you don&rsquo;t have credentials or an access link,
          ask for one.
        </p>
      </form>

      <a href={`${BASE_PATH}/`} className="arrow-link mt-8">Back to Relocate →</a>
    </div>
  );
}

// ── Rail row ──────────────────────────────────────────────────────────────

function MoveRow({
  move,
  active,
  onOpen,
}: {
  move: DemoMoveSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const chips = demoCountChips(move.counts);
  return (
    <button
      type="button"
      className={`wk-move ${active ? "wk-move--active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={onOpen}
    >
      <span className="wk-move-route">
        <span className="truncate">
          {cityFromAddress(move.route.originAddress) || "Origin"}
        </span>
        {/* Drawn arrow — same rationale as the tracker's route separator. */}
        <svg className="wk-move-arrow" viewBox="0 0 32 16" fill="none" aria-hidden="true">
          <path d="M0 8h29M23 1.5l7 6.5-7 6.5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <span className="sr-only">to</span>
        <span className="truncate">
          {cityFromAddress(move.route.destinationAddress) || "Destination"}
        </span>
      </span>
      <span className="wk-move-meta">
        <span>{move.route.moveDate ? formatMoveDate(move.route.moveDate) : "No date"}</span>
        <span className="text-[var(--text-quaternary)]">{shortMoveRef(move.eventId)}</span>
        {move.finalized && <span className="text-[var(--text-secondary)]">Finalized</span>}
      </span>
      <span className="wk-move-counts">
        {chips.map((chip) => (
          <span key={chip.key} className="wk-count">
            <span className="wk-count-n" style={{ color: chip.color }}>{chip.value}</span>
            {chip.label}
          </span>
        ))}
        <span className="wk-count">
          <span className="wk-count-n text-[var(--text-secondary)]">{move.counts.total}</span>
          Task{move.counts.total === 1 ? "" : "s"}
        </span>
      </span>
    </button>
  );
}

function PaneNotice({
  title,
  body,
  onBack,
}: {
  title: React.ReactNode;
  body: string;
  onBack?: () => void;
}) {
  return (
    <div>
      <p className="kicker mb-4">Workspace</p>
      <h1 className="display-sub">{title}</h1>
      <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        {body}
      </p>
      {onBack && (
        <button type="button" className="btn-outline mt-8" onClick={onBack}>
          Start a move
        </button>
      )}
    </div>
  );
}

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}
