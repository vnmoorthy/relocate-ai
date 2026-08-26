# Deployment guide

The checked-in deployment files are a local/staging scaffold. They are not a
production deployment. The default Compose behavior intentionally serves only
the static dashboard in demo mode; live backend services require the `live`
profile and explicit operator configuration.

## Prerequisites

- Docker Engine with Compose v2
- For a local completion tier, Ollama or another OpenAI-compatible endpoint
- Python 3.12 and `uv` for provisioning scripts
- A generated `orchestrator/agents.json` for AgentPhone webhook verification
- Provider sandbox/test credentials only for the integrations being exercised

Generate a distinct random value for each service/admin token:

```bash
openssl rand -hex 32
```

Never reuse the PAVO, admin, or dashboard token. Do not commit
`orchestrator/.env`, `orchestrator/agents.json`, acceptance specs, provider
credentials, or customer data.

## Static demo container

The safe default builds and serves the dashboard with an empty WebSocket URL:

```bash
docker compose up --build web
```

Open <http://127.0.0.1:3000>. The UI enters and labels demo-replay mode. It does
not start PAVO or the orchestrator, contact providers, or require credentials.

The web image deliberately does not embed `DASHBOARD_API_TOKEN`. A value placed
in any `NEXT_PUBLIC_*` variable becomes public JavaScript.

## Local live-backend profile

### 1. Configure the orchestrator

```bash
cp orchestrator/.env.example orchestrator/.env
```

Replace the PAVO and dashboard token placeholders with different random values.
Configure an admin token only when deliberately enabling the development
trigger. Set `DEMO_PASSWORD` (with `PUBLIC_REF_SECRET`) only if this
deployment should serve the gated product surface at `/app`; blank keeps that
login shut, and the credential is shared — see
[SECURITY.md](SECURITY.md#the-gated-product-surface-app). The checked-in
`live` profile includes inbound voice, so it also requires an AgentPhone key
and a provisioned registry. Add specialist-provider
keys only for authorized sandbox/test accounts. Keep:

```dotenv
APP_ENV=development
ENABLE_DEV_TRIGGER=false
STRIPE_TEST_MODE=true
```

The Compose file connects the orchestrator to `http://pavo:8765/v1` on its
private network regardless of the loopback `PAVO_BASE_URL` in the example file.

Run the safe configuration check; it does not call vendor APIs:

```bash
bash orchestrator/tests/preflight.sh
```

`--live-config` is stricter: it requires the inbound registry and AgentMail,
the only specialist-provider substrate currently permitted by the Loop-1
acceptance policy. Browser Use v1 and Lob purchase remain disabled even if keys
are configured. Optional cloud-model, memory, and sponsor adapters stay
warnings. This command validates configuration only; provider acceptance is
separate.

### 2. Prepare local model access

For the default example:

```bash
ollama pull gemma2:2b
ollama serve
```

Compose points PAVO at
`http://host.docker.internal:11434/v1/chat/completions`. Confirm the container
runtime can reach that host endpoint. On Linux, the Compose file maps
`host.docker.internal` to the host gateway; the model server may also need to
listen on an interface reachable from Docker. A Gemini or Anthropic key can
provide an additional tier, but it should not conceal a broken required local
model in production monitoring.

### 3. Generate the webhook registry

`orchestrator/agents.json` is deployment state containing per-agent webhook
secrets. It is gitignored and excluded from container images. Provision only
against an AgentPhone account you are authorized to modify:

```bash
cd orchestrator
uv sync --locked --all-groups
uv run python scripts/provision_agents.py
cd ..
```

Review the script and resulting registry before use. Compose bind-mounts the
file read-only at `/srv/orchestrator/agents.json`. To use a different absolute
path, set `AGENT_REGISTRY_PATH` in the environment/Compose env file. The live
profile fails to start when the source path does not exist; it does not bake or
invent webhook secrets.

### 4. Validate and start

```bash
docker compose --env-file orchestrator/.env --profile live config --quiet
docker compose --env-file orchestrator/.env --profile live up --build
```

Local endpoints:

- dashboard: <http://127.0.0.1:3000>
- orchestrator liveness: <http://127.0.0.1:8000/healthz>
- PAVO liveness: <http://127.0.0.1:8765/healthz>
- PAVO readiness: <http://127.0.0.1:8765/readyz>

The containerized dashboard is always built in demo mode, including with the
`live` profile. Compose does not accept a WebSocket build argument from the env
file, so a dashboard token cannot accidentally enter the static bundle. The
production fix is a short-lived, user- and move-scoped WebSocket ticket issued
after normal authentication; that flow is not built yet.

Stop the stack with:

```bash
docker compose --env-file orchestrator/.env --profile live down
```

Compose binds all published ports to loopback, runs PAVO/orchestrator with
read-only root filesystems and temporary `/tmp`, and does not copy `.env` or
`agents.json` into images.

## Non-container local launcher

`./run.sh` is the more convenient development path. It:

- sources `orchestrator/.env`;
- validates tools/config without contacting vendors;
- starts local PAVO, orchestrator, and Next.js processes;
- waits for health endpoints;
- records only its own PIDs under the OS temporary directory;
- creates no public tunnel unless `--ngrok` is supplied.

```bash
./run.sh
./run.sh stop
```

Use `--external-pavo` only with a private-network or HTTPS PAVO endpoint. Use
`--ngrok` only for an intentional webhook test after reviewing which routes are
exposed and updating AgentPhone webhook URLs.

## Provider acceptance

Normal tests never call providers. The current gated acceptance suite can send
email through AgentMail; Browser Use and Lob paths remain policy-blocked and the
test asserts that they do not run. Read the test itself:

```text
orchestrator/tests/test_e2e_provider_acceptance.py
```

It requires two explicit environment gates, an AgentMail sandbox confirmation,
an allowlist containing every actual outbound address, and an ignored or
out-of-repository authorized move spec. Keep it out of normal CI and never
weaken those gates to make a demo pass.

## Production deployment requirements

Do not expose the Compose stack directly to the internet. A production design
needs, at minimum:

### Compute and network

- TLS ingress, WAF/rate limits, request size/time limits, and denial-of-service
  controls;
- stateless API replicas and separate worker processes;
- private networking for PostgreSQL, queue, PAVO, and secret access;
- provider egress allowlisting where practical;
- separate development, staging, and production accounts/projects;
- autoscaling and explicit provider concurrency budgets.

### Data and workflows

- PostgreSQL migrations and transaction boundaries;
- a durable queue with retries, dead letters, leases, scheduled polling, and
  idempotency;
- transactional outbox/inbox processing;
- encrypted sensitive fields and tenant-scoped authorization;
- retention, deletion/export, backups, point-in-time recovery, and restore
  drills;
- reconciliation that distinguishes provider submission from final success.

### Identity and secrets

- end-user authentication and move-scoped authorization;
- short-lived WebSocket tickets, never build-time dashboard secrets;
- a managed secret store with rotation and audit;
- delegated provider authorization or a credential vault instead of raw
  passwords in move specs/prompts;
- workload identity and least-privilege service credentials;
- durable webhook replay/idempotency storage and tested secret rotation.

### Release and supply chain

- immutable versioned images;
- dependency and image scanning, SBOM, signing, and provenance;
- migration checks and backward-compatible rollout order;
- staged/canary deployment, automated health gates, and rollback;
- branch protection and environment approvals for production.

### Operations

- correlation IDs across calls, tasks, provider requests, and artifacts;
- PII-safe logs, metrics, traces, audit events, and cost/usage dashboards;
- SLOs and alerts for webhook lag, queue age, provider failures, and data loss;
- incident response, provider-outage, backup-restore, and rollback runbooks;
- support tooling for cancellation, correction, retry, and data deletion.

### Legal and customer safety

- terms, privacy notice, consent records, and action-specific approval;
- provider terms/automation permission and data-processing agreements;
- regulated-data review before any medical/prescription workflow;
- price/contract disclosure before purchases or service orders;
- preview and human approval for irreversible account changes or mail;
- an accessible human escalation and dispute path.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the target topology and
[STATUS.md](STATUS.md) for the ordered implementation plan.
