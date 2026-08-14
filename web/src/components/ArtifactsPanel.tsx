"use client";

import { publicFeedText } from "@/lib/privacy";
import {
  sponsorStatus,
  type DashboardConnection,
  type SponsorStatus,
} from "@/lib/dashboard-state";

interface SponsorEvent {
  sponsor: string;
  action: string;
  detail?: string;
  ts: number;
}

interface Props {
  sponsorEvents: SponsorEvent[];
  connection: DashboardConnection;
}

export function ArtifactsPanel({ sponsorEvents, connection }: Props) {
  const demoMode = connection === "demo";
  const artifacts = extractArtifacts(sponsorEvents, demoMode);
  const heading = "Artifact events";

  return (
    <section className="panel-elev p-4" aria-labelledby="artifact-heading">
      <div className="flex items-baseline justify-between mb-3">
        <h3 id="artifact-heading" className="text-[10px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
          {heading}
        </h3>
        <span className="text-[9px] text-[var(--ink-500)]" aria-live="polite">
          {artifacts.length === 0 ? "none reported yet" : `${artifacts.length} reported`}
        </span>
      </div>
      <ul className="space-y-2" aria-live="polite" aria-label="Reported artifact events">
        {artifacts.length === 0 ? (
          <li className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="text-[var(--ink-700)]"
            >
              <path
                d="M2.5 11.5h3.75l1.25 2h5l1.25-2h3.75M2.5 11.5V16a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4.5M2.5 11.5 4.6 4.2A1 1 0 0 1 5.56 3.5h8.88a1 1 0 0 1 .96.7l2.1 7.3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[11px] leading-relaxed text-[var(--ink-500)] max-w-[260px]">
              No artifact events yet — receipts, documents, and fallbacks appear
              here as integrations report them.
            </span>
          </li>
        ) : (
          artifacts.map((artifact) => (
            <li key={artifact.key} className="rise-in flex items-start gap-2.5">
              <span className="text-[10px] font-mono-tight pt-px shrink-0 text-[var(--cyan)]" aria-hidden="true">
                {artifact.icon}
              </span>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] text-[var(--ink-100)] truncate">
                  <span className="font-semibold">{artifact.sponsor}</span>{" "}
                  <span className="text-[var(--ink-300)]">{artifact.action}</span>
                </span>
                <span className="text-[10px] font-mono-tight text-[var(--ink-500)] truncate" title={artifact.detail}>
                  {artifact.detail}
                </span>
              </div>
              <ArtifactStatus status={artifact.status} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function extractArtifacts(events: SponsorEvent[], demoMode: boolean) {
  const icons: Record<string, string> = {
    agentmail: "✉",
    supermemory: "◈",
    stripe: "$",
    sponge: "¤",
    moss: "⊡",
    browser_use: "▤",
    lob: "✦",
  };
  return events
    .filter((event) => isArtifactAction(event.action))
    .slice(0, 8)
    .map((event) => ({
      key: `${event.sponsor}-${event.action}-${event.ts}`,
      sponsor: prettySponsor(event.sponsor),
      action: prettyAction(event.action),
      detail: publicFeedText(
        event.detail ?? "No identifier supplied",
        demoMode,
        "Provider identifier hidden on this public dashboard.",
      ),
      icon: icons[event.sponsor] ?? "•",
      status: sponsorStatus(event, demoMode),
    }));
}

function isArtifactAction(action: string): boolean {
  return (
    action === "error" ||
    action === "stubbed" ||
    action.includes("fallback") ||
    /(created|sent|persisted|submitted|completed|receipt|confirmed)$/.test(action)
  );
}

function ArtifactStatus({ status }: { status: SponsorStatus }) {
  // The "demo" status renders as the normal reported pill — the page-level
  // SIMULATION tag carries the disclosure.
  const label: Record<SponsorStatus, string> = {
    demo: "REPORTED",
    reported: "REPORTED",
    fallback: "FALLBACK",
    error: "ERROR",
    idle: "IDLE",
  };
  const style: Record<SponsorStatus, string> = {
    demo: "text-[var(--mint)] border-[rgba(0,212,154,0.35)]",
    reported: "text-[var(--mint)] border-[rgba(0,212,154,0.35)]",
    fallback: "text-[var(--tier-haiku)] border-[rgba(96,165,250,0.35)]",
    error: "text-[var(--red)] border-[rgba(248,113,113,0.35)]",
    idle: "text-[var(--ink-500)] border-[var(--border-mid)]",
  };
  return <span className={`text-[8px] font-semibold tracking-[0.1em] rounded border px-1.5 py-0.5 ${style[status]}`}>{label[status]}</span>;
}

function prettySponsor(sponsor: string): string {
  return (
    {
      agentmail: "AgentMail",
      supermemory: "Supermemory",
      stripe: "Stripe",
      sponge: "Sponge",
      moss: "Moss",
      browser_use: "Browser Use",
      agentphone: "AgentPhone",
      lob: "Lob",
    } as Record<string, string>
  )[sponsor] ?? sponsor;
}

function prettyAction(action: string): string {
  return action.replaceAll("_", " ");
}
