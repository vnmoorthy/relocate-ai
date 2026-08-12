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
  const heading = demoMode
    ? "Demo artifact events"
    : connection === "live"
      ? "Reported artifact events"
      : "Artifact events";

  return (
    <section className="panel-elev p-4" aria-labelledby="artifact-heading">
      <div className="flex items-baseline justify-between mb-3">
        <h3 id="artifact-heading" className="text-[10px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
          {heading}
        </h3>
        <span className="text-[9px] text-[var(--ink-500)]" aria-live="polite">
          {artifacts.length === 0
            ? "none reported yet"
            : demoMode
              ? `${artifacts.length} synthetic`
              : `${artifacts.length} reported`}
        </span>
      </div>
      <ul className="space-y-2" aria-live="polite" aria-label="Reported artifact events">
        {artifacts.length === 0 ? (
          <li className="text-[11px] text-[var(--ink-500)] italic">
            Artifact events appear here when an integration reports a receipt, document, message, or fallback.
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
  const label: Record<SponsorStatus, string> = {
    demo: "DEMO",
    reported: "REPORTED",
    fallback: "FALLBACK",
    error: "ERROR",
    idle: "IDLE",
  };
  const style: Record<SponsorStatus, string> = {
    demo: "text-[var(--amber)] border-[rgba(251,191,36,0.35)]",
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
