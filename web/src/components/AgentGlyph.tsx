import type { ReactElement } from "react";

/**
 * Agent glyphs — one 13px stroke icon per roster agent, hand-authored on a
 * shared 24×24 grid. Consistent geometry: strokeWidth 1.6, round caps/joins,
 * currentColor stroke, no fills. Color is inherited (mission-control ink by
 * default; the node's semantic accent when hot) so the glyph itself stays
 * monochrome-disciplined.
 */
const GLYPHS: Record<string, ReactElement> = {
  // Concierge — voice waveform
  buyer: <path d="M4 10v4M8 7.5v9M12 4.5v15M16 7.5v9M20 10v4" />,

  // PG&E — lightning bolt
  pge_shutoff: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,

  // Water board — droplet
  water_board: <path d="M12 2.8 17.3 8.1a7.5 7.5 0 1 1-10.6 0L12 2.8Z" />,

  // Comcast cancel — wifi-off (arcs + slash)
  comcast_cancel: (
    <>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
      <path d="M4 4.5 20 19.5" />
    </>
  ),

  // Spectrum — wifi
  spectrum_austin: (
    <>
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
    </>
  ),

  // Geico — shield
  geico_address: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,

  // USPS — envelope
  usps_coa: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.8" />
      <path d="m3.6 7.2 8.4 6 8.4-6" />
    </>
  ),

  // Movers — truck
  mover_quote: (
    <>
      <rect x="2" y="6" width="12.5" height="9" rx="1" />
      <path d="M14.5 9.5h3.7l3.3 3.3V15h-7" />
      <circle cx="7" cy="17.7" r="1.8" />
      <circle cx="17" cy="17.7" r="1.8" />
    </>
  ),

  // School district — graduation cap
  school_district: (
    <>
      <path d="M2 9.8 12 5l10 4.8-10 4.8L2 9.8Z" />
      <path d="M6.2 12.5v4c3.3 2.7 8.3 2.7 11.6 0v-4" />
      <path d="M22 9.8v4.7" />
    </>
  ),

  // PCP transfer — medical cross in circle
  pcp_transfer: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </>
  ),

  // Vet transfer — paw
  vet_transfer: (
    <>
      <circle cx="5.8" cy="10.2" r="1.5" />
      <circle cx="9.8" cy="6.8" r="1.5" />
      <circle cx="14.2" cy="6.8" r="1.5" />
      <circle cx="18.2" cy="10.2" r="1.5" />
      <path d="M12 11.5c-2.8 0-5.2 2.3-5.2 4.6 0 1.5 1.2 2.4 2.5 2.4 1.1 0 1.7-.6 2.7-.6s1.6.6 2.7.6c1.3 0 2.5-.9 2.5-2.4 0-2.3-2.4-4.6-5.2-4.6Z" />
    </>
  ),

  // Gym cancel — dumbbell
  gym_cancel: (
    <>
      <path d="M2.8 10v4M21.2 10v4" />
      <rect x="4.6" y="7.6" width="3" height="8.8" rx="1.2" />
      <rect x="16.4" y="7.6" width="3" height="8.8" rx="1.2" />
      <path d="M7.6 12h8.8" />
    </>
  ),

  // Pharmacy — capsule
  pharmacy: (
    <>
      <path d="M10.5 20.5 3.5 13.5a4.95 4.95 0 1 1 7-7l7 7a4.95 4.95 0 1 1-7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </>
  ),

  // Flights — plane
  flight_book: (
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />
  ),

  // USCIS AR-11 — document with lines
  uscis_ar11: (
    <>
      <path d="M14 3H7a1.8 1.8 0 0 0-1.8 1.8v14.4A1.8 1.8 0 0 0 7 21h10a1.8 1.8 0 0 0 1.8-1.8V7.8L14 3Z" />
      <path d="M14 3v4.8h4.8" />
      <path d="M8.8 12.6h6.4M8.8 16.2h6.4" />
    </>
  ),

  // DMV — id card
  id_card_update: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8" cy="10.8" r="1.9" />
      <path d="M5.2 15.8c.5-1.7 1.5-2.5 2.8-2.5s2.3.8 2.8 2.5" />
      <path d="M13.8 9.8h4.7M13.8 13.4h4.7" />
    </>
  ),

  // Bank — bank columns
  bank_notify: (
    <>
      <path d="M12 3 20.2 7.8H3.8L12 3Z" />
      <path d="M5.6 10.8v6.4M9.8 10.8v6.4M14.2 10.8v6.4M18.4 10.8v6.4" />
      <path d="M3.5 20.5h17" />
    </>
  ),

  // ── Prepared-artifact specialists ───────────────────────────────────────

  // Housing search — roof + walls + door
  housing_search: (
    <>
      <path d="M3.2 11.3 12 4.2l8.8 7.1" />
      <path d="M5.6 9.4V20.2h12.8V9.4" />
      <path d="M9.9 20.2v-5.3h4.2v5.3" />
    </>
  ),

  // Arrival transport — car (flat body + cabin + wheels; the mover truck is a
  // stepped box, so the curved cabin is what tells them apart at 13px)
  arrival_transport: (
    <>
      <path d="M6 14.2 8 9.4a1.7 1.7 0 0 1 1.6-1h4.8a1.7 1.7 0 0 1 1.6 1l2 4.8" />
      <path d="M3.4 14.2h17.2v3.4H3.4z" />
      <circle cx="7.6" cy="17.9" r="1.5" />
      <circle cx="16.4" cy="17.9" r="1.5" />
    </>
  ),

  // Mobile carrier — handset + signal arcs
  mobile_carrier: (
    <>
      <rect x="4.4" y="3" width="8.6" height="18" rx="1.9" />
      <path d="M7.9 18.2h1.6" />
      <path d="M16.2 9.1a4.6 4.6 0 0 1 0 5.8" />
      <path d="M19.2 6.2a8.6 8.6 0 0 1 0 11.6" />
    </>
  ),

  // Government records — domed civic building
  gov_address_update: (
    <>
      <path d="M12 2.4v2" />
      <path d="M7.6 10.4a4.4 4.4 0 0 1 8.8 0" />
      <path d="M4.6 12.9h14.8" />
      <path d="M7.2 12.9v6.2M12 12.9v6.2M16.8 12.9v6.2" />
      <path d="M3.6 19.5h16.8" />
    </>
  ),

  // Visa support — passport book with an approval seal
  visa_support: (
    <>
      <rect x="4.8" y="2.9" width="14.4" height="18.2" rx="2" />
      <path d="M8.4 6.5h7.2" />
      <circle cx="12" cy="14" r="3.7" />
      <path d="m10.2 14 1.3 1.4 2.7-2.9" />
    </>
  ),

  // Landlord notice — key
  landlord_notice: (
    <>
      <circle cx="8.1" cy="8.4" r="3.7" />
      <path d="m10.8 11.1 8.4 8.4" />
      <path d="m17.2 15.5-1.9 1.9" />
      <path d="m19.2 17.5-1.9 1.9" />
    </>
  ),

  // International banking — globe + banknote
  intl_banking: (
    <>
      <circle cx="9.9" cy="9.8" r="6.3" />
      <path d="M3.6 9.8h12.6" />
      <path d="M9.9 3.5c2.5 3.6 2.5 8.9 0 12.6-2.5-3.7-2.5-9 0-12.6Z" />
      <rect x="12.6" y="15" width="8.8" height="5.7" rx="1.1" />
    </>
  ),

  // FX planning — paired exchange arrows
  fx_planning: (
    <>
      <path d="M3.6 8.6h13.6" />
      <path d="m13.8 5.2 3.4 3.4-3.4 3.4" />
      <path d="M20.4 15.4H6.8" />
      <path d="m10.2 12-3.4 3.4 3.4 3.4" />
    </>
  ),

  // Contacts — two figures
  contacts_notify: (
    <>
      <circle cx="9.1" cy="7.9" r="3.3" />
      <path d="M3.4 19.6c0-3.4 2.6-5.7 5.7-5.7s5.7 2.3 5.7 5.7" />
      <circle cx="17.3" cy="8.8" r="2.4" />
      <path d="M16.1 13.7c2.8-.4 4.7 1.8 4.7 5" />
    </>
  ),

  // Grocery setup — shopping bag
  grocery_setup: (
    <>
      <path d="M8.8 8.2V6.3a3.2 3.2 0 0 1 6.4 0v1.9" />
      <path d="M4.7 8.2h14.6l-1.2 11.3a1.8 1.8 0 0 1-1.8 1.6H7.7a1.8 1.8 0 0 1-1.8-1.6L4.7 8.2Z" />
      <path d="M9.4 11.4v1.9M14.6 11.4v1.9" />
    </>
  ),

  // Commute route — routed path between two stops
  commute_route: (
    <>
      <path d="M6.2 6.4h5.6a3.4 3.4 0 0 1 0 6.8H9.4a3.4 3.4 0 0 0 0 6.8h6.2" />
      <circle cx="4.3" cy="6.4" r="1.7" />
      <circle cx="17.5" cy="20" r="1.7" />
    </>
  ),

  // Furniture setup — armchair
  furniture_setup: (
    <>
      <path d="M5.7 11.6V7.9a2.6 2.6 0 0 1 2.6-2.6h7.4a2.6 2.6 0 0 1 2.6 2.6v3.7" />
      <path d="M4 15.3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5H4Z" />
      <path d="M6.2 17.8v2.3M17.8 17.8v2.3" />
    </>
  ),
};

/** Generic node marker for any id outside the known roster. */
const FALLBACK: ReactElement = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 12h.01" />
  </>
);

interface Props {
  agentId: string;
  className?: string;
}

export function AgentGlyph({ agentId, className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[agentId] ?? FALLBACK}
    </svg>
  );
}
