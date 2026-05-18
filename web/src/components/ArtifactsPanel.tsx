"use client";

interface SponsorEvent {
  sponsor: string;
  action: string;
  detail?: string;
  ts: number;
}

interface Props {
  sponsorEvents: SponsorEvent[];
}

/**
 * Artifacts panel — shows the REAL artifacts that get generated during a marketplace event.
 * Surfaces the actual IDs (Supermemory document ID, AgentMail message ID, Stripe intent ID, etc.)
 * pulled from sponsor_event details, so judges can verify in their inbox / Stripe dashboard.
 */
export function ArtifactsPanel({ sponsorEvents }: Props) {
  const artifacts = extractArtifacts(sponsorEvents);

  return (
    <section className="panel-elev p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[10px] tracking-[0.18em] text-[var(--ink-500)] uppercase">
          Real artifacts
        </span>
        <span className="text-[9px] text-[var(--ink-500)]">
          {artifacts.length === 0 ? "no events yet" : `${artifacts.length} produced`}
        </span>
      </div>
      <ul className="space-y-2">
        {artifacts.length === 0 ? (
          <li className="text-[11px] text-[var(--ink-500)] italic">
            Artifacts land here as agents complete: email message ID, Supermemory doc ID, Stripe intent.
          </li>
        ) : (
          artifacts.map((a, i) => (
            <li key={i} className="rise-in flex items-start gap-2.5">
              <span className="text-[10px] font-mono-tight pt-px shrink-0 text-[var(--cyan)]">
                {a.icon}
              </span>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] text-[var(--ink-100)] truncate">
                  <span className="font-semibold">{a.sponsor}</span>{" "}
                  <span className="text-[var(--ink-300)]">{a.action}</span>
                </span>
                <span className="text-[10px] font-mono-tight text-[var(--ink-500)] truncate">
                  {a.detail}
                </span>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function extractArtifacts(events: SponsorEvent[]) {
  const ICONS: Record<string, string> = {
    agentmail: "✉",
    supermemory: "◈",
    stripe: "$",
    sponge: "¤",
    moss: "⊡",
    browser_use: "▤",
  };
  return events
    .filter((e) => e.action !== "stubbed" && e.action !== "error")
    .slice(0, 6)
    .map((e) => ({
      sponsor: prettySponsor(e.sponsor),
      action: prettyAction(e.action),
      detail: e.detail ?? "—",
      icon: ICONS[e.sponsor] ?? "•",
    }));
}

function prettySponsor(s: string): string {
  return (
    {
      agentmail: "AgentMail",
      supermemory: "Supermemory",
      stripe: "Stripe",
      sponge: "sponge",
      moss: "Moss",
      browser_use: "Browser Use",
      agentphone: "AgentPhone",
    } as Record<string, string>
  )[s] ?? s;
}

function prettyAction(a: string): string {
  return a.replaceAll("_", " ");
}
