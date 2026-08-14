import type { ReactElement } from "react";

/**
 * Agent glyphs — one 16px stroke icon per roster agent, hand-authored on a
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
