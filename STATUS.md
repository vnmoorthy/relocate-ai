# Implementation status and build plan

Last audited: 2026-08-25

## Executive assessment

Relocate is in developer preview. The repository ships a working voice intake
line, a gated public web intake, a complete 17-persona roster, real
allowlist-gated email dispatch with closed-loop reply ingestion, prepared
playbooks and rendered signature documents for everything the system refuses
to do unsafely, durable single-node persistence, an interactive dashboard, a
redacted public live feed with a shareable per-move tracker, a heuristic
routing service, and a side-effect-free mocked test path. Those pieces
support the full demo flow end to end today: call → collect → fan-out →
real emails → replies threaded back → tracker updates live.

It is not yet ready to handle real customers at scale. The remaining work is
durable background job execution, multi-replica state, authenticated data
intake, privacy and consent controls, verified provider contracts, real
hosting, and operational monitoring; the phased plan below sequences it. A
successful API submission also does not mean the underlying provider
completed the customer's task — the product surfaces that distinction
everywhere.

## How it is hosted today

Be precise about this, because it is the biggest gap between "works" and
"production":

- The orchestrator, PAVO, and dashboard run on a single laptop via
  `./run.sh`; `./demo-line.sh` supervises the always-on phone line
  (+1 618 414-9537): it keeps the Mac awake, keeps Ollama warm, keeps the
  stack up, and maintains a **cloudflared quick tunnel** whose URL rotates
  whenever the tunnel restarts.
- On rotation the supervisor re-points the AgentPhone webhook automatically
  and rewrites `web/public/live.json` locally. The deployed GitHub Pages
  site discovers the API through that file, so **the site reconnects only
  after `live.json` is committed and the Pages deploy republishes** — a
  deliberate manual step, flagged loudly in the supervisor log.
- The phone line and the live site therefore die when the laptop sleeps, is
  offline, or the supervisor stops. That is acceptable for a supervised
  developer preview and nothing more.
- The production step is a **named tunnel or a cloud host** (stable HTTPS
  origin, no discovery-file republish churn), then the platform work in
  Phase 6.

Status labels used below:

- **Built** — implemented and covered by local or mocked automated checks.
- **Partial** — a useful implementation exists, but a dependency or production
  requirement is missing.
- **Not built** — no production-capable implementation exists in this repo.

## Subsystem inventory

| Subsystem | Status | What exists | What is still required |
|---|---|---|---|
| Persona roster | **Built** | `orchestrator/app/personas.py`, the web roster, and `AGENT_COUNT.md` describe one buyer plus 16 specialists (7 browser, 7 email, 2 postal). A consistency test detects drift. | Replace dated provider details in prompts with configuration; version persona changes; review every target and claim with counsel/provider terms. |
| Buyer schema and collection | **Built (preview)** | Incremental JSON extraction, per-turn field validation, an anti-regurgitation guard (example-copied values are detected and dropped; core-field copies are dropped on a single match), core-field dispatch readiness, conditional flags, a follow-up-email path, and call-end dispatch: a core-complete call that ends before the household questions still fans out with what was confirmed. A turn still in flight at hang-up re-runs the end-of-call dispatch after its fields merge. | Use structured model output instead of regex JSON extraction; add locale/date normalization; store consent and provenance for every field. |
| Inbound voice | **Partial** | A live demo line: AgentPhone provisioning scripts, a buyer webhook, streaming NDJSON replies, call lifecycle handling, per-agent webhook secrets, and the `demo-line.sh` supervisor that keeps the chain alive over a rotating quick tunnel. | A stable hosted webhook (named tunnel or cloud host), contract tests against the exact current AgentPhone webhook/signature format, vendor sandbox tests, and a human escalation path. A local `agents.json` is generated deployment state, not source. |
| Public web intake | **Built (gated)** | `POST /api/public/start-move`, off by default (`ENABLE_PUBLIC_INTAKE`). Honeypot field, per-IP (12/min, 40/hr) and global (200/hr) rate limits, a 10-minute idempotency window keyed on route+date+email, strict field validation, and optional household fields (name, phone, child, pet, vet email) that unblock the matching specialists. Dispatch emails the tracker link. | Rate-limit state is in-process (resets on restart, per-instance); move it behind shared infrastructure. Email-ownership verification before dispatching on someone's behalf. Abuse monitoring. |
| Conditional specialist selection | **Built** | Pets, children, car, and visa flags select 11–16 specialists. Mocked tests cover full and reduced rosters. | Express prerequisites as data rather than scattered conditionals; surface why each agent was skipped or blocked. |
| Concurrent fan-out | **Built (single process)** | Async mode dispatch, state broadcasts, isolated specialist errors, artifact capture, and resume: late/corrected fields re-run only the specialists whose prerequisites are now complete. | Move work to a durable queue; add leases, retry policy, timeouts, cancellation, per-provider concurrency/rate controls. |
| AgentMail paths | **Partial** | Seven specialist email adapters. Six can submit at runtime once prerequisites and the recipient allowlist are satisfied: mover quotes (×3 recipients), school enrollment, vet records, gym cancellation, bank call script, flight-search deeplink email. PCP records transmission is policy-blocked pending secure consent. Every outbound subject carries `[ref:event_id:agent_id]`; replies default back to the agent inbox (no Reply-To to the customer). A runtime destination allowlist (`AGENTMAIL_ALLOWED_RECIPIENTS`, empty by default) blocks every unlisted send; `AGENTMAIL_DEMO_RECIPIENT_OVERRIDE` reroutes all outbound to one operator-controlled address labeled with the true recipient. | Secure regulated-data transport, authorized institutional intake addresses (the hardcoded targets are unverified), bounce/complaint handling, and full conversation threading. |
| Reply ingestion | **Built (polling)** | A 45s background poller reads the AgentMail inbox, correlates replies via the `[ref:]` tag, parses quote facts (total/deposit/availability) with deterministic regex only, forwards the full reply to the customer's inbox (echo-guarded), threads it onto the soliciting specialist, and broadcasts live. Dedupe is durable via the SQLite mail ledger; a restart never re-announces old replies. A reply never flips a specialist to "completed". | Webhook-driven ingestion instead of polling; sender verification (any inbound mail bearing a valid ref is attached — see SECURITY.md); spam/abuse filtering; attachment handling. |
| Playbooks / prepared documents | **Built** | Every user-blocked specialist prepares a personalized artifact from 16 deterministic templates in `orchestrator/app/playbooks.py` (call scripts, ready-to-sign letters, filing walkthroughs — no LLM, no invented facts; unknowns are explicit placeholders). One digest email delivers them when the wave settles. The signature-gated trio additionally emails real rendered documents: the Comcast cancellation letter, the CA DMV DL-13A letter, and an unsigned-draft HIPAA release PDF. | Keep templates legally reviewed and dated; per-jurisdiction variants; user-visible versioning. |
| Browser Use paths | **Partial, disabled** | Eight legacy v1 task builders (seven browser-mode specialists plus a retained flight-search builder) and polling/result validators remain in source. Runtime specialist dispatch fails safe to `needs-user-action` (with a playbook) before calling them. | Migrate to a protected-secrets-capable v2 contract; add delegated credentials, site-specific sandbox/recorded tests, approval before mutations/charges, MFA/CAPTCHA handling, reconciliation, and security review before re-enabling. |
| Lob postal-mail paths | **Partial, disabled** | Comcast and DL-13A letter builders remain in source and now render the customer-facing review copies. Runtime policy blocks purchase before adapter invocation. | Customer signature/authorization ceremony, address validation, Lob test-mode contract coverage, idempotent purchase approval, delivery/return tracking before re-enabling. |
| Memory/runbook integrations | **Partial** | Supermemory recall/persist (including settlement-time persistence of partial outcomes) and Moss retrieval adapters are called from orchestration. | Define retention/deletion rules, tenant isolation, data minimization, redaction, authorization, provider DPAs, failure policy, and contract tests. |
| Stripe/Sponge | **Partial/unused product path** | Sponsor adapter functions and dashboard events exist. | Define the actual payment/escrow product contract or remove it from the shipping surface. |
| PAVO service | **Built (heuristic)** | Authenticated FastAPI API, request validation, deterministic routing, local/Gemini/Anthropic adapters (each tier's model is env-configured), fallback behavior, cost configuration, health endpoints, and tests. | Market this component as a heuristic router unless licensed weights/training/evaluation artifacts and reproducible benchmarks ship. Add provider rate limiting and production telemetry. |
| Dashboard and public site | **Built (local live + public redacted)** | Static Next.js site with a labeled deterministic simulation, flipping to `LIVE` on a real session. The authenticated local live view hands its token over via URL hash → sessionStorage → WebSocket subprotocol offer (no query-string tokens; nothing baked into the build). The public site discovers a live backend via `web/public/live.json` (validated as untrusted input: https-only, health-checked) and then uses only the token-less redacted `/ws/public` feed, the start-move form, and the `/move/#<id>` tracker with live quote comparison. | Customer accounts, per-move authorization, short-lived session-bound WebSocket credentials, accessible state/error UX, audit history, end-to-end live tests. |
| Webhook security | **Partial** | Fail-closed secret lookup, timestamp-bound HMAC comparison, header validation, and three-state delivery idempotency (completed duplicates acknowledged; a retry racing an in-flight delivery gets 409; interrupted deliveries stay retryable). Completed-delivery records persist to SQLite across restarts. | Verify the signature construction against the vendor contract, rotate secrets, rate-limit endpoints, redact payload logs, and protect a multi-replica deployment. |
| Admin/dev trigger | **Partial** | Configuration supports disabling the synthetic trigger and separating admin/dashboard tokens; it 404s in production env. | Real identity-aware admin auth, short-lived credentials, audit logs. |
| Persistence | **Built (single-node SQLite)** | Events, buyer contexts, webhook dedupe records, and the mail ledger are mirrored to SQLite (WAL) and reload on startup; specialists that were in flight during a crash recover as honest `needs-user-action` with an explicit restart blocker, never silently resumed and never fabricated complete. | PostgreSQL schema/migrations for multi-replica deployments, encrypted sensitive fields, transactions, tenant/user ownership, retention/deletion jobs, backups, and restore drills. |
| Durable jobs | **Not built** | `asyncio.create_task` and in-request fan-out run in the API process; reply polling is an in-process loop. | Redis/SQS/Pub/Sub plus workers, retry/dead-letter queues, idempotent handlers, graceful shutdown, and job observability. |
| Secure customer intake | **Not built** | The follow-up email deliberately refuses to collect sensitive fields and says so; blocked tasks ship playbooks instead. | Authenticated one-time links, encrypted forms, expiry/revocation, field-level access policy, consent, secrets isolation. Never collect passwords or payment credentials in ordinary email. |
| Production observability | **Partial** | JSON logs, basic health responses, and dashboard events. | Correlation IDs, metrics, traces, SLOs, PII-safe logging, alerting, on-call runbooks, synthetic checks, cost budgets. |
| CI and packaging | **Built (baseline)** | Locked Python dependencies, backend lint/type/test jobs, frontend lint/type/test/build jobs, secret/dependency review, container builds, and a static Pages workflow. | Minimum coverage policy, image scanning, SBOM/signing, migration tests, load/security tests, protected branches, release provenance. |
| Deployment | **Laptop + quick tunnel** | `run.sh` (local stack), `demo-line.sh` (phone-line supervisor + cloudflared quick tunnel + webhook repoint + `live.json` rewrite), three Dockerfiles, nginx static hosting, Compose health dependencies, loopback port binding, read-only backend filesystems. | A named tunnel or cloud host first; then TLS ingress, secret manager, private networking, managed database/queue, WAF/rate limits, autoscaling, staged rollout, rollback, backups, disaster recovery. |
| Legal/privacy/support | **Not built** | Prompts avoid soliciting sensitive fields and docs state the current capability boundaries. | Terms, privacy notice, consent receipts, data-processing inventory, deletion/export workflow, vendor agreements, regulated-data review, accessibility review, incident response, customer support. |

## Agent-by-agent reality

The table describes code paths, not a claim that each target institution
accepts automated action. The hardcoded institutional intake addresses are
unverified; provider acceptance must use accounts and identities the operator
is authorized to exercise. In demo deployments the recipient override
reroutes every send to the operator's own inbox.

| Agent | Implemented path | Current evidence | Before production |
|---|---|---|---|
| `buyer` | AgentPhone inbound webhook → PAVO completion → guarded field merge → fan-out → follow-up email with tracker link | Live calls over the demo line; mocked lifecycle tests | Vendor contract test, stable hosted webhook, durable call state, consent, human handoff |
| `mover_quote` | Three AgentMail quote requests; replies ingested, quote-parsed, forwarded, compared on the tracker | Real sends + real reply round-trips under the demo override; mocked reply tests | Verified recipient addresses, spam/abuse controls, binding-quote normalization |
| `school_district` | AgentMail pre-enrollment inquiry (needs child name + grade) | Real sends under override; mocked prerequisite tests | Minimize child data, guardian consent, confirmed district intake channel |
| `vet_transfer` | AgentMail records request to the customer's own vet address | Real sends under override; mocked ID tests | Owner authorization confirmation, reply/completion tracking |
| `gym_cancel` | AgentMail written cancellation (needs member id + signed authorization flag, so typically blocked → playbook letter) | Mocked prerequisite/policy tests | Verify contractual notice channel, real signature capture, final confirmation tracking |
| `bank_notify` | AgentMail call script emailed to the customer (banks require the account holder's own voice) | Real sends under override | Keep explicitly human-led; never accept banking credentials |
| `flight_book` | AgentMail email with a personalized live-fare search deeplink; no fares quoted (that would be fabrication), booking stays with the user | Real sends under override | Keep search-only unless fare disclosure and purchase approval are built |
| `pcp_transfer` | Policy-blocked (HIPAA consent ceremony missing); customer receives an unsigned-draft HIPAA release PDF plus a written-request playbook | Mocked policy-block test; rendered-PDF test | Legally valid patient authorization, secure transport, regulated-data review |
| `pharmacy` | Policy-blocked (patient-authorized transfer workflow missing); transfer-steps playbook prepared | Mocked policy-block test | Secure prescription-data intake, compliance review, actual pickup status |
| `comcast_cancel` | Lob purchase policy-blocked; the rendered cancellation letter is emailed for review + signature, plus a phone-script playbook | Mocked policy tests; rendered-letter path | Signature/approval ceremony, test-mode preview, delivery tracking |
| `id_card_update` | Lob purchase policy-blocked; the rendered CA DMV DL-13A letter is emailed for review, with the free dmv.ca.gov/coa path called out | Mocked policy tests; rendered-letter path | Jurisdiction confirmation, wet-signature workflow, agency acceptance tracking |
| `pge_shutoff` | Browser v1 builder retained; runtime-blocked → call-script playbook | Mocked `needs-user-action` policy test | Protected-secrets v2 migration, authorized test account, verified final status |
| `geico_address` | Browser v1 builder retained; runtime-blocked → address-change script playbook | Mocked policy test | Delegated auth/secure vault, v2 migration, final policy verification |
| `usps_coa` | Browser v1 builder retained; runtime-blocked → official-site walkthrough playbook | Mocked policy test | Explicit purchase approval, secure payment, v2 migration |
| `spectrum_austin` | Browser v1 builder retained; runtime-blocked → setup-checklist playbook | Mocked policy test | Price disclosure, explicit order approval, v2 migration |
| `water_board` | Browser v1 builder retained; runtime-blocked → stop-service script playbook | Mocked policy test | V2 migration, regional provider configuration, final-bill handling |
| `uscis_ar11` | Browser v1 builder retained; runtime-blocked → AR-11 online-filing walkthrough playbook | Mocked policy test | V2 migration, legal review, signed/accepted evidence |

## What the automated tests establish

The default backend suite is deliberately side-effect free. It establishes:

- the roster agrees across Python, TypeScript, and documentation;
- routing heuristics select the expected tier for representative turns;
- all-condition fan-out creates all 16 specialist contexts; conditional
  fan-out omits inapplicable specialists;
- permitted mocked provider artifacts reach `submitted`, never implicit
  success; policy-blocked and prerequisite-blocked paths reach
  `needs-user-action` with a playbook, never a fabricated fallback;
- provider errors remain visible instead of becoming fabricated success;
- the outbound allowlist blocks unlisted recipients before any send, and the
  demo override relabels rather than hides the true recipient;
- reply ingestion correlates by ref tag, parses quotes deterministically,
  dedupes durably, and never flips a specialist state;
- persistence round-trips events/contexts/dedupe records and recovers
  in-flight specialists as `needs-user-action` after a simulated crash;
- the public projection and move snapshot redact free text, identifiers,
  and PII.

It does **not** establish live phone pickup at scale, institutional email
acceptance, browser transaction completion, postal delivery, government
acceptance, target-site terms, model quality, or production security.

The separate provider-acceptance suite exercises the permitted AgentMail
submissions and proves the disabled Browser/Lob/regulated paths remain
blocked. It is skipped unless two environment gates, an explicit allowlist
for every outbound address, and an out-of-repository authorized spec are
supplied. It can still have real-world effects and must remain outside
ordinary CI.

## Ordered plan to build the product

### Phase 0 — freeze an honest baseline *(done, keep it green)*

1. Keep normal CI green across lint, typing, unit/mocked tests, static build,
   secret scanning, and container build.
2. Treat this file and `AGENT_COUNT.md` as the public capability contract.
3. No quantitative routing, cost, latency, delivery, or provider claims
   unless a reproducible artifact and date are linked.
4. Separate UI states for demo replay, submitted, needs-user-action,
   completed, and failed.

Exit criteria (met): a new contributor can run the safe suite without
credentials, and no default command contacts or charges a provider.

### Phase 1 — stable hosting for the existing surface

1. Replace the rotating quick tunnel with a named tunnel or a small cloud
   host: a stable HTTPS origin for the AgentPhone webhook and the public
   API, ending the `live.json` republish churn.
2. Move the intake/snapshot rate limits and reply poller state behind
   infrastructure that survives restarts.
3. Add uptime monitoring and alerting for the phone line.

Exit criteria: the phone line and public site survive a laptop reboot and a
tunnel rotation with zero manual steps.

### Phase 2 — define the domain and outcome contract

1. Define `Move`, `Task`, `Attempt`, `Artifact`, `Consent`, `Approval`, and
   `ProviderEvent` schemas with versioned state transitions.
2. Specify prerequisites, sensitive fields, side effects, approval rules,
   idempotency keys, and evidence requirements for every specialist as data.
3. Decide which agents merely prepare or notify and which are allowed to
   submit or purchase.

Exit criteria: every state and artifact shown in the dashboard has an
unambiguous server-side meaning and test.

### Phase 3 — build the durable control plane

1. PostgreSQL migrations and repositories for the domain objects
   (single-node SQLite exists; scale-out does not).
2. A durable queue and worker service for fan-out, reply polling, retries,
   and scheduled follow-up.
3. Transactional outbox/inbox patterns and provider idempotency.
4. Stateless API instances with proven restart/replay recovery.

Exit criteria: killing an API or worker during a 16-specialist run neither
loses work nor duplicates an irreversible side effect.

### Phase 4 — identity, consent, and secure intake

1. User accounts or verified, expiring, one-time move links.
2. An authenticated encrypted form replacing emailed field collection.
3. Provider credentials in a secrets manager or delegated OAuth vault —
   never in prompts, email, logs, or move JSON.
4. Encrypted sensitive fields, tenant-scoped authorization, redacted logs,
   retention/export/deletion workflows.
5. Explicit consent and per-action approval, including price and target,
   before mail, account mutation, or payment.

Exit criteria: an authorization test suite proves one customer cannot access
another move, and sensitive values never appear in telemetry or client
bundles.

### Phase 5 — harden one narrow provider wedge

Do not productionize all 16 specialists at once. The email wedge (quotes,
inquiries, notifications) is furthest along; harden it first.

1. Verified institutional recipient addresses with documented intake
   channels; recorded/contract fixtures.
2. Approval previews, structured result validation, bounce/complaint
   handling, reconciliation, human escalation.
3. A scheduled sandbox acceptance suite measuring success by final provider
   state, not request ID.
4. Every remaining specialist behind a feature flag labeled preview.

Exit criteria: repeated authorized sandbox runs meet a defined success SLO
and produce auditable evidence without manual database repair.

### Phase 6 — production platform and operations

1. API/workers behind TLS with private PAVO/database/queue networking,
   managed secrets, WAF/rate limits, environment isolation.
2. Migration gates, image scanning, SBOM/provenance, staged rollout, canary
   checks, automatic rollback.
3. Traces, metrics, redacted structured logs, provider/cost dashboards, SLO
   alerts, audit logs, incident runbooks.
4. Backups, point-in-time restore, disaster-recovery drills, capacity/load
   tests, provider outage exercises.

Exit criteria: staging passes load, security, recovery, and provider-failure
drills; production can be rolled back without losing or duplicating tasks.

### Phase 7 — limited launch, then expand

1. Terms, privacy notice, support and incident processes, provider
   permissions, and required legal/compliance review.
2. Launch to an invited cohort with only the hardened specialist wedge.
3. Measure task success, user corrections, human interventions, provider
   failures, cost, and deletion/support outcomes.
4. Add specialists one at a time only after the same acceptance bar is met.

Exit criteria: production evidence — not dashboard animation or submission
IDs — shows the chosen tasks complete reliably and safely for real users.

## Suggested sequencing and staffing

The critical path is stable hosting → domain contract → durable jobs/state →
identity and secure intake → email-wedge acceptance → production operations.
UI polish and additional personas should not outrun those foundations. A
small team should assign clear ownership for backend/workflows, provider
integrations, frontend/product, infrastructure/security, and
legal/operations; one person may cover multiple roles early, but each launch
gate still needs an accountable owner.
