# Implementation status and build plan

Last audited: 2026-08-03

## Executive assessment

Relocate is a substantial hackathon prototype, not an empty scaffold. The
repository has a working orchestration model, a complete 17-persona roster,
provider adapter code, an interactive dashboard, a heuristic routing service,
and a safe mocked test path. Those pieces are enough to develop and demonstrate
the product locally.

It is not ready to handle real customers. The largest gaps are durable state,
background job execution, authenticated data intake, privacy and consent
controls, verified provider contracts, production deployment, and operational
monitoring. Provider adapter code is broader than the runtime's safe execution
policy and has not been proven by repeatable sandbox acceptance in CI. A
successful API submission also does not mean the underlying provider completed
the customer's task.

Status labels used below:

- **Built** — implemented and covered by local or mocked automated checks.
- **Partial** — a useful implementation exists, but a dependency or production
  requirement is missing.
- **Not built** — no production-capable implementation exists in this repo.

## Subsystem inventory

| Subsystem | Status | What exists | What is still required |
|---|---|---|---|
| Persona roster | **Built** | `orchestrator/app/personas.py`, the web roster, and `AGENT_COUNT.md` describe one buyer plus 16 specialists. A consistency test detects drift. | Replace dated provider details in prompts with configuration; version persona changes; review every target and claim with counsel/provider terms. |
| Buyer schema and collection | **Built (prototype)** | Incremental JSON extraction, field validation, core-field dispatch readiness, conditional flags, and a follow-up-email path. | Use structured model output instead of regex JSON extraction; add correction/overwrite semantics; add locale/date normalization; store consent and provenance for every field. |
| Inbound voice | **Partial** | AgentPhone provisioning scripts, a buyer webhook, streaming NDJSON replies, call lifecycle handling, and per-agent webhook secrets. | Contract-test the exact current AgentPhone webhook/signature format; add a stable hosted webhook, rate limits, vendor sandbox tests, retry/idempotency tests, and a human escalation path. A local `agents.json` is generated deployment state, not source. |
| Conditional specialist selection | **Built** | Pets, children, car, and visa flags select 11–16 specialists. Mocked tests cover full and reduced rosters. | Express prerequisites as data rather than scattered conditionals; surface why each agent was skipped or blocked. |
| Concurrent fan-out | **Built (single process)** | Async mode dispatch, state broadcasts, isolated specialist errors, and artifact capture. | Move work to a durable queue; add leases, retry policy, timeouts, cancellation, idempotency keys, outbox delivery, concurrency/rate controls per provider, and recovery after restart. |
| AgentMail paths | **Partial** | Six specialist email adapters exist; current policy permits mover, school, vet, gym, and bank submissions after declared prerequisites. PCP is blocked pending secure consent. | Build destination policy/allowlists, secure regulated-data transport, authorized sandbox delivery and inbound reply handling, bounce/complaint/threading, and async completion tracking. |
| Browser Use paths | **Partial, disabled** | Eight legacy v1 task builders and polling/result validators remain in source. Runtime specialist dispatch fails safe to `needs-user-action` before calling them. | Migrate to a protected-secrets-capable v2 contract; add delegated credentials, site-specific sandbox/recorded tests, approval before mutations/charges, MFA/CAPTCHA handling, target-change detection, reconciliation, and security review before re-enabling. |
| Lob postal-mail paths | **Partial, disabled** | Comcast and ID-card letter builders remain in source. Runtime policy blocks purchase before adapter invocation. | Add customer preview, valid signature/authorization, address validation, Lob test-mode contract coverage, idempotent purchase approval, delivery/return tracking, and final provider acknowledgement before re-enabling. |
| Memory/runbook integrations | **Partial** | Supermemory recall/persist and Moss retrieval adapters are called from orchestration. | Define retention/deletion rules, tenant isolation, data minimization, redaction, authorization, provider DPAs, failure policy, and contract tests. |
| Stripe/Sponge | **Partial/unused product path** | Sponsor adapter functions and dashboard events exist. | Define the actual payment/escrow product contract, connect it to an authenticated order, use only test mode until reviewed, add ledger/reconciliation/refunds/webhooks, or remove it from the shipping surface. |
| PAVO service | **Built (heuristic)** | Authenticated FastAPI API, request validation, deterministic routing, local/Gemini/Anthropic adapters, fallback behavior, cost configuration, health endpoints, and tests. | The learned router described in older project material is not here. To ship that claim, add licensed weights/training/evaluation artifacts and reproducible benchmarks. Otherwise market this component as a heuristic router. Add provider rate limiting and production telemetry. |
| Dashboard | **Built (demo + prototype live client)** | Static Next.js UI, demo replay, roster visualization, cost/artifact views, WebSocket state reduction, reconnect logic, and static export. | Host an authenticated backend; issue short-lived session-bound WebSocket credentials; add customer accounts, authorization per move, accessible state/error UX, audit history, and end-to-end live tests. Public static JavaScript must not contain long-lived secrets. |
| Webhook security | **Partial** | Fail-closed secret lookup, timestamp-bound HMAC comparison, header validation, and a bounded process-local replay cache. | Verify the signature construction against the vendor contract, store replay/idempotency records durably, rotate secrets, rate-limit endpoints, redact payload logs, and protect a multi-replica deployment. |
| Admin/dev trigger | **Partial** | Configuration supports disabling the synthetic trigger and separating admin/dashboard tokens. | Use real identity-aware admin auth, short-lived credentials, audit logs, environment policy, and network restrictions. Dev-only routes must be impossible to enable accidentally in production. |
| Persistence | **Not built** | Events and call contexts live in Python dictionaries. | PostgreSQL schema/migrations, encrypted sensitive fields, transactions, tenant/user ownership, retention/deletion jobs, backups, and restore drills. |
| Durable jobs | **Not built** | `asyncio.create_task` and in-request fan-out run in the API process. | Redis/SQS/Pub/Sub plus workers, retry/dead-letter queues, scheduled polling, idempotent handlers, graceful shutdown, and job observability. |
| Secure customer intake | **Not built** | The follow-up email refers to a future secure intake experience. | Authenticated one-time links, encrypted forms, expiry/revocation, field-level access policy, consent, validation, secrets isolation, and an alternative human-support path. Never collect passwords or full payment credentials in ordinary email. |
| Production observability | **Partial** | JSON logs, basic health responses, and dashboard events. | Correlation IDs, metrics, traces, SLOs, provider latency/error dashboards, PII-safe logging, alerting, on-call runbooks, synthetic checks, and cost/usage budgets. |
| CI and packaging | **Built (baseline)** | Locked Python dependencies, backend lint/type/test jobs, frontend lint/type/test/build jobs, secret/dependency review, container builds, and a static Pages workflow. | Add minimum coverage policy, container/image scanning, SBOM/signing, migration tests, load/security tests, provider sandbox schedules, protected branches, and release provenance. |
| Deployment | **Partial scaffold** | Three Dockerfiles, nginx static hosting, Compose health dependencies, loopback port binding, read-only backend filesystems, and local launch/preflight scripts. | A real hosting platform, TLS, secret manager, private networking, managed database/queue, WAF/rate limits, autoscaling, migrations, staged rollout, rollback, backups, and disaster recovery. |
| Legal/privacy/support | **Not built** | Prompts avoid soliciting some sensitive fields and docs describe prototype boundaries. | Terms, privacy notice, consent receipts, data-processing inventory, deletion/export workflow, vendor agreements, regulated-data review, accessibility review, incident response, customer support, and explicit approval for irreversible actions. |

## Agent-by-agent reality

The table describes code paths, not a claim that each target institution accepts
automated action. Provider acceptance must use accounts and identities the
operator is authorized to exercise.

| Agent | Implemented path | Current evidence | Before production |
|---|---|---|---|
| `buyer` | AgentPhone inbound webhook → PAVO completion → field merge → fan-out | Local unit/mocked behavior and provisioning code | Vendor contract test, real sandbox number, durable call state, consent, human handoff |
| `pge_shutoff` | Retained Browser v1 stop-service builder; runtime blocked | Mocked `needs-user-action` policy test | Protected-secrets v2 migration, authorized test account, MFA/identity policy, preview, verified final status |
| `comcast_cancel` | Retained Lob cancellation builder; runtime blocked | Mocked signature/policy-block test | Test-mode preview, user signature/approval policy, delivery and acknowledgement tracking |
| `geico_address` | Retained Browser v1 address-update builder; runtime blocked | Mocked `needs-user-action` policy test | Delegated auth/secure vault, v2 migration, MFA handling, final policy verification |
| `usps_coa` | Retained Browser v1 change-of-address builder; runtime blocked | Mocked `needs-user-action` policy test | Explicit purchase approval, secure payment mechanism, v2 migration, authorized test, refund/error policy |
| `spectrum_austin` | Retained Browser v1 order builder; runtime blocked | Mocked `needs-user-action` policy test | Price/contract disclosure, explicit order approval, v2 migration, cancellation path, confirmed order state |
| `mover_quote` | Three AgentMail quote requests | Email adapter + mocked IDs | Valid recipient policy, reply ingestion, quote normalization, spam/abuse controls |
| `school_district` | AgentMail enrollment inquiry | Email adapter + mocked ID | Minimize child data, obtain guardian consent, confirm district intake channel and retention policy |
| `pcp_transfer` | PDF/email builders retained; runtime blocked | Mocked secure-consent policy-block test | Legally valid patient authorization, secure transport, regulated-data/vendor review, receipt/completion tracking |
| `vet_transfer` | AgentMail records request | Email adapter + mocked ID | Confirm owner authorization, correct source/destination, reply/completion tracking |
| `gym_cancel` | AgentMail written cancellation | Email adapter + mocked ID | Verify contractual notice channel, approval, delivery and final cancellation confirmation |
| `pharmacy` | Browser/email builders retained; runtime blocked | Mocked regulated-workflow policy-block test | Secure prescription-data intake, provider/compliance review, user verification, actual pickup status |
| `flight_book` | Retained Browser v1 search builder; runtime blocked | Mocked `needs-user-action` policy test | Protected-secrets v2 migration; keep search-only unless fare disclosure and purchase approval are built |
| `water_board` | Retained Browser v1 stop-service builder; runtime blocked | Mocked `needs-user-action` policy test | V2 migration, regional provider configuration, authorized account, confirmation and final-bill handling |
| `uscis_ar11` | Retained Browser v1 preparation builder; runtime blocked | Mocked `needs-user-action` policy test | V2 migration, legal review, authoritative form/version tracking, signed/accepted evidence |
| `id_card_update` | Retained Lob letter/form builder; runtime blocked | Mocked signature/policy-block test | Confirm jurisdiction and valid channel, user signature/approval, delivery and agency acceptance |
| `bank_notify` | AgentMail call script for the user | Email adapter + mocked ID | Keep it explicitly human-led; do not accept banking credentials; verify content and accessibility |

## What the automated tests establish

The default backend suite is deliberately side-effect free. It establishes:

- the roster agrees across Python, TypeScript, and documentation;
- routing heuristics select the expected tier for representative turns;
- all-condition fan-out creates all 16 specialist contexts;
- conditional fan-out omits inapplicable specialists;
- permitted mocked provider artifacts reach `submitted`, never implicit success;
- unsafe, obsolete, or insufficiently specified paths reach
  `needs-user-action` rather than a fabricated fallback;
- provider errors remain visible instead of becoming fabricated success.

It does **not** establish live phone pickup, email delivery, browser transaction
completion, postal delivery, government acceptance, target-site terms, model
quality, benchmark claims, or production security.

The separate `provider_acceptance` test exercises only the five currently
permitted AgentMail submissions and proves the disabled Browser/Lob/regulated
paths remain blocked. It is skipped unless two environment gates, an explicit
allowlist for every outbound address, a sandbox confirmation, and an ignored or
out-of-repository authorized spec are supplied. It can still have real-world
effects and must remain outside ordinary CI.

## Ordered plan to build the product

### Phase 0 — freeze an honest baseline

Deliverables:

1. Keep normal CI green across lint, typing, unit/mocked tests, static build,
   secret scanning, and container build.
2. Treat this file and `AGENT_COUNT.md` as the public capability contract.
3. Remove quantitative routing, cost, latency, delivery, and provider claims
   unless a reproducible artifact and date are linked.
4. Separate UI states for demo replay, request submitted, needs user action,
   completed, and failed.

Exit criteria: a new contributor can run the safe suite without credentials,
and no default command contacts or charges a provider.

### Phase 1 — define the domain and outcome contract

Deliverables:

1. Define `Move`, `Task`, `Attempt`, `Artifact`, `Consent`, `Approval`, and
   `ProviderEvent` schemas with versioned state transitions.
2. Define terminal outcomes such as `succeeded`, `needs_user_action`, `blocked`,
   `cancelled`, and `failed`; do not use “closed” as a proxy for success.
3. Specify prerequisites, sensitive fields, side effects, approval rules,
   idempotency keys, and evidence requirements for every specialist as data.
4. Decide which agents merely prepare or notify and which are allowed to submit
   or purchase.

Exit criteria: every state and artifact shown in the dashboard has an
unambiguous server-side meaning and test.

### Phase 2 — build the durable control plane

Deliverables:

1. Add PostgreSQL migrations and repositories for the domain objects.
2. Add a durable queue and worker service for fan-out, polling, retries, and
   scheduled follow-up.
3. Implement transactional outbox/inbox patterns and provider idempotency.
4. Add per-provider concurrency limits, bounded retries with jitter, timeouts,
   cancellation, and dead-letter handling.
5. Make API instances stateless and prove restart/replay recovery.

Exit criteria: killing an API or worker during a 16-specialist run neither loses
work nor duplicates an irreversible side effect.

### Phase 3 — build identity, consent, and secure intake

Deliverables:

1. Add user accounts or verified, expiring, one-time move links.
2. Replace emailed field collection with an authenticated encrypted form.
3. Store provider credentials in a secrets manager or delegated OAuth vault;
   never in prompts, email, logs, or ordinary move JSON.
4. Encrypt sensitive fields, apply tenant-scoped authorization, redact logs,
   and implement retention, export, and deletion workflows.
5. Capture explicit consent and per-action approval, including price and target,
   before mail, account mutation, or payment.
6. Complete privacy, regulated-data, and vendor agreement review.

Exit criteria: an authorization test suite proves one customer cannot access
another move, and sensitive values never appear in telemetry or client bundles.

### Phase 4 — harden one narrow provider wedge

Do not attempt to productionize all 16 specialists at once. Start with low-risk,
reversible notification or quote flows.

Deliverables:

1. Select two or three providers with documented sandbox/test support.
2. Build typed provider clients and recorded/contract fixtures.
3. Add destination allowlists, approval previews, structured result validation,
   callback/polling reconciliation, and human escalation.
4. Run a scheduled sandbox acceptance suite and measure success by final
   provider state, not only request ID.
5. Put every remaining specialist behind a feature flag labeled preview.

Exit criteria: repeated authorized sandbox runs meet a defined success SLO and
produce auditable evidence without manual database repair.

### Phase 5 — ship the authenticated customer experience

Deliverables:

1. Add a server-backed dashboard route scoped to the signed-in customer/move.
2. Issue short-lived WebSocket credentials after HTTPS authentication; do not
   bake long-lived tokens into static JavaScript or URLs.
3. Add approval, cancel, retry, correction, and human-support controls.
4. Make replay/demo mode visually and semantically separate from live mode.
5. Complete keyboard, screen-reader, reduced-motion, mobile, and error-state QA.

Exit criteria: end-to-end tests cover sign-in through a safe provider task and
another user cannot observe its transcript or artifact.

### Phase 6 — production platform and operations

Deliverables:

1. Deploy API/workers behind TLS with private PAVO/database/queue networking,
   managed secrets, WAF/rate limits, and environment isolation.
2. Add migration gates, image scanning, SBOM/provenance, staged rollout,
   canary checks, and automatic rollback.
3. Add traces, metrics, redacted structured logs, provider/cost dashboards,
   SLO alerts, audit logs, and incident runbooks.
4. Add backups, point-in-time restore, disaster-recovery drills, capacity/load
   tests, and provider outage exercises.

Exit criteria: staging passes load, security, recovery, and provider-failure
drills; production can be rolled back without losing or duplicating tasks.

### Phase 7 — limited launch, then expand

Deliverables:

1. Complete terms, privacy notice, support and incident processes, provider
   permissions, and any required legal/compliance review.
2. Launch to an invited cohort with only the hardened specialist wedge.
3. Measure task success, user corrections, human interventions, provider
   failures, cost, and deletion/support outcomes.
4. Add specialists one at a time only after the same acceptance bar is met.

Exit criteria: production evidence—not dashboard animation or submission
IDs—shows the chosen tasks complete reliably and safely for real users.

## Suggested sequencing and staffing

The critical path is domain contract → durable jobs/state → identity and secure
intake → narrow provider acceptance → authenticated UI → production operations.
UI polish and additional personas should not outrun those foundations. A small
team should assign clear ownership for backend/workflows, provider integrations,
frontend/product, infrastructure/security, and legal/operations; one person may
cover multiple roles early, but each launch gate still needs an accountable
owner.
