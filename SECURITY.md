# Security policy

## Prototype warning

Relocate is a hackathon prototype and is not approved for production customer
data. Do not use it with real passwords, SSNs, payment cards, prescription
numbers, medical records, government identifiers, or accounts unless you have
performed an independent security/legal review and have explicit authorization.

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
  timestamp-bound HMAC, and a delivery ID.
- The PAVO service has no built-in default credential and requires a bearer
  token for completion/model endpoints.
- Admin/dev-trigger and dashboard access use separate configuration tokens;
  the synthetic trigger can be disabled and is intended to remain unavailable
  in production.
- CORS is configured from an explicit origin list rather than a production
  wildcard in the hardened configuration path.
- Compose publishes services only on loopback, uses read-only filesystems for
  backend services, and mounts the generated webhook registry read-only.
- The default Compose dashboard is disconnected from the live socket and runs
  visibly in demo mode, avoiding a long-lived token in public JavaScript.
- Missing completion providers return an error; the PAVO service does not
  fabricate a response after all providers fail.

These controls reduce obvious prototype risks. They do not make the system
production-secure.

## Known security and privacy gaps

### Authentication and authorization

- There is no end-user identity system, tenant model, or move-scoped access
  policy.
- Long-lived bearer tokens are only appropriate for private local development.
  The dashboard WebSocket no longer accepts query-string tokens (they leak
  through browser history, logs, screenshots, and referrers); the local live
  view hands the token over via a URL hash into a subprotocol offer instead,
  which is still a long-lived shared secret, not production auth.
- A public static dashboard cannot safely carry a live dashboard secret.
- There is no identity-aware admin console, credential revocation UI, or
  privileged-action audit trail.

### Webhooks and idempotency

- Webhook replay claims are stored only in process memory. They disappear on
  restart and do not coordinate across replicas.
- The implemented HMAC construction must be contract-tested against the exact
  current AgentPhone specification before exposure; header names and signed
  payload formats are vendor contracts, not assumptions.
- There is no shared rate limiter, durable inbox, or WAF policy in this repo.
- `agents.json` secret rotation and zero-downtime dual-secret handling are not
  implemented.

### Sensitive data

- Active move state is process-local and has no formal encryption, retention,
  deletion, or tenant-isolation policy.
- The follow-up email mentions a secure form, but that authenticated encrypted
  intake experience is not built.
- Some browser-task builders interpolate account details or credentials into a
  provider task description. That is not acceptable for production password or
  financial handling; use delegated authorization or a tightly controlled
  credential vault and field-level policy.
- Medical, prescription, child, immigration, address, and call-transcript data
  may be sensitive or regulated. Provider agreements and legal/compliance
  requirements have not been established by this repository.
- PII-safe logging/redaction is not comprehensive, and external model/provider
  requests can create additional data copies.

### Workflow safety

- A provider request ID can be mistaken for business completion.
- There is no universal user-approval gate for purchases, service changes,
  certified mail, or other irreversible actions.
- Work executes in the API process without a durable queue, so crashes can
  cause lost, retried, or duplicate effects.
- Provider recipient/target allowlists, reconciliation, dispute handling, and
  cancellation workflows are incomplete.

### Infrastructure and operations

- Compose is not a production platform and has no TLS ingress, managed database,
  durable queue, WAF, autoscaling, backup, or disaster recovery.
- Monitoring is limited to logs/basic health; there are no security alerts,
  anomaly detection, SLOs, or incident automation.
- A public development tunnel expands the attack surface and must never be
  treated as a production ingress.
- Container SBOM/signing, image scanning, runtime policy, and provenance are not
  yet release gates.

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
7. Rotate immediately if a secret appears in git history, logs, build output,
   terminal sharing, or a provider task transcript. Revocation comes before
   repository cleanup.
8. Treat webhook registries, authorized acceptance specs, generated PDFs, and
   provider artifacts as sensitive even when they contain synthetic data.

## Safe local-development defaults

- Bind services to `127.0.0.1`.
- Keep `ENABLE_DEV_TRIGGER=false` unless actively testing it on a private host.
- Use the empty WebSocket URL/default demo mode for a public static dashboard.
- Use local/private HTTP only for loopback or container-private PAVO traffic;
  remote PAVO endpoints require TLS/private networking.
- Run `./verify-all-agents.sh` for the normal safe backend checks.
- Review the provider-acceptance source before setting either opt-in gate.
- Never use live Stripe or Lob credentials in acceptance tests.
- Do not open a tunnel until webhook authentication, route exposure, and
  generated registry contents have been verified.

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
- PII redaction and egress policy for logs, models, and providers;
- rate limits, TLS, WAF/network boundaries, dependency/image scanning, SBOM,
  signing, and release provenance;
- security monitoring, incident response, customer notification, and recovery
  runbooks;
- provider terms, data-processing agreements, and appropriate legal/compliance
  review for every enabled workflow.

The broader engineering sequence is in [STATUS.md](STATUS.md); deployment
requirements are in [DEPLOYMENT.md](DEPLOYMENT.md).
