"use client";

import { ArtifactsPanel } from "@/components/ArtifactsPanel";
import { CostTicker } from "@/components/CostTicker";
import { FieldsCollectedStrip } from "@/components/FieldsCollectedStrip";
import { PAVOFlow } from "@/components/PAVOFlow";
import { SponsorRow } from "@/components/SponsorRow";
import { SwarmStage } from "@/components/SwarmStage";
import { useDashboardWS } from "@/lib/ws-client";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/dashboard";

const PHONE_E164 = "+16184149537";
const PHONE_DISPLAY = "+1 (618) 414-9537";

export default function Page() {
  const s = useDashboardWS(WS_URL);

  return (
    <main className="min-h-screen flex flex-col">
      {/* ═════════════════════════════════════════════════════════════════
          NAV
          ═════════════════════════════════════════════════════════════════ */}
      <nav className="w-full px-8 py-5 flex items-center justify-between max-w-[1440px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-[var(--brand)] flex items-center justify-center">
            <span className="text-black font-bold text-sm">R</span>
          </div>
          <span className="font-display text-[15px] text-[var(--text-primary)] tracking-tight">
            Relocate
          </span>
        </div>
        <div className="flex items-center gap-8 text-[13px] text-[var(--text-secondary)]">
          <a href="#live" className="hover:text-[var(--text-primary)] transition-colors">Live</a>
          <a href="#how" className="hover:text-[var(--text-primary)] transition-colors">How it works</a>
          <a href="https://github.com/vnmoorthy/relocate-ai" target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)] transition-colors">GitHub</a>
          <a
            href={`tel:${PHONE_E164}`}
            className="btn-primary"
            style={{ padding: "0.5rem 1rem", fontSize: 13 }}
          >
            Call now
          </a>
        </div>
      </nav>

      {/* ═════════════════════════════════════════════════════════════════
          HERO
          ═════════════════════════════════════════════════════════════════ */}
      <section className="w-full max-w-[1440px] mx-auto px-8 pt-16 pb-20">
        <div className="max-w-[920px] mx-auto text-center flex flex-col items-center gap-7">
          <span className="section-eyebrow">
            <span className="dot" />
            Live · {s.connected ? "agents online" : "reconnecting…"}
          </span>

          <h1 className="hero-title text-[clamp(56px,9vw,128px)]">
            Relocate.<br />In one call.
          </h1>

          <p className="hero-tagline">
            Dial a single phone number. A real-time swarm of 17 AI agents
            (1 concierge + 16 specialists) handles your relocation — utility
            shutoffs, mover bids, flight search, USPS forwarding, address
            updates, USCIS AR-11, DMV change of address — and delivers
            verifiable artifacts to your inbox before you hang up.
          </p>

          <div className="flex items-center gap-3 mt-2">
            <a href={`tel:${PHONE_E164}`} className="btn-primary">
              <span aria-hidden="true">📞</span>
              <span className="font-mono-tight tracking-tight">{PHONE_DISPLAY}</span>
            </a>
            <a href="#live" className="btn-secondary">Watch the swarm</a>
          </div>

          {/* Trust strip */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[12px] text-[var(--text-tertiary)] uppercase tracking-[0.18em]">
            <span>Built on PAVO · TMLR 2026</span>
            <span className="opacity-50">·</span>
            <span>Local on Apple Silicon</span>
            <span className="opacity-50">·</span>
            <span>Powered by AgentPhone</span>
          </div>
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════════
          LIVE DEMO — the swarm
          ═════════════════════════════════════════════════════════════════ */}
      <section id="live" className="w-full max-w-[1440px] mx-auto px-8 pb-20">
        <div className="flex items-end justify-between mb-6">
          <div className="flex flex-col gap-2">
            <span className="section-eyebrow w-fit">
              <span className="dot" />
              Live swarm
            </span>
            <h2 className="font-display text-[34px] text-[var(--text-primary)] tracking-tight">
              Watch a real call unfold
            </h2>
          </div>
          <div className="text-[13px] text-[var(--text-tertiary)] font-mono-tight hidden md:block">
            {new Date().toLocaleTimeString("en-US", { hour12: false })}
            {s.eventId && <span className="ml-3">event {s.eventId}</span>}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4 min-h-[760px]">
          <div className="col-span-12 lg:col-span-9 min-h-[760px] flex">
            <SwarmStage
              agentStates={s.agentStates}
              transcripts={s.transcripts}
              routingDecisions={s.routingDecisions}
              eventId={s.eventId}
            />
          </div>
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-4 min-h-0">
            <PAVOFlow decisions={s.routingDecisions} />
            <ArtifactsPanel sponsorEvents={s.sponsorEvents} />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <FieldsCollectedStrip collectedFields={s.collectedFields} />
          <SponsorRow sponsorEvents={s.sponsorEvents} />
          <CostTicker
            pavoCents={s.pavoCents}
            baselineCents={s.baselineCents}
            decisions={s.routingDecisions.length}
          />
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════════
          HOW IT WORKS
          ═════════════════════════════════════════════════════════════════ */}
      <section id="how" className="w-full max-w-[1440px] mx-auto px-8 py-20 border-t border-[var(--border-subtle)]">
        <div className="flex flex-col gap-3 mb-12 max-w-[720px]">
          <span className="section-eyebrow w-fit">
            <span className="dot" />
            How it works
          </span>
          <h2 className="font-display text-[44px] text-[var(--text-primary)] tracking-tight leading-[1.05]">
            Four steps. Ninety&nbsp;seconds.
          </h2>
          <p className="text-[var(--text-secondary)] text-[17px] leading-relaxed">
            One inbound call kicks off a fleet of agents — each one optimized
            for a specific relocation task, each one producing a real artifact
            you can verify.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Step
            n="01"
            title="You call"
            body="Dial +1 (618) 414-9537. The concierge — ElevenLabs voice Cleo — picks up in under a second and asks where you're going."
          />
          <Step
            n="02"
            title="Spec extracted"
            body="In two turns, the concierge captures origin, destination, move date, household size, pets, kids, car — and emits a JSON dispatch block."
          />
          <Step
            n="03"
            title="Swarm fans out"
            body="Sixteen specialist agents dispatch in parallel. Browser Use submits real forms (PG&E, USPS, Geico, Spectrum, water, flights). AgentMail emails intake addresses (movers, schools, vets, bank-script playbook). Lob mails Comcast + DMV DL-13A certified letters. USCIS AR-11 is pre-filled to the signature step — federal law requires the alien to sign."
          />
          <Step
            n="04"
            title="Artifacts land"
            body="Each agent emits a real email with structured next-steps and a Supermemory document for next-call recall. By the time you hang up, your inbox is full of confirmations."
          />
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════════
          PAVO — the moat
          ═════════════════════════════════════════════════════════════════ */}
      <section className="w-full max-w-[1440px] mx-auto px-8 py-20 border-t border-[var(--border-subtle)]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-4">
            <span className="section-eyebrow w-fit">
              <span className="dot" />
              The moat
            </span>
            <h2 className="font-display text-[44px] text-[var(--text-primary)] tracking-tight leading-[1.05]">
              PAVO routes every turn.
            </h2>
            <p className="text-[var(--text-secondary)] text-[17px] leading-relaxed">
              Pipeline-Aware Voice Orchestration — peer-reviewed at TMLR 2026,
              50,000-turn benchmark, dataset open-source. Cheap turns run on
              your Mac's Apple Silicon. Hard turns escalate to Gemini Flash
              or Claude Opus.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Stat label="Cheaper than cloud" value="25%" />
              <Stat label="Lower median latency" value="34%" />
              <Stat label="Less energy" value="71%" />
              <Stat label="Fewer coherence failures" value="7.9×" />
            </div>
            <div className="flex gap-3 mt-4">
              <a
                href="https://huggingface.co/datasets/vnmoorthy/pavo-bench"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Read the paper →
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
                sub="local · M3 Air Apple Silicon"
                cost="$0.0001/turn"
              />
              <TierRow
                color="var(--tier-cloud-mid)"
                title="Gemini Flash 2.5"
                sub="cloud · Google DeepMind"
                cost="$0.0023/turn"
              />
              <TierRow
                color="var(--tier-cloud-hard)"
                title="Claude Opus 4.7"
                sub="cloud · escalation only"
                cost="$0.0420/turn"
              />
              <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed mt-2">
                Most turns ("acknowledge", "confirm") stay local. Pricing
                lookups, IVR navigation, policy disputes escalate. The router
                makes that call in ~10ms per turn.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════════
          FOOTER
          ═════════════════════════════════════════════════════════════════ */}
      <footer className="w-full border-t border-[var(--border-subtle)] mt-auto">
        <div className="max-w-[1440px] mx-auto px-8 py-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
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
            <a href="https://huggingface.co/datasets/vnmoorthy/pavo-bench" target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)] transition-colors">PAVO dataset</a>
            <span className="text-[var(--text-quaternary)]">© 2026 · MIT</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Section components
   ───────────────────────────────────────────────────────────────────────── */

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
      <span className="font-display text-[26px] text-[var(--text-primary)] tracking-tight font-mono-tight">
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
  cost,
}: {
  color: string;
  title: string;
  sub: string;
  cost: string;
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
        {cost}
      </span>
    </div>
  );
}
