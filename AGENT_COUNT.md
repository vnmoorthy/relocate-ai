# Agent count (canonical)

> **12 agents.** 1 inbound buyer + 11 outbound specialists.
>
> This file is the single source of truth for the shipping count. Any other
> document (README, DEMO_SCRIPT, pitch slides, the swarm-stage layout) that
> states a different number is out of date — update it to match this file.

History:

- **v1 (2026-05-17, hackathon submission):** 16 agents claimed; ~7 fired live,
  several were stubs.
- **v2 (post NUCLEAR_FIX_PROMPT):** 12 agents shipping, all with verifiable
  real-world artifacts. See `orchestrator/AUDIT.md` for the four-question
  test per agent and the removal rationale.

## The 12 shipping agents

| # | `agent_id` | category | mode | real-world artifact | sponsor sponsor required |
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

## Removed agents (4)

| `agent_id` | reason |
|---|---|
| `wells_fargo` | Bank address change requires SSN + bank login + 2FA — security non-starter for AI. |
| `subscriptions` | Requires 5 sets of consumer creds + CAPTCHAs — too fragile to pass strict-real-world bar. |
| `ca_dmv` | Requires real CA driver-license-holder identity — privacy non-starter on every demo run. |
| `ca_voter` | Same identity bar as `ca_dmv`. |

The full audit verdict per agent lives in `orchestrator/AUDIT.md`.

## Conditional dispatch

Not every shipping agent fires on every move. `marketplace.pick_specialists`
applies these filters:

- `pcp_transfer`, `pharmacy`, `gym_cancel` — fire on every move.
- `vet_transfer` — fires only when `has_pets=True` (suppressed otherwise).
- `school_district` — fires only when `has_children=True`.
- `geico_address` — fires only when `has_car=True` (default True).

A typical "2BR, no kids, no pets, no car" move fires 8 specialists. The full
12-of-12 run requires `has_pets=True ∧ has_children=True ∧ has_car=True` —
that's exactly the spec the e2e test sends.

## Keys required to make 12-of-12 pass

- `AGENTPHONE_API_KEY` — buyer inbound. Already present.
- `AGENTMAIL_API_KEY` — 5 email agents + buyer's PDF receipt. Already present.
- `BROWSER_USE_API_KEY` — gates 5 agents (pge, geico, usps, spectrum, pharmacy).
  **Not yet present** — acquire at <https://browser-use.com>.
- `LOB_API_KEY` — gates 1 agent (comcast). **Not yet present** — acquire at
  <https://lob.com> (live key; ~$1.40 per certified letter).
- `SUPERMEMORY_API_KEY` — buyer recall + persist. Already present.

Without Browser Use + Lob, the shipping set degrades to **6 agents** (buyer +
5 email-based + mover quotes). The roster still says 12; the test still
expects 12; the build fails — exactly as designed.
