import type { WSEvent } from "./types";

/**
 * Demo replay — fake WSEvent timeline used when no live orchestrator is reachable
 * (e.g. on the static GitHub Pages deploy). Every value is intentionally synthetic,
 * and the UI labels the entire sequence as a demo replay.
 *
 * Real orchestrator + buyer call always wins; this only kicks in after the WebSocket
 * fails to connect within `FALLBACK_DELAY_MS` (see ws-client.ts).
 */

const EVENT_ID = "mkt_demo_replay";

const DEMO_SPEC = {
  origin_address: "123 Main St, San Francisco, CA",
  destination_address: "456 Oak St, Austin, TX",
  move_date: "2026-05-31",
  user_email: "demo.customer@example.com",
  household_size: 3,
  has_pets: true,
  has_children: true,
  has_car: true,
  has_visa: true,
} as const;

// Agents and their representative dialogue per mode
type Step = { role: "counterparty" | "agent"; text: string; tier?: "gemma-local" | "gemini-flash" | "claude-opus" };

const SCRIPTS: Record<string, Step[]> = {
  pge_shutoff: [
    { role: "counterparty", text: "pge.com Stop Service portal loaded." },
    { role: "agent", text: "Filling account 5512-4419-08, disconnect date May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "Identity verified. Submit?" },
    { role: "agent", text: "Synthetic request submitted: stop-service request accepted; completion is not verified.", tier: "gemini-flash" },
  ],
  water_board: [
    { role: "counterparty", text: "SFPUC MyAccount session opened." },
    { role: "agent", text: "Selecting Stop Service, May 31 final meter read.", tier: "gemma-local" },
    { role: "counterparty", text: "Final reading scheduled. Confirmation?" },
    { role: "agent", text: "Synthetic request submitted: water stop-service request accepted; completion is not verified.", tier: "gemma-local" },
  ],
  comcast_cancel: [
    { role: "counterparty", text: "Lob certified-mail draft generated." },
    { role: "agent", text: "Letter addressed to Comcast Customer Care, Philadelphia.", tier: "gemma-local" },
    { role: "counterparty", text: "Mailpiece submitted. USPS tracking: 9407 1118 9899 9988 8772 65." },
    { role: "agent", text: "Synthetic request submitted: certified-mail job accepted; delivery is not verified.", tier: "gemma-local" },
  ],
  geico_address: [
    { role: "counterparty", text: "Geico self-service portal loaded." },
    { role: "agent", text: "Old garage 123 Main St SF, new garage 456 Oak Austin TX.", tier: "gemma-local" },
    { role: "counterparty", text: "TX rate quoted: $142/mo (was $186). Accept?" },
    { role: "agent", text: "Synthetic request submitted: address-change request accepted; policy completion is not verified.", tier: "gemini-flash" },
  ],
  spectrum_austin: [
    { role: "counterparty", text: "Spectrum new-service order page open." },
    { role: "agent", text: "Internet Ultra 500, install May 31 at 456 Oak Austin.", tier: "gemma-local" },
    { role: "counterparty", text: "Tech window 8am-noon confirmed. Install fee?" },
    { role: "agent", text: "Synthetic request submitted: install-order request accepted; appointment completion is not verified.", tier: "gemma-local" },
  ],
  usps_coa: [
    { role: "counterparty", text: "moversguide.usps.com loaded." },
    { role: "agent", text: "Old SF address, new Austin address, family move, May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "$1.10 identity-verification charge approved." },
    { role: "agent", text: "Synthetic request submitted: change-of-address request accepted; completion is not verified.", tier: "gemma-local" },
  ],
  mover_quote: [
    { role: "counterparty", text: "Email sent to Atlas, Bay Area, Mayflower." },
    { role: "agent", text: "Atlas replied: $1,840 OTD, $500 deposit, truck confirmed.", tier: "gemini-flash" },
    { role: "counterparty", text: "Bay Area: $2,140 OTD. Mayflower: $1,910." },
    { role: "agent", text: "Synthetic request submitted: quote outreach accepted; no mover is booked.", tier: "gemini-flash" },
  ],
  flight_book: [
    { role: "counterparty", text: "Google Flights SFO→AUS, May 31, 1 passenger." },
    { role: "agent", text: "Top 3: United $187 / 3h25m nonstop, Alaska $174 1-stop, SW $159 1-stop.", tier: "gemini-flash" },
    { role: "counterparty", text: "Pick top 3 sorted by price-duration tradeoff." },
    { role: "agent", text: "Synthetic request submitted: three sample booking links prepared; no flight is booked.", tier: "gemini-flash" },
  ],
  school_district: [
    { role: "counterparty", text: "AISD transfer office, this is Tara." },
    { role: "agent", text: "Initiating enrollment, child grade 4 transferring from SFUSD.", tier: "gemma-local" },
    { role: "counterparty", text: "Need immunization records + transcript. Records request sent?" },
    { role: "agent", text: "Synthetic request submitted: enrollment inquiry accepted; enrollment is not complete.", tier: "gemma-local" },
  ],
  pcp_transfer: [
    { role: "counterparty", text: "One Medical records team, this is Devon." },
    { role: "agent", text: "HIPAA release on file, route records to Austin PCP.", tier: "gemma-local" },
    { role: "counterparty", text: "Queued. ETA 7-10 business days." },
    { role: "agent", text: "Synthetic request submitted: records-transfer request accepted; transfer is not verified.", tier: "gemma-local" },
  ],
  vet_transfer: [
    { role: "counterparty", text: "SF Pet Clinic — pet's name?" },
    { role: "agent", text: "Captain, golden retriever, all vaccines current.", tier: "gemma-local" },
    { role: "counterparty", text: "Records sent to destination clinic." },
    { role: "agent", text: "Synthetic request submitted: vet-records request accepted; transfer is not verified.", tier: "gemma-local" },
  ],
  gym_cancel: [
    { role: "counterparty", text: "Equinox SF — verify member ID?" },
    { role: "agent", text: "Cancellation, May 31, moving out of state.", tier: "gemma-local" },
    { role: "counterparty", text: "Cancellation final after 30 days. Confirmation EQX-CN-882." },
    { role: "agent", text: "Synthetic request submitted: cancellation request accepted; termination is not verified.", tier: "gemma-local" },
  ],
  pharmacy: [
    { role: "counterparty", text: "cvs.com Transfer Prescriptions form open." },
    { role: "agent", text: "3 active scripts → CVS Austin store 8842, pickup by May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "Transfer queued. Confirmation?" },
    { role: "agent", text: "Synthetic request submitted: prescription-transfer request accepted; pickup is not verified.", tier: "gemma-local" },
  ],
  uscis_ar11: [
    { role: "counterparty", text: "uscis.gov/ar-11 form loaded." },
    { role: "agent", text: "A-number, name, old/new address, move date filled.", tier: "gemini-flash" },
    { role: "counterparty", text: "Signature step reached — pause for user." },
    { role: "agent", text: "Synthetic handoff prepared: sample form data is ready for the user; nothing was filed.", tier: "claude-opus" },
  ],
  id_card_update: [
    { role: "counterparty", text: "Lob certified-mail draft for DL-13A." },
    { role: "agent", text: "Letter to CA DMV Address Change Unit, PO Box 942869 Sacramento.", tier: "gemma-local" },
    { role: "counterparty", text: "Mailpiece accepted, USPS tracking 7019 0140 0000 9388 4471." },
    { role: "agent", text: "Synthetic request submitted: sample mail job accepted; delivery and signature are not verified.", tier: "gemma-local" },
  ],
  bank_notify: [
    { role: "counterparty", text: "AgentMail composing playbook to customer@example.com." },
    { role: "agent", text: "90-second bank script: number, exact wording, expected verification.", tier: "gemma-local" },
    { role: "counterparty", text: "AgentMail returned message_id <m07a91…@agentmail.to>." },
    { role: "agent", text: "Synthetic request submitted: sample bank-call playbook prepared; no bank change was made.", tier: "gemma-local" },
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

  out.push(
    {
      at_ms: 0,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id: "buyer",
        state: "calling",
        ts: 0,
      },
    },
    {
      at_ms: 120,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id: "buyer",
        state: "in-progress",
        ts: 0,
      },
    },
  );

  // Buyer turns (concierge → caller exchange before fan-out)
  const buyerTurns: Array<{ role: "user" | "agent"; text: string; tier?: "gemma-local" }> = [
    { role: "user", text: "Demo move: SF to Austin May 31 — two adults, one kid, one dog, one car, and I need the AR-11 address update." },
    { role: "agent", text: "Got it — full roster: pets, kids, car, visa. What email should confirmations hit?", tier: "gemma-local" },
    { role: "user", text: DEMO_SPEC.user_email },
    { role: "agent", text: "Dispatching all 16 specialists now. Hang up whenever — I'll keep working.", tier: "gemma-local" },
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

  out.push(
    {
      at_ms: 900,
      event: {
        type: "fields_collected",
        event_id: EVENT_ID,
        turn: 2,
        fields: [
          "origin_address",
          "destination_address",
          "move_date",
          "household_size",
          "has_pets",
          "has_children",
          "has_car",
          "has_visa",
        ],
        values: {
          origin_address: DEMO_SPEC.origin_address,
          destination_address: DEMO_SPEC.destination_address,
          move_date: DEMO_SPEC.move_date,
          household_size: DEMO_SPEC.household_size,
          has_pets: DEMO_SPEC.has_pets,
          has_children: DEMO_SPEC.has_children,
          has_car: DEMO_SPEC.has_car,
          has_visa: DEMO_SPEC.has_visa,
        },
        ts: 0,
      },
    },
    {
      at_ms: 1900,
      event: {
        type: "fields_collected",
        event_id: EVENT_ID,
        turn: 3,
        fields: ["user_email"],
        values: { user_email: DEMO_SPEC.user_email },
        ts: 0,
      },
    },
    {
      at_ms: 3300,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id: "buyer",
        state: "closed",
        ts: 0,
      },
    },
  );

  // After the buyer wraps, fan out: every specialist dispatches in a burst.
  const FAN_OUT_AT = 4000;
  const SPECIALIST_IDS = Object.keys(SCRIPTS).filter((agentId) => {
    if (agentId === "school_district") return DEMO_SPEC.has_children;
    if (agentId === "uscis_ar11") return DEMO_SPEC.has_visa;
    if (agentId === "geico_address" || agentId === "id_card_update") return DEMO_SPEC.has_car;
    if (agentId === "vet_transfer") return DEMO_SPEC.has_pets;
    return true;
  });
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
            reason: tierReason(step.tier),
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
        state: "submitted",
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
        pavo_cents: 0.0001 * (i + 1) * 8,
        baseline_cents: null,
        ts: 0,
      },
    });
  }

  const finalAt = Math.max(...out.map((item) => item.at_ms)) + 500;
  out.push({
    at_ms: finalAt,
    event: {
      type: "event_finalized",
      event_id: EVENT_ID,
      outcome: "submitted",
      summary: {
        submitted_count: SPECIALIST_IDS.length,
        failed_count: 0,
        summary_email_sent: false,
        memory_persisted: false,
      },
      ts: 0,
    },
  });

  return out.sort((a, b) => a.at_ms - b.at_ms);
}

function tierReason(tier: string): string {
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
