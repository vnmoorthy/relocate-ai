"use client";

import type { WSEvent } from "./types";

/**
 * Demo replay — fake WSEvent timeline used when no live orchestrator is reachable
 * (e.g. on the static GitHub Pages deploy). Generates a realistic-looking ~50 second
 * event sequence for all 17 agents so visitors see the swarm actually do something.
 *
 * Real orchestrator + buyer call always wins; this only kicks in after the WebSocket
 * fails to connect within `FALLBACK_DELAY_MS` (see ws-client.ts).
 */

const EVENT_ID = "mkt_demo_replay";

// Agents and their representative dialogue per mode
type Step = { role: "counterparty" | "agent"; text: string; tier?: "gemma-local" | "gemini-flash" | "claude-opus" };

const SCRIPTS: Record<string, Step[]> = {
  pge_shutoff: [
    { role: "counterparty", text: "pge.com Stop Service portal loaded." },
    { role: "agent", text: "Filling account 5512-4419-08, disconnect date May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "Identity verified. Submit?" },
    { role: "agent", text: "Bid: disconnect confirmed for 2026-05-31, confirmation 8472341.", tier: "gemini-flash" },
  ],
  water_board: [
    { role: "counterparty", text: "SFPUC MyAccount session opened." },
    { role: "agent", text: "Selecting Stop Service, May 31 final meter read.", tier: "gemma-local" },
    { role: "counterparty", text: "Final reading scheduled. Confirmation?" },
    { role: "agent", text: "Bid: water shutoff confirmed, ref SFPUC-WS-29841.", tier: "gemma-local" },
  ],
  comcast_cancel: [
    { role: "counterparty", text: "Lob certified-mail draft generated." },
    { role: "agent", text: "Letter addressed to Comcast Customer Care, Philadelphia.", tier: "gemma-local" },
    { role: "counterparty", text: "Mailpiece submitted. USPS tracking: 9407 1118 9899 9988 8772 65." },
    { role: "agent", text: "Bid: cancellation letter en route, delivers in 3-5 business days.", tier: "gemma-local" },
  ],
  geico_address: [
    { role: "counterparty", text: "Geico self-service portal loaded." },
    { role: "agent", text: "Old garage 123 Main St SF, new garage 456 Oak Austin TX.", tier: "gemma-local" },
    { role: "counterparty", text: "TX rate quoted: $142/mo (was $186). Accept?" },
    { role: "agent", text: "Bid: address updated, new policy TX-948-2A, $142/mo from May 31.", tier: "gemini-flash" },
  ],
  spectrum_austin: [
    { role: "counterparty", text: "Spectrum new-service order page open." },
    { role: "agent", text: "Internet Ultra 500, install May 31 at 456 Oak Austin.", tier: "gemma-local" },
    { role: "counterparty", text: "Tech window 8am-noon confirmed. Install fee?" },
    { role: "agent", text: "Bid: install scheduled May 31 8am-12pm, WO2847391024, fee waived.", tier: "gemma-local" },
  ],
  usps_coa: [
    { role: "counterparty", text: "moversguide.usps.com loaded." },
    { role: "agent", text: "Old SF address, new Austin address, family move, May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "$1.10 identity-verification charge approved." },
    { role: "agent", text: "Bid: COA filed, confirmation 4081-3293-7762-4419.", tier: "gemma-local" },
  ],
  mover_quote: [
    { role: "counterparty", text: "Email sent to Atlas, Bay Area, Mayflower." },
    { role: "agent", text: "Atlas replied: $1,840 OTD, $500 deposit, truck confirmed.", tier: "gemini-flash" },
    { role: "counterparty", text: "Bay Area: $2,140 OTD. Mayflower: $1,910." },
    { role: "agent", text: "Bid: winner Atlas $1,840 OTD, truck-confirmed for May 31.", tier: "gemini-flash" },
  ],
  flight_book: [
    { role: "counterparty", text: "Google Flights SFO→AUS, May 31, 1 passenger." },
    { role: "agent", text: "Top 3: United $187 / 3h25m nonstop, Alaska $174 1-stop, SW $159 1-stop.", tier: "gemini-flash" },
    { role: "counterparty", text: "Pick top 3 sorted by price-duration tradeoff." },
    { role: "agent", text: "Bid: 3 click-to-book deeplinks emailed; United nonstop is the win.", tier: "gemini-flash" },
  ],
  school_district: [
    { role: "counterparty", text: "AISD transfer office, this is Tara." },
    { role: "agent", text: "Initiating enrollment, child grade 4 transferring from SFUSD.", tier: "gemma-local" },
    { role: "counterparty", text: "Need immunization records + transcript. Records request sent?" },
    { role: "agent", text: "Bid: AISD enrollment opened, ref 118, packet arrives in 5 days.", tier: "gemma-local" },
  ],
  pcp_transfer: [
    { role: "counterparty", text: "One Medical records team, this is Devon." },
    { role: "agent", text: "HIPAA release on file, route records to Austin PCP.", tier: "gemma-local" },
    { role: "counterparty", text: "Queued. ETA 7-10 business days." },
    { role: "agent", text: "Bid: records transfer initiated, ref OM-RT-3392.", tier: "gemma-local" },
  ],
  vet_transfer: [
    { role: "counterparty", text: "SF Pet Clinic — pet's name?" },
    { role: "agent", text: "Captain, golden retriever, all vaccines current.", tier: "gemma-local" },
    { role: "counterparty", text: "Records sent to destination clinic." },
    { role: "agent", text: "Bid: vet records faxed, ref VET-MV-1208.", tier: "gemma-local" },
  ],
  gym_cancel: [
    { role: "counterparty", text: "Equinox SF — verify member ID?" },
    { role: "agent", text: "Cancellation, May 31, moving out of state.", tier: "gemma-local" },
    { role: "counterparty", text: "Cancellation final after 30 days. Confirmation EQX-CN-882." },
    { role: "agent", text: "Bid: membership ends May 31, pro-rated bill in 5 days.", tier: "gemma-local" },
  ],
  pharmacy: [
    { role: "counterparty", text: "cvs.com Transfer Prescriptions form open." },
    { role: "agent", text: "3 active scripts → CVS Austin store 8842, pickup by May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "Transfer queued. Confirmation?" },
    { role: "agent", text: "Bid: 3 RXs transferred, ref CVS-TX-4471, pickup ready May 31.", tier: "gemma-local" },
  ],
  uscis_ar11: [
    { role: "counterparty", text: "uscis.gov/ar-11 form loaded." },
    { role: "agent", text: "A-number, name, old/new address, move date filled.", tier: "gemini-flash" },
    { role: "counterparty", text: "Signature step reached — pause for user." },
    { role: "agent", text: "Bid: form pre-filled, resume URL emailed to customer to sign within 10 days.", tier: "claude-opus" },
  ],
  id_card_update: [
    { role: "counterparty", text: "Lob certified-mail draft for DL-13A." },
    { role: "agent", text: "Letter to CA DMV Address Change Unit, PO Box 942869 Sacramento.", tier: "gemma-local" },
    { role: "counterparty", text: "Mailpiece accepted, USPS tracking 7019 0140 0000 9388 4471." },
    { role: "agent", text: "Bid: DL-13A en route, customer signs the wet copy on receipt.", tier: "gemma-local" },
  ],
  bank_notify: [
    { role: "counterparty", text: "AgentMail composing playbook to customer@example.com." },
    { role: "agent", text: "90-second bank script: number, exact wording, expected verification.", tier: "gemma-local" },
    { role: "counterparty", text: "AgentMail returned message_id <m07a91…@agentmail.to>." },
    { role: "agent", text: "Bid: bank script delivered; customer makes the 90-second call themselves.", tier: "gemma-local" },
  ],
};

const SPONSOR_FIRES: Array<{ at_ms: number; sponsor: string; action: string; detail: string }> = [
  { at_ms: 1500, sponsor: "supermemory", action: "user_profile_recalled", detail: "Prior move Berkeley→SF Sept 2025" },
  { at_ms: 4200, sponsor: "browser_use", action: "task_started", detail: "pge.com/stop-service" },
  { at_ms: 7800, sponsor: "agentmail", action: "outreach_sent", detail: "atlas-moving.com, bayareamovers.com, mayflower.com" },
  { at_ms: 11000, sponsor: "lob", action: "mailpiece_created", detail: "Comcast cancellation letter, USPS tracking 940711…" },
  { at_ms: 14000, sponsor: "agentmail", action: "receipt_sent", detail: "Move package PDF → customer@example.com" },
  { at_ms: 19000, sponsor: "supermemory", action: "move_persisted", detail: "doc_id=TfdMnS737z4n1tBQxKtrM" },
];

/**
 * Generate the full event timeline for a demo replay. Returns events keyed by
 * relative ms. ws-client.ts schedules them on setTimeout.
 */
export function buildDemoTimeline(): Array<{ at_ms: number; event: WSEvent }> {
  const out: Array<{ at_ms: number; event: WSEvent }> = [];
  const t0_buyer = 200;

  // Buyer turns (concierge → caller exchange before fan-out)
  const buyerTurns: Array<{ role: "user" | "agent"; text: string; tier?: "gemma-local" }> = [
    { role: "user", text: "Hi, I'm moving from SF to Austin end of the month, two-bedroom, no kids, one dog." },
    { role: "agent", text: "Got it — SF to Austin, May 31, household of two, pet on board. Best email?", tier: "gemma-local" },
    { role: "user", text: "moorthy@example.com" },
    { role: "agent", text: "On it. I'll text you each task as it closes. Hang up whenever.", tier: "gemma-local" },
  ];
  for (let i = 0; i < buyerTurns.length; i++) {
    const t = buyerTurns[i];
    out.push({
      at_ms: t0_buyer + i * 800,
      event: {
        type: "transcript_turn",
        event_id: EVENT_ID,
        agent_id: "buyer",
        turn: i + 1,
        role: t.role === "user" ? "user" : "agent",
        text: t.text,
        pavo_tier: t.tier,
        ts: 0,
      },
    });
    if (t.role === "agent" && t.tier) {
      out.push({
        at_ms: t0_buyer + i * 800 + 50,
        event: {
          type: "routing_decision",
          event_id: EVENT_ID,
          agent_id: "buyer",
          turn: i + 1,
          tier: t.tier,
          reason: "buyer-extract early turn",
          complexity: 0.1,
          ts: 0,
        },
      });
    }
  }

  // After the buyer wraps, fan out: every specialist dispatches in a burst.
  const FAN_OUT_AT = 4000;
  const SPECIALIST_IDS = Object.keys(SCRIPTS);
  for (let i = 0; i < SPECIALIST_IDS.length; i++) {
    const agent_id = SPECIALIST_IDS[i];
    const offset = FAN_OUT_AT + i * 120;
    out.push({
      at_ms: offset,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id,
        state: "dispatched",
        ts: 0,
      },
    });
    out.push({
      at_ms: offset + 600,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id,
        state: "in-progress",
        ts: 0,
      },
    });

    // Stream that specialist's 4-turn conversation
    const script = SCRIPTS[agent_id];
    for (let j = 0; j < script.length; j++) {
      const step = script[j];
      const tt = offset + 1200 + j * 1800 + i * 80;
      out.push({
        at_ms: tt,
        event: {
          type: "transcript_turn",
          event_id: EVENT_ID,
          agent_id,
          turn: j + 1,
          role: step.role,
          text: step.text,
          pavo_tier: step.tier,
          ts: 0,
        },
      });
      if (step.role === "agent" && step.tier) {
        out.push({
          at_ms: tt + 60,
          event: {
            type: "routing_decision",
            event_id: EVENT_ID,
            agent_id,
            turn: j + 1,
            tier: step.tier,
            reason: tierReason(step.tier, j),
            complexity: tierComplexity(step.tier),
            ts: 0,
          },
        });
      }
    }

    // Close it
    const close_at = offset + 1200 + script.length * 1800 + 600;
    out.push({
      at_ms: close_at,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id,
        state: "closed",
        ts: 0,
      },
    });
  }

  // Sponsor fires scattered across the timeline
  for (const s of SPONSOR_FIRES) {
    out.push({
      at_ms: s.at_ms,
      event: {
        type: "sponsor_event",
        event_id: EVENT_ID,
        sponsor: s.sponsor as never,
        action: s.action,
        detail: s.detail,
        ts: 0,
      },
    });
  }

  // Cost updates — tick up smoothly across the run
  const COST_TICKS = 20;
  const RUN_DURATION = 30000;
  for (let i = 0; i < COST_TICKS; i++) {
    const at = FAN_OUT_AT + (RUN_DURATION * (i + 1)) / COST_TICKS;
    out.push({
      at_ms: at,
      event: {
        type: "cost_update",
        event_id: EVENT_ID,
        pavo_cents: 0.0001 * (i + 1) * 8,    // ~$0.0008 → $0.016 across the run
        baseline_cents: 0.0001 * (i + 1) * 8 * 28, // 28× ratio
        ts: 0,
      },
    });
  }

  return out;
}

function tierReason(tier: string, turn: number): string {
  if (tier === "gemma-local") return "early-call greeting; clamp to gemma-local";
  if (tier === "gemini-flash") return "medium pattern (pricing/specifics/confirmation)";
  if (tier === "claude-opus") return "hard pattern (legal/policy/signature)";
  return "no-anthropic-fallback";
}
function tierComplexity(tier: string): number {
  if (tier === "gemma-local") return 0.18;
  if (tier === "gemini-flash") return 0.52;
  return 0.84;
}
