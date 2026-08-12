# Relocate

Relocate is a hackathon prototype for coordinating relocation tasks from one
inbound voice conversation. The repository contains a voice webhook
orchestrator, a 17-persona roster (one concierge and 16 specialists), a
three-tier completion router, and a dashboard that can show either live events
or a clearly labeled client-side replay.

This is not a production relocation service. The normal automated test suite
uses mocks and proves orchestration behavior, not successful transactions with
utilities, government agencies, insurers, health providers, or mail carriers.
See [STATUS.md](STATUS.md) for the detailed built/partial/missing inventory.

![Relocate swarm dashboard](docs/swarm.png)

## What is implemented

- A FastAPI orchestrator for AgentPhone webhooks, incremental move-spec
  extraction, conditional specialist selection, concurrent fan-out, and
  dashboard WebSocket events.
- A code/config roster of 17 personas: one inbound `buyer` and 16 specialist
  definitions across browser, email, and postal-mail modes.
- Adapter code for AgentMail, Browser Use, Lob, Supermemory, Moss, Stripe, and
  Sponge. The current dispatch policy permits five lower-risk AgentMail
  submissions when their prerequisites are present. Browser Use v1, Lob
  purchase, PCP, and pharmacy execution remain fail-safe blocked even if keys
  are configured.
- A local PAVO-compatible service with an auditable heuristic router and
  adapters for a local OpenAI-compatible endpoint, Gemini, and Anthropic.
- A Next.js static dashboard with authenticated live-WebSocket support and a
  visible demo-replay fallback when a live backend is unavailable.
- Safe mocked end-to-end coverage, roster consistency checks, CI, Dockerfiles,
  and a local Compose scaffold.

## Important boundaries

- The GitHub Pages/static build is a product demonstration. It does not prove
  that a phone call or any specialist transaction occurred.
- “17 agents” means 17 persona definitions in code. A move dispatches 11–16
  specialists depending on pets, children, car ownership, and visa status.
- A provider submission ID proves that a provider accepted a request; it does
  not necessarily prove that the underlying relocation task completed.
- Disabled, unsafe, or insufficiently specified paths report
  `needs-user-action` or failure; they are not converted into a successful
  playbook artifact.
- Runtime state and replay protection are process-local. Restarts lose active
  events, and multiple orchestrator replicas are not currently safe.
- The repository's PAVO router is a deterministic heuristic. Learned router
  weights and training code are not included.
- Several flows can send messages, mail letters, modify customer accounts, or
  create charges. Do not run live-provider acceptance against identities or
  accounts you do not own or have explicit authorization to use.

## Agent modes

| Mode | Count | Runtime behavior |
|---|---:|---|
| Inbound voice | 1 | AgentPhone calls the `buyer` webhook; the orchestrator routes completions and extracts a move spec. |
| Browser | 8 | Legacy v1 task builders are retained, but current specialist dispatch blocks submission pending a protected-secrets v2 migration. |
| Email | 6 | Five lower-risk AgentMail paths may submit after prerequisites; the PCP path is policy-blocked pending secure consent. |
| Postal mail | 2 | Letter builders are retained, but Lob purchase is blocked pending customer review and signature. |

The exact roster and conditional rules are in [AGENT_COUNT.md](AGENT_COUNT.md).

## Local quick start

Prerequisites:

- Python 3.12 and [`uv`](https://docs.astral.sh/uv/)
- Node.js 22 and [`pnpm`](https://pnpm.io/)
- A local OpenAI-compatible completion endpoint; the example uses
  [Ollama](https://ollama.com/) with `gemma2:2b`
- An AgentPhone key only if you intend to exercise inbound voice

Install and configure:

```bash
git clone https://github.com/vnmoorthy/relocate-ai.git
cd relocate-ai

cp orchestrator/.env.example orchestrator/.env
openssl rand -hex 32  # use a different value for each required token

cd orchestrator
uv sync --locked --all-groups
cd ../web
pnpm install --frozen-lockfile
cd ..
```

Edit `orchestrator/.env` and replace every required placeholder. Leave
AgentPhone and specialist-provider keys blank unless you are running an
authorized integration path. Keep the file untracked. Start Ollama, then launch
the local stack:

```bash
ollama pull gemma2:2b
ollama serve

# In a second terminal:
./run.sh
```

The launcher starts the PAVO service on `127.0.0.1:8765`, the orchestrator on
`127.0.0.1:8000`, and the dashboard on `127.0.0.1:3000`. The dashboard remains
in replay mode because the current live socket needs a long-lived query token;
that token is deliberately not placed in the static/client build. The launcher
does not create a public tunnel unless `--ngrok` is supplied. Stop only the
processes managed by the launcher with `./run.sh stop`.

For a dashboard-only workflow, run `pnpm --dir web dev`. If no authenticated
backend is reachable, the UI enters demo-replay mode and labels that state.

## Verification

The default checks do not contact external providers:

```bash
./verify-all-agents.sh

cd web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The provider-acceptance test is intentionally excluded from normal CI. It has
multiple opt-in gates because it can create external side effects. Read
`orchestrator/tests/test_e2e_provider_acceptance.py` before enabling it.

## Repository map

```text
.
├── orchestrator/       FastAPI service, personas, integrations, scripts, tests
├── pavo_server/        heuristic router and model-provider adapters
├── web/                Next.js dashboard and static demo replay
├── deploy/             container definitions and nginx static hosting config
├── compose.yaml        local/staging three-service scaffold
├── ARCHITECTURE.md     components, data flow, trust boundaries
├── STATUS.md           built, partial, missing, and ordered work plan
├── DEPLOYMENT.md       local container use and production requirements
└── SECURITY.md         current controls and known security gaps
```

## Documentation

- [Current implementation status and build plan](STATUS.md)
- [Architecture](ARCHITECTURE.md)
- [Deployment](DEPLOYMENT.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Demo runbook](DEMO_SCRIPT.md)

## License

Repository code is available under [MIT](LICENSE). External datasets, model
weights, services, and trademarks retain their own terms; see [NOTICE.md](NOTICE.md).
