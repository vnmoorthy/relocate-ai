"use client";

/**
 * Local live-demo WebSocket token handoff.
 *
 * The orchestrator's /ws/dashboard requires DASHBOARD_API_TOKEN. Browsers
 * cannot set an Authorization header on a WebSocket, and a query-string token
 * leaks into access logs — so the token rides in the Sec-WebSocket-Protocol
 * offer instead (see useDashboardWS). It reaches the page via the URL hash
 * (never sent to any server): run.sh prints
 *   http://127.0.0.1:3000/#ws-token=<token>
 * On load we stash the token in sessionStorage and strip it from the URL so
 * it survives reloads within the tab but is never bookmarked or shared.
 *
 * This is a local-development convenience only. A production dashboard needs
 * short-lived, user- and move-scoped credentials issued after authentication —
 * a long-lived token must never ship inside a public static build.
 */

const STORAGE_KEY = "relocate-ws-token";
const HASH_PATTERN = /(?:^#|&)ws-token=([^&]+)/;
// RFC 6455 subprotocol names use the HTTP token charset; this safe subset
// covers hex tokens (the documented `openssl rand -hex 32` format). Passing a
// token with other characters (e.g. base64's +/=) into the WebSocket
// constructor throws a SyntaxError on every connect attempt, silently locking
// the dashboard in replay mode — so refuse it loudly instead.
const SUBPROTOCOL_SAFE = /^[A-Za-z0-9._~-]+$/;
let warnedUnsafeToken = false;

function acceptToken(token: string): string {
  if (!token) return "";
  if (SUBPROTOCOL_SAFE.test(token)) return token;
  if (!warnedUnsafeToken) {
    warnedUnsafeToken = true;
    console.warn(
      "Relocate: DASHBOARD_API_TOKEN contains characters that cannot ride in a " +
        "WebSocket subprotocol; regenerate it with `openssl rand -hex 32`. " +
        "Staying in demo-replay mode.",
    );
  }
  return "";
}

export function resolveWsToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const match = window.location.hash.match(HASH_PATTERN);
    if (match) {
      const token = acceptToken(decodeURIComponent(match[1]));
      if (!token) return "";
      window.sessionStorage.setItem(STORAGE_KEY, token);
      const cleaned = window.location.hash
        .replace(/(?:^#|&)ws-token=[^&]*/, "")
        .replace(/^#&/, "#");
      window.history.replaceState(
        null,
        "",
        window.location.pathname +
          window.location.search +
          (cleaned === "#" ? "" : cleaned),
      );
      return token;
    }
    return acceptToken(window.sessionStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    // Sandboxed contexts can deny sessionStorage/history access; the dashboard
    // then simply stays in demo-replay mode.
    return "";
  }
}
