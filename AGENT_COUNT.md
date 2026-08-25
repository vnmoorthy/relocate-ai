# Agent roster

The configured roster contains **17 personas: one inbound buyer plus 16
specialists**. This is a code/configuration count, not evidence that 17 external
transactions have been completed.

`orchestrator/app/personas.py` is the runtime source. A test requires its IDs to
match this numbered table and `web/src/lib/types.ts`. When a generated,
gitignored `orchestrator/agents.json` exists, the test also checks that registry.

## Configured roster

| # | `agent_id` | category | mode | intended output |
|---:|---|---|---|---|
| 1 | `buyer` | concierge | inbound voice | collected move fields and a dispatched event |
| 2 | `pge_shutoff` | electric/gas utility | browser | provider task plus stop-service result fields |
| 3 | `comcast_cancel` | internet cancellation | postal mail | Lob letter/tracking identifiers |
| 4 | `geico_address` | auto insurance | browser | provider task plus address-change result fields |
| 5 | `usps_coa` | postal forwarding | browser | provider task plus COA result fields |
| 6 | `spectrum_austin` | destination internet | browser | provider task plus order result fields |
| 7 | `mover_quote` | mover quotes | email | AgentMail identifiers for three quote requests |
| 8 | `school_district` | school enrollment inquiry | email | AgentMail identifier |
| 9 | `pcp_transfer` | medical records request | email | AgentMail identifier and generated release attachment |
| 10 | `vet_transfer` | veterinary records request | email | AgentMail identifier |
| 11 | `gym_cancel` | membership cancellation | email | AgentMail identifier |
| 12 | `pharmacy` | prescription transfer | browser adapter (disabled) | secure patient-authorized workflow required |
| 13 | `flight_book` | flight search | email | AgentMail identifier for a personalized Google Flights deeplink; booking stays with the user |
| 14 | `water_board` | water utility | browser | provider task plus stop-service result fields |
| 15 | `uscis_ar11` | immigration form preparation | browser | provider task and user-signature handoff; not filing proof |
| 16 | `id_card_update` | ID update package | postal mail | Lob letter/tracking identifiers and user-action handoff |
| 17 | `bank_notify` | bank notification playbook | email | AgentMail identifier for a human-led call script |

Mode totals:

- 1 inbound voice persona;
- 7 browser specialists;
- 7 email specialists;
- 2 postal-mail specialists.

## Conditional dispatch

`marketplace.pick_specialists` starts with 11 unconditional specialists:

`pge_shutoff`, `comcast_cancel`, `usps_coa`, `spectrum_austin`, `mover_quote`,
`pcp_transfer`, `gym_cancel`, `pharmacy`, `flight_book`, `water_board`, and
`bank_notify`.

It then adds:

- `vet_transfer` when `has_pets=true`;
- `school_district` when `has_children=true`;
- `geico_address` and `id_card_update` when `has_car=true`;
- `uscis_ar11` when `has_visa=true`.

Therefore a move launches 11–16 specialists (12–17 personas including the
buyer). A pet-owning parent with a car but no visa launches 15 specialists; the
same move with `has_visa=true` launches all 16.

## Capability versus availability

The roster remains configured even when provider keys are missing. Runtime
availability depends on:

- `AGENTPHONE_API_KEY` and a provisioned `agents.json` for inbound voice;
- `PAVO_API_KEY` plus at least one reachable completion provider;
- `AGENTMAIL_API_KEY` for email specialists and emailed playbooks;
- `BROWSERUSE_API_KEY` is not sufficient to enable execution: the retained v1
  adapter is policy-blocked pending a protected-secrets v2 migration;
- `LOB_API_KEY` is not sufficient to enable execution: both postal-mail paths
  require a customer-reviewed signature/approval workflow;
- appropriate authorized provider accounts, required input fields, consent,
  target availability, and user approval.

Blocked Browser Use, Lob, PCP, and pharmacy paths remain
`needs-user-action`; missing providers are not relabeled as successful
playbooks. The bank-notification persona is intentionally a human-led script,
not a fallback completion.

Normal CI mocks every provider boundary. The explicitly gated provider suite
currently checks only the five permitted AgentMail submissions and asserts all
policy-disabled paths remain blocked. A submitted message is still not final
provider completion.

## Historical removals

These earlier IDs are intentionally absent:

| `agent_id` | reason |
|---|---|
| `wells_fargo` | Direct bank login, SSN, and 2FA handling is outside the current safe execution scope; `bank_notify` is human-led. |
| `subscriptions` | A multi-service credential/CAPTCHA sweep was too broad and fragile. |
| `ca_dmv` | The prior direct identity-bound portal concept was removed; `id_card_update` is a mail/user-action preparation flow. |
| `ca_voter` | Identity-bound voter registration is outside the current scope. |

For implementation maturity and the work required before launch, see
[STATUS.md](STATUS.md#agent-by-agent-reality).
