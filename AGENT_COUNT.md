# Agent count (canonical)

> **17 agents.** 1 inbound buyer + 16 outbound specialists.
>
> This file is the single source of truth for the shipping count. Any other
> document (README, DEMO_SCRIPT, pitch slides, the swarm-stage layout) that
> states a different number is out of date — update it to match this file.

History:

- **v1 (2026-05-17, hackathon submission):** 16 agents claimed; ~7 fired live,
  several were stubs.
- **v2 (post NUCLEAR_FIX_PROMPT):** consolidated to 12 strict-real-world agents
  by removing `wells_fargo`, `subscriptions`, `ca_dmv`, `ca_voter`.
- **v2.1 (current):** added 5 more agents that pass the four-question test on
  alternative substrates — `flight_book` (Google Flights via Browser Use),
  `water_board` (SFPUC portal via Browser Use), `uscis_ar11` (Browser Use to
  signature-step then customer signs), `id_card_update` (Lob certified mail
  of DL-13A) and `bank_notify` (AgentMail with a 90-second call script the
  customer reads to their bank). Total: 17.

## The 17 shipping agents

| # | `agent_id` | category | mode | real-world artifact | sponsor required |
|---|---|---|---|---|---|
| 1 | `buyer` | concierge | voice (inbound) | spec extracted + Supermemory persist + AgentMail PDF | AgentPhone, AgentMail, Supermemory |
| 2 | `pge_shutoff` | utility (electric/gas) | browser | PG&E confirmation number from pge.com/movingcenter | Browser Use |
| 3 | `comcast_cancel` | utility (internet SF) | mail | Lob letter ID + USPS tracking number | Lob |
| 4 | `geico_address` | insurance (auto) | browser | Geico reference + updated declarations PDF | Browser Use |
| 5 | `usps_coa` | postal | browser | USPS confirmation number + $1.10 charge | Browser Use + prepaid card |
| 6 | `spectrum_austin` | utility (internet Austin) | browser | Spectrum order number + work-order ID | Browser Use |
| 7 | `mover_quote` | mover | email | 3 AgentMail outbound IDs to U-Haul, PODS, Two Men | AgentMail |
| 8 | `school_district` | school | email | AgentMail ID to enroll@austinisd.org | AgentMail |
| 9 | `pcp_transfer` | medical records | email | AgentMail ID + HIPAA release PDF attached | AgentMail |
| 10 | `vet_transfer` | vet | email | AgentMail ID to current vet | AgentMail |
| 11 | `gym_cancel` | gym | email | AgentMail ID to memberservices@equinox.com | AgentMail |
| 12 | `pharmacy` | pharmacy | browser | CVS transfer confirmation + pickup ETA (or AgentMail fallback) | Browser Use |
| 13 | `flight_book` | flight | browser | Top-3 Google Flights with click-to-book deeplinks | Browser Use |
| 14 | `water_board` | utility (water) | browser | SFPUC stop-service confirmation + final-meter date | Browser Use |
| 15 | `uscis_ar11` | immigration | browser | Pre-filled AR-11 + resume URL for customer to wet-sign | Browser Use |
| 16 | `id_card_update` | DMV ID | mail | Lob certified DL-13A + USPS tracking | Lob |
| 17 | `bank_notify` | bank | email | AgentMail with 90-second bank-call playbook the customer reads | AgentMail |

## Removed agents (4)

| `agent_id` | reason |
|---|---|
| `wells_fargo` | Direct bank-login was a security non-starter. Replaced by `bank_notify` (sends customer a 90-second call script instead). |
| `subscriptions` | Requires 5 sets of consumer creds + CAPTCHAs — too fragile to pass strict-real-world bar. |
| `ca_dmv` | Online portal requires real CA DL holder's identity. Replaced by `id_card_update` (mails DL-13A form for wet-signature). |
| `ca_voter` | Same identity bar as `ca_dmv`; no satisfactory mail-form alternative. |

The full audit verdict per agent lives in `orchestrator/AUDIT.md`.

## Conditional dispatch

Not every shipping agent fires on every move. `marketplace.pick_specialists`
applies these filters:

- Default agents (always fire when reachable): `pge_shutoff`, `comcast_cancel`,
  `usps_coa`, `spectrum_austin`, `mover_quote`, `pcp_transfer`, `pharmacy`,
  `bank_notify`, `water_board`, `flight_book`.
- `vet_transfer` — `requires_pets=True`.
- `school_district` — `requires_children=True`.
- `geico_address`, `id_card_update` — `requires_car=True`.
- `uscis_ar11` — `requires_visa=True` (international caller only).

A typical "2BR, kids, dog, car, citizen" move fires 16 specialists. A typical
visa-holder move fires all 16. A typical "single, no kids, no pets, citizen"
move fires 12.

## Keys required to make all 17 pass

- `AGENTPHONE_API_KEY` — buyer inbound. Already present.
- `AGENTMAIL_API_KEY` — 6 email agents + buyer's PDF receipt. Already present.
- `BROWSER_USE_API_KEY` — gates 8 agents (pge, geico, usps, spectrum, pharmacy,
  flight, water, uscis). **Acquire at** <https://browser-use.com>.
- `LOB_API_KEY` — gates 2 agents (comcast, id_card_update). **Acquire at**
  <https://lob.com> (~$1.40 per certified letter).
- `SUPERMEMORY_API_KEY` — buyer recall + persist. Already present.

Without Browser Use + Lob, the shipping set degrades to **7 agents** (buyer +
6 email-based). The roster still says 17; the test still expects 17; the build
fails — exactly as designed. Acquire the keys or remove the agents that depend
on them from `personas.PERSONAS`.
