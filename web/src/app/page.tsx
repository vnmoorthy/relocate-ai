"use client";

import { useCallback, useEffect, useState } from "react";
import { ArtifactsPanel } from "@/components/ArtifactsPanel";
import { BackgroundVideo } from "@/components/BackgroundVideo";
import { CostTicker } from "@/components/CostTicker";
import { FieldsCollectedStrip } from "@/components/FieldsCollectedStrip";
import { PAVOFlow } from "@/components/PAVOFlow";
import { SponsorRow } from "@/components/SponsorRow";
import { StartMove } from "@/components/StartMove";
import { SwarmStage } from "@/components/SwarmStage";
import { discoverLiveApi, publicWsUrl } from "@/lib/live-config";
import { isPlaceholderWsUrl, useDashboardWS } from "@/lib/ws-client";
import { resolveWsToken } from "@/lib/ws-token";
import type { DashboardConnection } from "@/lib/dashboard-state";
import { ALL_AGENTS } from "@/lib/types";

// Build-time socket: the authenticated /ws/dashboard for local runs (run.sh
// hands the token over in the URL hash). Public builds set it to "" so the
// page opens in the labeled simulation until discovery finds a live backend.
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/dashboard";

const REPO_URL = "https://github.com/vnmoorthy/relocate-ai";

// The live concierge demo line (AgentPhone). Served by the operator's
// supervised deployment — see demo-line.sh.
// The concierge number is provisioned per deployment. It was released by the
// carrier, so the site must not advertise a line that cannot be reached:
// flip PHONE_LIVE back to true (with the new number) the moment one is
// attached to the buyer agent, and every CTA below returns on its own.
const PHONE_LIVE = false;
const PHONE_E164 = "+16184149537";
const PHONE_DISPLAY = "+1 (618) 414-9537";


interface LiveLink {
  /** Discovered live API origin (see lib/live-config.ts); null = simulation. */
  api: string | null;
  /** The local token handoff (#ws-token=…) keeps the authenticated socket. */
  localFlow: boolean;
  /** True once the first discovery attempt has resolved either way. */
  settled: boolean;
}

const NO_LIVE_LINK: LiveLink = { api: null, localFlow: false, settled: false };

// While discovery is failing, retry on this cadence so a tunnel coming back
// flips the page to live without a manual reload.
const REDISCOVERY_MS = 60_000;

export default function Page() {
  const [live, setLive] = useState<LiveLink>(NO_LIVE_LINK);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    // resolveWsToken() stashes a hash token in sessionStorage and strips it
    // from the URL; ws-client re-reads the stash on every connect attempt.
    const localFlow = resolveWsToken() !== "" && !isPlaceholderWsUrl(WS_URL);
    const attempt = () => {
      void discoverLiveApi().then((api) => {
        if (cancelled) return;
        setLive({ api, localFlow, settled: true });
        // Simulation is a fallback, not a verdict: keep probing so the page
        // goes live the moment the backend is reachable again.
        if (!api) retryTimer = window.setTimeout(attempt, REDISCOVERY_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, []);

  // Socket priority: (a) local token flow against the bundled WS_URL,
  // (b) discovered public feed (token-less — ws-client only offers the
  // bearer subprotocol when a token exists), (c) the bundled default, which
  // on public builds is "" → simulation. Until discovery settles, (c) holds.
  const liveApi = live.api;
  const wsUrl = live.localFlow ? WS_URL : liveApi ? publicWsUrl(liveApi) : WS_URL;
  const s = useDashboardWS(wsUrl);

  const onMoveStarted = useCallback(() => {
    const target =
      document.getElementById("dashboard-stage") ?? document.getElementById("dashboard");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const dispatchedCount = Object.keys(s.agentStates).filter((id) => id !== "buyer").length;
  const submittedCount =
    typeof s.finalSummary?.submitted_count === "number" ? s.finalSummary.submitted_count : 0;
  const failedCount =
    typeof s.finalSummary?.failed_count === "number" ? s.finalSummary.failed_count : 0;

  const terminalCounts = Object.values(s.agentStates).reduce(
    (counts, agent) => {
      if (agent.state === "submitted") counts.submitted += 1;
      if (agent.state === "needs-user-action") counts.action += 1;
      if (agent.state === "failed" || agent.state === "error") counts.failed += 1;
      return counts;
    },
    { submitted: 0, action: 0, failed: 0 },
  );

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className={`site-nav ${scrolled ? "site-nav--scrolled" : ""}`}>
        <nav
          aria-label="Primary"
          className="w-full max-w-[1500px] mx-auto px-5 sm:px-10 flex items-center justify-between gap-4"
        >
          <a href="#main-content" className="nav-wordmark">Relocate</a>
          <div className="flex items-center gap-5 sm:gap-8">
            <a href="#dashboard" className="nav-link">Swarm</a>
            <a href="#system" className="nav-link hidden sm:inline">System</a>
            <a href="#router" className="nav-link hidden sm:inline">Router</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="nav-link">GitHub</a>
          </div>
        </nav>
      </header>

      <main id="main-content">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-title" className="hero flex flex-col">
        <BackgroundVideo
          src="/videos/hero-city-dusk.mp4"
          poster="/videos/hero-city-dusk-poster.jpg"
        />
        <div className="hero-vignette" aria-hidden="true" />
        <div className="hero-text-scrim" aria-hidden="true" />

        <div className="relative z-[2] flex-1 w-full max-w-[1500px] mx-auto px-5 sm:px-10 flex flex-col justify-end pb-28 sm:pb-32 pt-[calc(var(--nav-h)+2rem)]">
          <p className="kicker mb-5">AI relocation concierge</p>
          <h1 id="hero-title" className="display-headline max-w-[1100px]">
            One call.<br />Relocate.
          </h1>
          <p className="mt-6 max-w-[560px] text-[15px] sm:text-[16px] leading-[1.65] text-[var(--text-secondary)]">
            One brief — by phone or on the web — sets a swarm coordinating your
            entire move: requesting mover quotes, drafting utility shutoffs and
            USPS forwarding, preparing USCIS and DMV forms for your signature.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            {PHONE_LIVE ? (
              <>
                <a href={`tel:${PHONE_E164}`} className="btn-solid">Call {PHONE_DISPLAY}</a>
                <a href={liveApi ? "#start-move" : "#dashboard"} className="btn-outline">
                  {liveApi ? "Start your move" : "Watch the swarm"}
                </a>
              </>
            ) : (
              <>
                <a href={liveApi ? "#start-move" : "#dashboard"} className="btn-solid">
                  {liveApi ? "Start your move" : "Watch the swarm"}
                </a>
                <a href="#dashboard" className="btn-outline">See the swarm</a>
              </>
            )}
          </div>
          <p className="mt-4 text-[12px] tracking-[0.08em] uppercase text-[var(--text-tertiary)]">
            {PHONE_LIVE
              ? "Live concierge demo line · US · talk to the swarm yourself"
              : "Voice line between numbers · start your move on the web"}
          </p>
          {live.settled && !liveApi && !live.localFlow && (
            <p className="mt-2 text-[12px] leading-[1.6] text-[var(--text-quaternary)]">
              Line quiet? Start your move on the web below — same swarm.
            </p>
          )}
        </div>

        <a href="#dashboard" className="scroll-cue" aria-label="Scroll to the swarm">
          <svg width="14" height="8" viewBox="0 0 14 8" fill="none" aria-hidden="true">
            <path d="M1 1l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </section>

      {/* ── 01 · The swarm ───────────────────────────────────────────────── */}
      <section
        id="dashboard"
        aria-labelledby="dashboard-heading"
        className="w-full min-h-[90svh] flex flex-col justify-end border-t border-[var(--border-subtle)] scroll-mt-14"
      >
        <div className="w-full max-w-[1500px] mx-auto px-5 sm:px-10 pt-[14svh] pb-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-end">
            <div className="lg:col-span-7 min-w-0">
              <p className="kicker mb-4">01 · The swarm</p>
              <h2 id="dashboard-heading" className="display-sub max-w-[900px]">
                Seventeen agents.<br />One dispatcher.
              </h2>
              <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
                Watch a full move fan out — utilities, movers, schools, federal
                forms — each specialist reporting a real terminal state.
              </p>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="arrow-link mt-6">It’s open source →</a>
            </div>
            {/* Web intake — a REAL dispatch. Only mounts once discovery has
                confirmed a live backend; the simulation never shows a form. */}
            {liveApi && (
              <div id="start-move" className="lg:col-span-5 min-w-0 scroll-mt-20">
                <p className="kicker mb-4">Start a move · live</p>
                <StartMove api={liveApi} onStarted={onMoveStarted} />
              </div>
            )}
          </div>
        </div>

        <div id="dashboard-stage" className="w-full max-w-[1500px] mx-auto px-3 sm:px-10 pb-16 sm:pb-24 scroll-mt-16">
          {s.waitingForUserAgents.length > 0 && (
            <p
              className="mb-3 border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.06)] px-4 py-3 text-[13px] text-[var(--amber)]"
              role="status"
              aria-live="polite"
            >
              Paused on {s.waitingForUserAgents.length} request{s.waitingForUserAgents.length === 1 ? "" : "s"}: {s.waitingForUserAgents.map(agentDisplayName).join(", ")}.
            </p>
          )}
          {s.finalized && (
            <p
              className="mb-3 border border-[var(--border-strong)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[13px] text-[var(--text-secondary)]"
              role="status"
              aria-live="polite"
            >
              {dispatchedCount} specialist{dispatchedCount === 1 ? "" : "s"} dispatched · {submittedCount} submitted
              {failedCount > 0 ? ` · ${failedCount} failed` : ""}.
            </p>
          )}

          <div className="stage-panel">
            <div className="stage-bar">
              <div className="telemetry" aria-live="polite">
                <span><b>{linkStatus(s.connection)}</b></span>
                {s.eventId && (
                  <span className="hidden sm:inline">
                    {s.routingDecisionCount} dec · {terminalCounts.submitted} sub · {terminalCounts.action} act · {terminalCounts.failed} fail
                  </span>
                )}
              </div>
              <ModeTag connection={s.connection} />
            </div>
            <div className="stage-body">
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 min-h-0 flex">
                  <SwarmStage
                    agentStates={s.agentStates}
                    transcripts={s.transcripts}
                    routingDecisions={s.routingDecisions}
                    totalDecisions={s.routingDecisionCount}
                    tierCounts={s.tierCounts}
                    eventId={s.eventId}
                    connection={s.connection}
                  />
                </div>
                <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
                  <PAVOFlow
                    decisions={s.routingDecisions}
                    totalDecisions={s.routingDecisionCount}
                    tierCounts={s.tierCounts}
                    connection={s.connection}
                  />
                  <ArtifactsPanel sponsorEvents={s.sponsorEvents} connection={s.connection} />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <FieldsCollectedStrip collectedFields={s.collectedFields} />
                <SponsorRow sponsorEvents={s.sponsorEvents} demoMode={s.demoMode} />
                <CostTicker
                  pavoCents={s.pavoCents}
                  baselineCents={s.baselineCents}
                  decisions={s.routingDecisionCount}
                  demoMode={s.demoMode}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 · How it works ────────────────────────────────────────────── */}
      <section
        id="system"
        aria-labelledby="system-heading"
        className="relative overflow-hidden w-full min-h-[90svh] flex flex-col justify-end border-t border-[var(--border-subtle)] scroll-mt-14"
      >
        <BackgroundVideo
          src="/videos/bg-packing.mp4"
          poster="/videos/bg-packing-poster.jpg"
        />
        <div className="section-scrim section-scrim--heavy" aria-hidden="true" />
        <div className="relative z-[2] w-full max-w-[1500px] mx-auto px-5 sm:px-10 pt-[14svh] pb-16 sm:pb-24">
          <p className="kicker mb-4">02 · How it works</p>
          <h2 id="system-heading" className="display-sub max-w-[900px]">
            Dial. Brief.<br />Dispatch.
          </h2>
          <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
            One inbound call becomes a structured dispatch and a parallel fleet
            of specialists. Ninety seconds, end to end.
          </p>

          <div className="mt-14 sm:mt-20 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
            <Stat value="17" label="Agents" />
            <Stat value="3" label="Execution modes" />
            <Stat value="11–16" label="Dispatched per move" />
            <Stat value="0" label="Fabricated successes" />
          </div>

          <div className="mt-16 sm:mt-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
            <TimelineStep n="01" title="Call" body="One number. The concierge answers and asks where you're headed." />
            <TimelineStep n="02" title="Spec" body="A few turns capture origin, destination, date, household — and emit a structured dispatch." />
            <TimelineStep n="03" title="Fan-out" body="Up to 16 specialists launch in parallel across browser, email, and postal rails." />
            <TimelineStep n="04" title="Report" body="Each lands a real terminal state — submitted, needs your signature, or failed." />
          </div>
        </div>
      </section>

      {/* ── 03 · The router ──────────────────────────────────────────────── */}
      <section
        id="router"
        aria-labelledby="router-heading"
        className="relative overflow-hidden w-full min-h-[90svh] flex flex-col justify-end border-t border-[var(--border-subtle)] scroll-mt-14"
      >
        <BackgroundVideo
          src="/videos/bg-routes.mp4"
          poster="/videos/bg-routes-poster.jpg"
        />
        <div className="section-scrim" aria-hidden="true" />
        <div className="relative z-[2] w-full max-w-[1500px] mx-auto px-5 sm:px-10 pt-[14svh] pb-16 sm:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-end">
            <div>
              <p className="kicker mb-4">03 · The router</p>
              <h2 id="router-heading" className="display-sub">
                PAVO routes<br />every turn.
              </h2>
              <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
                A deterministic, inspectable heuristic router in the open repo.
                Cheap turns stay on a local model on Apple Silicon; pricing,
                policy, and signature turns escalate to cloud tiers. If every
                provider fails, the request errors — it never invents a
                response.
              </p>
              <a
                href={`${REPO_URL}/blob/main/ARCHITECTURE.md`}
                target="_blank"
                rel="noreferrer"
                className="arrow-link mt-6"
              >
                Read the architecture →
              </a>
            </div>
            <div>
              <p className="kicker mb-2">Tier dispatch ladder</p>
              <LadderRow
                color="var(--tier-local)"
                title="Gemma 2-2B"
                sub="local · Apple Silicon"
                status="reference route"
              />
              <LadderRow
                color="var(--tier-cloud-mid)"
                title="Gemini Flash 2.5"
                sub="cloud · mid-tier"
                status="optional provider"
              />
              <LadderRow
                color="var(--tier-cloud-hard)"
                title="Claude Opus 4.7"
                sub="cloud · escalation"
                status="optional escalation"
              />
              <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                Dashboard cost figures are estimates from configured prices —
                never an invoice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 · Early access ────────────────────────────────────────────── */}
      <section
        id="access"
        aria-labelledby="access-heading"
        className="relative overflow-hidden w-full min-h-[90svh] flex flex-col justify-end border-t border-[var(--border-subtle)] scroll-mt-14"
      >
        <BackgroundVideo
          src="/videos/bg-journey.mp4"
          poster="/videos/bg-journey-poster.jpg"
        />
        <div className="section-scrim" aria-hidden="true" />
        <div className="relative z-[2] w-full max-w-[1500px] mx-auto px-5 sm:px-10 pt-[14svh] pb-20 sm:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-end">
            <div>
              <p className="kicker mb-4">04 · Early access</p>
              <h2 id="access-heading" className="display-sub">
                Moving<br />soon?
              </h2>
              <p className="mt-5 max-w-[560px] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
                Relocate is onboarding a small group of early movers. Tell us
                where you&rsquo;re headed and you&rsquo;ll be first in line when
                the doors open.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                {PHONE_LIVE && (
                  <a href={`tel:${PHONE_E164}`} className="btn-solid">
                    Call {PHONE_DISPLAY}
                  </a>
                )}
                <a
                  href="mailto:vnarasingamoorthy@gmail.com?subject=Early%20access%20request%20%E2%80%94%20Relocate&body=Hi%20%E2%80%94%20I%27d%20like%20early%20access%20to%20Relocate.%0A%0AMoving%20from%3A%20%0AMoving%20to%3A%20%0AApprox.%20date%3A%20%0A"
                  className="btn-outline"
                >
                  Request early access
                </a>
                <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-outline">
                  View on GitHub
                </a>
              </div>
            </div>
            <div className="code-card" role="figure" aria-label="For engineers: run Relocate locally">
              <div className="code-card-bar">
                <span>for engineers · open source</span>
              </div>
              <div className="code-card-body scrollbar-clean">
                <div className="code-line">
                  <span className="code-prompt" aria-hidden="true">$</span>
                  <span className="text-[var(--text-primary)]">git clone {REPO_URL}.git</span>
                </div>
                <div className="code-line">
                  <span className="code-prompt" aria-hidden="true">$</span>
                  <span className="text-[var(--text-primary)]">cd relocate-ai &amp;&amp; ./run.sh</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="w-full border-t border-[var(--border-subtle)] mt-auto">
        <div className="max-w-[1500px] mx-auto px-5 sm:px-10 py-16 flex flex-col items-center gap-8">
          <span className="nav-wordmark" aria-hidden="true">Relocate</span>
          <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="footer-link">GitHub</a>
            <a href={`${REPO_URL}/blob/main/ARCHITECTURE.md`} target="_blank" rel="noreferrer" className="footer-link">Architecture</a>
            <a href={`${REPO_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className="footer-link">Security</a>
            <a href={`${REPO_URL}/blob/main/STATUS.md`} target="_blank" rel="noreferrer" className="footer-link">Status</a>
            <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="footer-link">MIT License</a>
          </nav>
          <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--text-quaternary)]">
            © 2026 Relocate
          </span>
        </div>
      </footer>
    </>
  );
}

function linkStatus(connection: DashboardConnection): string {
  const labels: Record<DashboardConnection, string> = {
    connecting: "link · connecting",
    live: "link · online",
    reconnecting: "link · reconnecting",
    demo: "stream · active",
    offline: "link · offline",
  };
  return labels[connection];
}

/**
 * The single run-mode marker on the page. SIMULATION when the dashboard is
 * replaying synthetic data; LIVE when the orchestrator feed is connected.
 */
function ModeTag({ connection }: { connection: DashboardConnection }) {
  if (connection === "live") {
    return (
      <span className="sim-tag sim-tag--live" role="status">
        <span className="dot" aria-hidden="true" />
        Live
      </span>
    );
  }
  if (connection === "demo") {
    return (
      <span className="sim-tag" role="status">
        Simulation
      </span>
    );
  }
  return null;
}

function agentDisplayName(agentId: string): string {
  return ALL_AGENTS.find((agent) => agent.id === agentId)?.name ?? "Specialist";
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="stat-num">{value}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
        {label}
      </span>
    </div>
  );
}

function TimelineStep({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="tl-step flex flex-col gap-2">
      <span className="tl-num" aria-hidden="true">{n}</span>
      <h3 className="tl-title">
        <span className="sr-only">Step {n}: </span>
        {title}
      </h3>
      <p className="text-[13.5px] text-[var(--text-secondary)] leading-[1.6] max-w-[300px]">
        {body}
      </p>
    </div>
  );
}

function LadderRow({
  color,
  title,
  sub,
  status,
}: {
  color: string;
  title: string;
  sub: string;
  status: string;
}) {
  return (
    <div className="ladder-row">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="h-2 w-2 shrink-0"
          style={{ background: color }}
          aria-hidden="true"
        />
        <div className="flex flex-col min-w-0">
          <span className="text-[14px] font-medium text-[var(--text-primary)] truncate">{title}</span>
          <span className="text-[12px] text-[var(--text-tertiary)] truncate">{sub}</span>
        </div>
      </div>
      <span className="font-mono-tight text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] shrink-0">
        {status}
      </span>
    </div>
  );
}
