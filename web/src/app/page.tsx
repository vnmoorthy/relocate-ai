"use client";

import { ArtifactsPanel } from "@/components/ArtifactsPanel";
import { CostTicker } from "@/components/CostTicker";
import { FieldsCollectedStrip } from "@/components/FieldsCollectedStrip";
import { PAVOFlow } from "@/components/PAVOFlow";
import { SponsorRow } from "@/components/SponsorRow";
import { SwarmStage } from "@/components/SwarmStage";
import { useDashboardWS } from "@/lib/ws-client";
import type { DashboardConnection } from "@/lib/dashboard-state";
import { ALL_AGENTS } from "@/lib/types";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/dashboard";

const PHONE_E164 = "+16184149537";
const PHONE_DISPLAY = "+1 (618) 414-9537";

export default function Page() {
  const s = useDashboardWS(WS_URL);
  const submittedCount =
    typeof s.finalSummary?.submitted_count === "number" ? s.finalSummary.submitted_count : 0;
  const failedCount =
    typeof s.finalSummary?.failed_count === "number" ? s.finalSummary.failed_count : 0;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header>
      <nav aria-label="Primary" className="w-full px-4 sm:px-8 py-4 sm:py-5 flex items-center justify-between gap-3 max-w-[1440px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-[var(--brand)] flex items-center justify-center">
            <span className="text-black font-bold text-sm">R</span>
          </div>
          <span className="font-display text-[15px] text-[var(--text-primary)] tracking-tight">
            Relocate
          </span>
        </div>
        <div className="flex items-center gap-3 sm:gap-6 lg:gap-8 text-[13px] text-[var(--text-secondary)]">
          <a href="#dashboard" className="hover:text-[var(--text-primary)] transition-colors">Live</a>
          <a href="#how" className="hidden sm:inline hover:text-[var(--text-primary)] transition-colors">How it works</a>
          <a href="https://github.com/vnmoorthy/relocate-ai" target="_blank" rel="noreferrer" className="hidden md:inline hover:text-[var(--text-primary)] transition-colors">GitHub</a>
          <a
            href={`tel:${PHONE_E164}`}
            className="btn-primary"
            style={{ padding: "0.5rem 1rem", fontSize: 13 }}
          >
            Call now
          </a>
        </div>
      </nav>
      </header>

      <main id="main-content">

      <section aria-labelledby="hero-title" className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 pt-12 sm:pt-16 pb-16 sm:pb-20">
        <div className="max-w-[920px] mx-auto text-center flex flex-col items-center gap-7">
          <ConnectionStatus
            connection={s.connection}
            completed={s.completed}
            waitingCount={s.waitingForUserAgents.length}
            finalized={s.finalized}
            finalOutcome={s.finalOutcome}
          />

          <h1 id="hero-title" className="hero-title text-[clamp(44px,14vw,128px)]">
            Relocate.<br />In one call.
          </h1>

          <p className="hero-tagline">
            Dial a single phone number. A real-time swarm of 17 AI agents
            (1 concierge + 16 specialists) handles your relocation — utility
            shutoffs, mover bids, flight search, USPS forwarding, address
            updates, USCIS AR-11, DMV change of address — and streams every
            outcome to this dashboard before you hang up.
          </p>

          <div className="hero-cta-row flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-2 w-full sm:w-auto">
            <a href={`tel:${PHONE_E164}`} className="btn-primary">
              <span className="font-mono-tight tracking-tight">{PHONE_DISPLAY}</span>
            </a>
            <a href="#dashboard" className="btn-secondary">Watch the swarm</a>
          </div>

          {s.demoMode && (
            <p className="max-w-[640px] rounded-lg border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.06)] px-4 py-3 text-[13px] leading-relaxed text-[var(--amber)]" role="status" aria-live="polite">
              Demo replay running — the swarm below is a labeled simulation so the site works without a live backend. Call the number for a real session.
            </p>
          )}

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[12px] text-[var(--text-tertiary)] uppercase tracking-[0.18em]">
            <span>Built on PAVO · TMLR 2026</span>
            <span className="opacity-50">·</span>
            <span>Local on Apple Silicon</span>
            <span className="opacity-50">·</span>
            <span>Powered by AgentPhone</span>
          </div>
        </div>
      </section>

      <section id="dashboard" aria-labelledby="dashboard-heading" className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 pb-16 sm:pb-20 scroll-mt-4">
        <div className="flex items-end justify-between mb-6">
          <div className="flex flex-col gap-2">
            <span className="section-eyebrow w-fit">
              <span className="dot" />
              {dashboardHeading(s.connection).eyebrow}
            </span>
            <h2 id="dashboard-heading" className="font-display text-[clamp(28px,6vw,34px)] text-[var(--text-primary)] tracking-tight">
              {dashboardHeading(s.connection).title}
            </h2>
          </div>
          <div className="text-[13px] text-[var(--text-tertiary)] font-mono-tight hidden md:block" aria-live="polite">
            <span>{connectionLabel(s.connection)}</span>
            {s.eventId && <span className="ml-3">{s.demoMode ? "demo session" : "live event"}</span>}
          </div>
        </div>

        {s.waitingForUserAgents.length > 0 && (
          <p className="mb-4 rounded-lg border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.06)] px-4 py-3 text-[13px] text-[var(--amber)]" role="status" aria-live="polite">
            {s.demoMode ? "Demo paused" : "Waiting for user action"} on {s.waitingForUserAgents.length} request{s.waitingForUserAgents.length === 1 ? "" : "s"}: {s.waitingForUserAgents.map(agentDisplayName).join(", ")}.
          </p>
        )}
        {s.finalized && (
          <p className="mb-4 rounded-lg border border-[rgba(0,212,154,0.35)] bg-[rgba(0,212,154,0.06)] px-4 py-3 text-[13px] text-[var(--brand)]" role="status" aria-live="polite">
            {s.demoMode ? "Demo complete" : "Dispatch finalized"}: {submittedCount} specialist{submittedCount === 1 ? "" : "s"} submitted
            {failedCount > 0 ? `, ${failedCount} failed` : ""}.
            {s.demoMode
              ? " Call the number above for a live run."
              : " Submitted means a provider accepted the request."}
          </p>
        )}

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
      </section>

      <section id="how" aria-labelledby="how-heading" className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-16 sm:py-20 border-t border-[var(--border-subtle)] scroll-mt-4">
        <div className="flex flex-col gap-3 mb-12 max-w-[720px]">
          <span className="section-eyebrow w-fit">
            <span className="dot" />
            How it works
          </span>
          <h2 id="how-heading" className="font-display text-[clamp(34px,8vw,44px)] text-[var(--text-primary)] tracking-tight leading-[1.05]">
            Four steps. Ninety&nbsp;seconds.
          </h2>
          <p className="text-[var(--text-secondary)] text-[17px] leading-relaxed">
            One inbound call kicks off a fleet of specialists — each optimized
            for a relocation task, each reporting a concrete outcome you can
            inspect on the dashboard.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Step
            n="01"
            title="You call"
            body="Dial +1 (618) 414-9537. The ElevenLabs concierge picks up and asks where you're going."
          />
          <Step
            n="02"
            title="Spec extracted"
            body="In a few turns, the concierge captures origin, destination, move date, household, pets, kids, car, and visa — then emits a structured dispatch."
          />
          <Step
            n="03"
            title="Swarm fans out"
            body="Up to 16 specialists run in parallel via Browser Use, AgentMail, and Lob. Conditional agents fire only when needed; signature-gated workflows pause for your action."
          />
          <Step
            n="04"
            title="Artifacts land"
            body="Each agent reports submitted, needs-user-action, or failed — with receipts, tracking IDs, or a handoff playbook streamed live to this dashboard."
          />
        </div>
      </section>

      <section aria-labelledby="pavo-heading" className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-16 sm:py-20 border-t border-[var(--border-subtle)]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-4">
            <span className="section-eyebrow w-fit">
              <span className="dot" />
              The moat
            </span>
            <h2 id="pavo-heading" className="font-display text-[clamp(34px,8vw,44px)] text-[var(--text-primary)] tracking-tight leading-[1.05]">
              PAVO routes every turn.
            </h2>
            <p className="text-[var(--text-secondary)] text-[17px] leading-relaxed">
              Pipeline-Aware Voice Orchestration — peer-reviewed at TMLR 2026.
              Cheap turns stay on Apple Silicon. Hard turns escalate to Gemini
              Flash or Claude Opus. The open repo ships an inspectable heuristic
              router; the PAVO-Bench dataset is public.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Stat label="Cheaper than cloud" value="25%" />
              <Stat label="Lower median latency" value="34%" />
              <Stat label="Less energy" value="71%" />
              <Stat label="Fewer coherence failures" value="7.9×" />
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <a
                href="https://huggingface.co/datasets/vnmoorthy/pavo-bench"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                PAVO-Bench dataset
              </a>
              <a
                href="https://github.com/vnmoorthy/relocate-ai"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Star on GitHub
              </a>
            </div>
          </div>
          <div className="panel-elev p-6 lg:p-8">
            <div className="flex flex-col gap-4">
              <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Tier dispatch ladder
              </span>
              <TierRow
                color="var(--tier-local)"
                title="Gemma 2-2B"
                sub="local · Apple Silicon"
                status="$0.0001/turn"
              />
              <TierRow
                color="var(--tier-cloud-mid)"
                title="Gemini Flash 2.5"
                sub="cloud · mid-tier"
                status="$0.0023/turn"
              />
              <TierRow
                color="var(--tier-cloud-hard)"
                title="Claude Opus 4.7"
                sub="cloud · escalation"
                status="$0.0420/turn"
              />
              <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed mt-2">
                Simple turns stay local. Pricing, policy, and signature steps
                escalate. Benchmark figures above are from PAVO-Bench — linked
                dataset, not this product&apos;s live invoice.
              </p>
            </div>
          </div>
        </div>
      </section>

      </main>

      <footer className="w-full border-t border-[var(--border-subtle)] mt-auto">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-md bg-[var(--brand)] flex items-center justify-center">
              <span className="text-black font-bold text-sm">R</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-[14px] text-[var(--text-primary)]">Relocate</span>
              <span className="text-[12px] text-[var(--text-tertiary)]">AI Relocation OS · Built on PAVO</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px] text-[var(--text-secondary)]">
            <a href={`tel:${PHONE_E164}`} className="hover:text-[var(--text-primary)] transition-colors">
              {PHONE_DISPLAY}
            </a>
            <a href="https://github.com/vnmoorthy/relocate-ai" target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)] transition-colors">GitHub</a>
            <a href="https://huggingface.co/datasets/vnmoorthy/pavo-bench" target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)] transition-colors">PAVO-Bench</a>
            <span className="text-[var(--text-quaternary)]">© 2026 · MIT</span>
          </div>
        </div>
      </footer>
    </>
  );
}

function connectionLabel(connection: DashboardConnection): string {
  const labels: Record<DashboardConnection, string> = {
    connecting: "Connecting…",
    live: "Live orchestrator",
    reconnecting: "Reconnecting…",
    demo: "Demo replay",
    offline: "Offline",
  };
  return labels[connection];
}

function dashboardHeading(connection: DashboardConnection): { eyebrow: string; title: string } {
  const headings: Record<DashboardConnection, { eyebrow: string; title: string }> = {
    connecting: {
      eyebrow: "Connecting",
      title: "Spinning up the live feed",
    },
    live: {
      eyebrow: "Live swarm",
      title: "Watch a real call unfold",
    },
    reconnecting: {
      eyebrow: "Reconnecting",
      title: "Event feed pausing briefly",
    },
    demo: {
      eyebrow: "Demo swarm",
      title: "Watch all 17 agents dispatch",
    },
    offline: {
      eyebrow: "Offline",
      title: "No event feed available",
    },
  };
  return headings[connection];
}

function agentDisplayName(agentId: string): string {
  return ALL_AGENTS.find((agent) => agent.id === agentId)?.name ?? "Specialist";
}

function ConnectionStatus({
  connection,
  completed,
  waitingCount,
  finalized,
  finalOutcome,
}: {
  connection: DashboardConnection;
  completed: boolean;
  waitingCount: number;
  finalized: boolean;
  finalOutcome: "submitted" | "partial_failure" | null;
}) {
  const isLive = connection === "live";
  const isDemo = connection === "demo";
  const statusText = waitingCount > 0
    ? `${isDemo ? "Demo paused" : "Waiting for you"} · ${waitingCount}`
    : finalized
      ? `${isDemo ? "Demo complete" : "Dispatch done"} · ${finalOutcome === "partial_failure" ? "partial" : "submitted"}`
      : completed
        ? isDemo
          ? "Demo complete"
          : "Event complete"
        : isLive
          ? "Live · agents online"
          : isDemo
            ? "Demo · swarm ready"
            : connectionLabel(connection);
  return (
    <span
      className={`section-eyebrow ${isDemo ? "border-[rgba(251,191,36,0.45)] text-[var(--amber)]" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="dot" aria-hidden="true" />
      {statusText}
      {isLive && <span className="sr-only">. Agent events are being received now.</span>}
    </span>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="panel p-6 flex flex-col gap-3 hover:border-[var(--border-default)] transition-colors">
      <span className="font-mono-tight text-[var(--text-tertiary)] text-[12px]">{n}</span>
      <h3 className="font-display text-[18px] text-[var(--text-primary)] tracking-tight">
        {title}
      </h3>
      <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4 flex flex-col gap-1">
      <span className="font-display text-[clamp(22px,4vw,28px)] text-[var(--text-primary)] tracking-tight">
        {value}
      </span>
      <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-[0.12em]">
        {label}
      </span>
    </div>
  );
}

function TierRow({
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
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ background: color, boxShadow: `0 0 12px 1px ${color}` }}
        />
        <div className="flex flex-col">
          <span className="text-[14px] font-medium text-[var(--text-primary)]">{title}</span>
          <span className="text-[12px] text-[var(--text-tertiary)]">{sub}</span>
        </div>
      </div>
      <span className="font-mono-tight text-[13px] text-[var(--text-secondary)] tabular-nums">
        {status}
      </span>
    </div>
  );
}
