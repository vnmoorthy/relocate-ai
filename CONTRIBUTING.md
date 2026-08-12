# Contributing to Relocate

Relocate is a prototype with external-integration code that can create real
side effects. Contributions are welcome, but local and CI workflows must remain
safe by default.

## Before you start

Read:

- [README.md](README.md) for the prototype boundaries and quick start;
- [STATUS.md](STATUS.md) for the authoritative built/partial/missing inventory;
- [ARCHITECTURE.md](ARCHITECTURE.md) for data flow and trust boundaries;
- [SECURITY.md](SECURITY.md) before changing webhooks, auth, sensitive data, or
  provider integrations.

Use synthetic data. Do not add customer data, phone numbers, credentials,
provider artifacts, generated webhook registries, or acceptance specs to the
repository.

## Development setup

Requirements:

- Python 3.12
- `uv`
- Node.js 22
- pnpm 10

Install locked dependencies:

```bash
cd orchestrator
uv sync --locked --all-groups

cd ../web
pnpm install --frozen-lockfile
```

`orchestrator/.env` is not needed for the normal tests. Copy
`orchestrator/.env.example` only when running local services and replace every
required placeholder with a distinct value.

## Safe verification

Run the repository backend gate from the root:

```bash
./verify-all-agents.sh
```

It runs Ruff, mypy, the orchestrator suite, the PAVO API/router suite, roster
consistency, and mocked end-to-end fan-out. It excludes the
`provider_acceptance` marker and must not contact external providers.

Run the frontend gate:

```bash
cd web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Validate deployment files without starting services:

```bash
docker compose config --quiet
```

If your change affects the live profile, also validate its rendered model with
an authorized local environment and registry. This does not start services or
call providers:

```bash
docker compose --env-file orchestrator/.env --profile live config --quiet
```

## Test categories

### Unit and mocked end-to-end tests

These are the required default. Mock every provider boundary and assert both
state transitions and artifact/error shape. Tests must blank integration keys
and must not rely on a developer's `.env`.

When adding a persona or mode:

1. update `orchestrator/app/personas.py`;
2. add/modify the dispatcher and provider adapter;
3. update `web/src/lib/types.ts`;
4. update the numbered roster in `AGENT_COUNT.md`;
5. add full and conditional mocked coverage;
6. update `STATUS.md` without claiming live success.

### Provider acceptance

`orchestrator/tests/test_e2e_provider_acceptance.py` is intentionally skipped
unless multiple explicit gates are supplied. It can have external side effects.
Do not run it merely to validate ordinary code changes.

Before an authorized acceptance run:

- inspect the test and every provider adapter in the selected path;
- use isolated test/sandbox accounts and provider test keys;
- use an untracked synthetic spec whose identities/accounts you are authorized
  to exercise;
- independently allowlist the recipient;
- confirm expected mail, account mutations, and charges;
- arrange cleanup/cancellation and retain only redacted evidence.

Never weaken live-key guards or opt-in acknowledgements to make acceptance pass.
Provider acceptance belongs in a manually approved staging workflow, not pull
request CI.

## Design and implementation rules

- Keep demo replay and live data visibly distinct.
- Treat a provider submission ID as `submitted`, not automatically `succeeded`.
- Require explicit user approval before purchases, mail, account changes, or
  other irreversible effects.
- Do not collect passwords, full payment credentials, or regulated data in
  ordinary email, logs, prompts, fixtures, or client state.
- Make network timeouts, retries, concurrency, idempotency, and error states
  explicit.
- Keep provider failures visible; never convert an outage into fabricated
  completion.
- Prefer typed provider/domain contracts over unvalidated dictionaries.
- Preserve side-effect-free imports and tests.
- Do not embed dashboard/admin/provider secrets in `NEXT_PUBLIC_*` or URLs.
- Keep local services bound to loopback unless a deliberate authenticated
  integration test requires otherwise.

## Documentation rules

Update documentation in the same pull request when behavior changes:

- `STATUS.md` for capability status and gaps;
- `ARCHITECTURE.md` for components, state, or trust boundaries;
- `DEPLOYMENT.md` for environment, container, or rollout changes;
- `SECURITY.md` for controls or known limitations;
- `AGENT_COUNT.md` for roster/mode/conditional changes;
- component READMEs for commands or APIs.

Avoid unqualified “real,” “complete,” “verified,” performance, cost, or legal
claims. Link a reproducible test/evidence artifact and date when such a claim is
material.

## Pull requests

- Keep one coherent concern per pull request.
- Explain user impact, failure behavior, security/privacy implications, and
  verification performed.
- Include tests for success, provider error, timeout/retry, missing config, and
  idempotent replay where applicable.
- Use conventional commit prefixes such as `feat:`, `fix:`, `test:`, `docs:`,
  `refactor:`, or `chore:`.
- Do not stage ignored/generated files. Review `git diff --cached` and run a
  secret scan before pushing.
- Do not lower test/security gates without a clearly documented reason and a
  replacement control.

## Code of conduct and security

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report
vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
