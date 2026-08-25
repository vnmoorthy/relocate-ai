# Security policy

## Developer preview status

Relocate is in developer preview and is not yet certified for production
customer data; the hardening roadmap is in
[Production security gates](#production-security-gates) below and in
[STATUS.md](STATUS.md). Do not use it with real passwords, SSNs, payment cards,
prescription numbers, medical records, government identifiers, or accounts
unless you have performed an independent security/legal review and have
explicit authorization.

Normal automated tests are designed to be side-effect free. Live-provider
acceptance is separately gated because it can send messages or mail, interact
with accounts, and create charges.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability or include customer
data, credentials, webhook secrets, or a working exploit in a public channel.
Use GitHub's private security-advisory flow when available, or email
`vnarasingamoorthy@gmail.com` with:

- affected commit/version and component;
- impact and prerequisites;
- minimal reproduction using synthetic data;
- suggested mitigation, if known.

This project does not currently promise a production support SLA. Maintainers
should acknowledge a report, preserve evidence without copying sensitive data,
rotate exposed credentials, and coordinate disclosure after a fix is available.

## Controls currently in the repository

- `.env`, `agents.json`, evidence, caches, and build outputs are excluded from
  container contexts; secret files are also gitignored.
- CI runs secret scanning and dependency review, plus lint/type/test/build and
  container-build checks.
- AgentPhone webhook authentication fails closed when an agent secret is
  missing. It validates required headers, timestamp freshness, a
  timestamp-bound HMAC, and a delivery ID, with three-state idempotency:
  completed duplicates are acknowledged, a retry racing an in-flight delivery
  gets 409, and interrupted deliveries stay retryable. Completed-delivery
  records persist to SQLite across restarts.
- Outbound email is default-deny: every recipient must appear in
  `AGENTMAIL_ALLOWED_RECIPIENTS` (empty blocks all sends, keys or not), the
  check runs before any recipient in a multi-recipient send is contacted, and
  `AGENTMAIL_DEMO_RECIPIENT_OVERRIDE` reroutes every outbound message to one
  operator-controlled address labeled with the true intended recipient — the
  override address must itself be allowlisted.
- The PAVO service has no built-in default credential and requires a bearer
  token for completion/model endpoints.
- Admin/dev-trigger and dashboard access use separate configuration tokens;
  the synthetic trigger can be disabled and returns 404 in production
  configuration.
- CORS is configured from an explicit origin list rather than a production
  wildcard in the hardened configuration path.
- Compose publishes services only on loopback, uses read-only filesystems for
  backend services, and mounts the generated webhook registry read-only.
- The public static site never carries a token: it uses only the redacted
  public surface described below, and discovers a live backend via
  `web/public/live.json`, which it treats as untrusted input (https-only URL,
  no credentials/query/hash, 3-second health check) before connecting.
- Missing completion providers return an error; the PAVO service does not
  fabricate a response after all providers fail.

These controls establish safe defaults for the developer preview. They do not
make the system production-secure.

## The public unauthenticated surface

**Event ids are never published.** The real `mkt_…` id is a capability: it
unlocks `GET /api/public/move/{id}`, which carries the mover's street
addresses. The public live feed therefore emits an opaque HMAC alias
(`pub_…`, `public_feed.public_ref`) in place of the id on every projection,
including the bootstrap replay a fresh anonymous socket receives. A tracker
page learns its own alias from the snapshot it already had the id to fetch —
the pairing is available nowhere else. `PUBLIC_REF_SECRET` keys the alias;
blank falls back to a per-process key (aliases rotate on restart, and tracker
pages resync from the snapshot on reconnect).

**Client address.** Rate limits and web-intake deduplication key on the
caller address. `X-Forwarded-For` is honored only when `TRUST_PROXY_HEADERS`
is set (default true, correct behind the cloudflared tunnel where every
request would otherwise appear to come from `127.0.0.1`). Exposed directly,
that header is caller-controlled and the setting should be false.

**Reply attribution.** The `[ref:<event_id>:<agent_id>]` subject tag is
written by whoever replies. The agent half is credited only to a specialist
that actually sent a request for that move; otherwise the reply attaches
unattributed. A reply from the move owner's own address is never mined for a
quote, so a customer forwarding our own message back cannot manufacture a
competing bid on their tracker.

Three endpoints are deliberately reachable without credentials so the public
website can be a real product surface. Their design assumption is that every
caller is hostile; the useful data never leaves the server.

### `WS /ws/public` — redacted live feed

- Always on. A server-side projection (`orchestrator/app/public_feed.py`) of
  dashboard events: agent states, routing tiers, cost counters, reply
  domains/timestamps. Every free-text field (transcripts, blockers, sponsor
  detail) is blanked or replaced server-side — redaction never depends on the
  client behaving.
- Capacity-capped (300 concurrent clients; new connections beyond that are
  closed with 1013), read-only (client frames are ignored), with a bootstrap
  replay of the latest event's states on subscribe and a 2-second bound on
  every send so a slow-read client cannot backpressure the webhook path.
- Residual exposure, accepted for the preview: an observer learns that moves
  are happening, their agent states, and reply sender domains. No identities,
  no routes, no text.

### `POST /api/public/start-move` — web intake

- Off by default; `ENABLE_PUBLIC_INTAKE=true` is a deliberate deployment
  decision for supervised demos.
- Defenses: an offscreen honeypot field (any value rejects), per-IP rate
  limits (12/min, 40/hr), a global cap (200/hr), strict validation of the
  four required fields, and a 10-minute idempotency window keyed on
  route+date+email so client retries return the original move instead of
  double-dispatching (and double-emailing).
- Invalid optional household fields are dropped, not stored.
- The real backstop is the outbound allowlist: an intake submitted with an
  arbitrary victim email produces **no email to that address** unless the
  operator has explicitly allowlisted it (demo deployments reroute everything
  to the operator's own inbox). Without allowlisting, an attacker can create
  noise events on the public feed — not outbound mail.
- Known limits, stated honestly: rate-limit state is in-process (resets on
  restart, per-instance; `X-Forwarded-For` is trusted, which is only
  meaningful behind a trusted proxy), and there is no email-ownership
  verification before dispatching a move "for" an address. Both are Phase-1
  items in [STATUS.md](STATUS.md).

### `GET /api/public/move/{event_id}` — redacted move snapshot

- Gated by the same `ENABLE_PUBLIC_INTAKE` switch; rate-limited per IP
  (120/min).
- The move id is the only capability: `mkt_` + 10 hex chars of a UUID4
  (40 bits). Not enumerable in practice against the rate limit, but it is a
  bearer link — anyone holding it (including counterparties, who receive it
  in email subjects via the `[ref:]` tag) can view the snapshot. Treat the
  tracker like a parcel-tracking link, because that is what it is.
- The snapshot is a projection, never the event: route and date, boolean
  household flags, per-task honest states and blocker *kinds*, static
  playbook titles, reply sender domains/timestamps, and regex-extracted quote
  display strings. Never emails, phone numbers, names, transcripts, playbook
  bodies, raw blocker strings, or provider artifacts.

### The `[ref:]` tag — reply-correlation threat model

Every outbound specialist email carries `[ref:<event_id>:<agent_id>]` in its
subject. The reply poller attaches any inbound message bearing a valid ref to
that move. The tag is a correlation id, **not** an authentication of the
sender — legitimate counterparties forward and quote these subjects, so
sender verification is impossible at this layer. What an attacker who obtains
or guesses a valid ref can actually do by emailing the inbox:

1. **Inject a reply row**: the move's tracker and public feed show the
   attacker's sender *domain*, a timestamp, and any dollar figures their text
   happens to contain, rendered as a quote display. States never change — a
   reply cannot flip a specialist to submitted or completed, and reply
   bodies/subjects never reach the public surfaces.
2. **Cause one forwarded email to the move owner**: the full reply text (up
   to 4000 chars) is forwarded to the customer's inbox, labeled with the
   sender domain — a spam/phishing vector equivalent to emailing the customer
   directly, except it arrives via Relocate's inbox. The forward passes
   through the same allowlist/override policy as every send, so on demo
   deployments it reaches only the operator.

That is the entire blast radius: a spoofable, redacted reply row plus one
labeled forward. There is no path from an inbound email to state changes,
data disclosure, or further outbound fan-out. Residual risks we accept and
track: quote displays are attacker-influenceable text on the tracker
(displayed as claims, not verified prices), and the mail ledger dedupes by
message id, so a flood of distinct messages bearing one ref is bounded only
by the poller's 50-message page — abuse filtering is listed in
[STATUS.md](STATUS.md).

## Known security and privacy gaps

### Authentication and authorization

- There is no end-user identity system, tenant model, or move-scoped access
  policy beyond the unguessable move id.
- Long-lived bearer tokens are only appropriate for private local
  development. The dashboard WebSocket does not accept query-string tokens
  (they leak through history, logs, screenshots); the local live view hands
  the token over via a URL hash into a subprotocol offer instead, which is
  still a long-lived shared secret, not production auth.
- A public static dashboard cannot safely carry a live dashboard secret —
  which is why the public site gets the redacted feed instead.
- There is no identity-aware admin console, credential revocation UI, or
  privileged-action audit trail.

### Webhooks and idempotency

- Webhook-delivery records persist to single-node SQLite; replicas do not
  coordinate, so run exactly one orchestrator instance.
- The implemented HMAC construction must be contract-tested against the exact
  current AgentPhone specification; header names and signed payload formats
  are vendor contracts, not assumptions.
- There is no shared rate limiter, durable inbox, or WAF policy in this repo.
- `agents.json` secret rotation and zero-downtime dual-secret handling are
  not implemented.

### Sensitive data

- Active move state lives in single-node SQLite with no formal encryption,
  retention, deletion, or tenant-isolation policy.
- The follow-up email deliberately refuses to solicit sensitive fields and
  says the secure intake does not exist yet; tasks needing those fields stay
  paused with playbooks instead.
- Some retained (runtime-blocked) browser-task builders interpolate account
  details into a provider task description. That is not acceptable for
  production credential handling; delegated authorization or a credential
  vault is required before those paths re-enable.
- Medical, prescription, child, immigration, address, and call-transcript
  data may be sensitive or regulated. Provider agreements and
  legal/compliance requirements have not been established by this repository.
- PII-safe logging/redaction is not comprehensive, and external
  model/provider requests can create additional data copies.

### Workflow safety

- A provider request ID can be mistaken for business completion; every
  surface labels `submitted` accordingly.
- There is no universal user-approval gate for purchases, service changes,
  certified mail, or other irreversible actions — which is why those paths
  are policy-blocked entirely rather than partially guarded.
- Work executes in the API process without a durable queue; a crash recovers
  to honest `needs-user-action`, never fabricated completion, but retries and
  scheduled work are not durable.
- Institutional recipient addresses hardcoded in the email adapters are
  unverified; the allowlist is what keeps them theoretical until an operator
  deliberately enables them.

### Infrastructure and operations

- The demo line intentionally runs over a rotating cloudflared quick tunnel
  from a laptop (`demo-line.sh`). That exposes exactly the webhook and the
  public surface above to the internet; it is supervised, and it is not — and
  must never be treated as — a production ingress. A named tunnel or cloud
  host is the first production step.
- Compose is not a production platform and has no TLS ingress, managed
  database, durable queue, WAF, autoscaling, backup, or disaster recovery.
- Monitoring is limited to logs/basic health; there are no security alerts,
  anomaly detection, SLOs, or incident automation.
- Container SBOM/signing, image scanning, runtime policy, and provenance are
  not yet release gates.

## Secret handling rules

1. Keep local credentials only in ignored files or an approved secret manager.
2. Use different random values for PAVO, admin, dashboard, and webhook secrets.
3. Use provider test/sandbox keys and isolated accounts for acceptance.
4. Never put a long-lived secret in `NEXT_PUBLIC_*`, a static bundle, a URL,
   source code, a screenshot, test fixture, prompt, or issue.
5. Do not copy production secrets into CI. CI's normal suite must pass with
   provider keys blank.
6. Do not put customer identifiers or credentials in `agents.json`; it should
   contain only deployment registry data and webhook secrets.
7. `web/public/live.json` is public by design and must only ever contain the
   API origin — never a token, path, or query.
8. Rotate immediately if a secret appears in git history, logs, build output,
   terminal sharing, or a provider task transcript. Revocation comes before
   repository cleanup.
9. Treat webhook registries, authorized acceptance specs, generated PDFs, and
   provider artifacts as sensitive even when they contain synthetic data.

## Safe local-development defaults

- Bind services to `127.0.0.1`.
- Keep `ENABLE_DEV_TRIGGER=false` unless actively testing it on a private host.
- Keep `ENABLE_PUBLIC_INTAKE=false` except on a supervised demo deployment
  with the allowlist/override configured first.
- Use the empty WebSocket URL/default demo mode for a public static dashboard.
- Use local/private HTTP only for loopback or container-private PAVO traffic;
  remote PAVO endpoints require TLS/private networking.
- Run `./verify-all-agents.sh` for the normal safe backend checks.
- Review the provider-acceptance source before setting either opt-in gate.
- Never use live Stripe or Lob credentials in acceptance tests.
- Do not open a tunnel until webhook authentication, the outbound allowlist,
  and generated registry contents have been verified — `demo-line.sh` assumes
  you have done this.

## Production security gates

Before serving real users, complete at least:

- threat modeling and an independent application/infrastructure security review;
- end-user authentication, move/tenant authorization, and short-lived realtime
  tickets;
- durable webhook inbox/replay protection and side-effect idempotency;
- managed secrets with rotation and least-privilege workload identity;
- encrypted storage, data classification, retention/deletion/export, backups,
  and restore testing;
- authenticated secure intake and consent/action-approval records;
- inbound-mail abuse filtering and sender verification for the reply loop;
- PII redaction and egress policy for logs, models, and providers;
- rate limits backed by shared state, TLS, WAF/network boundaries,
  dependency/image scanning, SBOM, signing, and release provenance;
- security monitoring, incident response, customer notification, and recovery
  runbooks;
- provider terms, data-processing agreements, and appropriate legal/compliance
  review for every enabled workflow.

The broader engineering sequence is in [STATUS.md](STATUS.md); deployment
requirements are in [DEPLOYMENT.md](DEPLOYMENT.md).
