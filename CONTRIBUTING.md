# Contributing to Relocate

Thanks for the interest. The project is open-source MIT and contributions are very welcome.

## Ways to contribute

- **Star the repo** if Relocate's design or PAVO's routing layer is useful to you.
- **Open an issue** for bugs, design feedback, or feature requests.
- **Send a PR** — see below.
- **Wire your own keys** — if you have Browser Use, Lob, Stripe, or Anthropic credentials, you can upgrade the fallback-mode agents to fully autonomous by setting them in `orchestrator/.env`.
- **Share the phone number** — dial **+1 (618) 414-9537** and tell us what worked, what didn't.

## Development setup

See [Quick start](README.md#-quick-start) in the README. The minimum local setup needs:

- macOS with [Ollama](https://ollama.com) (`brew install ollama` + `ollama pull gemma2:2b`)
- Python 3.12 + [`uv`](https://docs.astral.sh/uv/)
- Node 20+ + [pnpm](https://pnpm.io)
- An AgentPhone account + API key
- An AgentMail account + API key (for real email artifacts)
- A Supermemory account + API key (for recall)
- A Google Gemini API key (free tier works)

## PR conventions

- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:`. Subjects under 70 chars.
- **One concern per PR** — small focused changes get merged faster than sweeping rewrites.
- **Verify before PR**:
  - `cd web && pnpm tsc --noEmit` clean
  - `cd orchestrator && uv run pytest -q` passes
  - No secrets staged (run `git diff --cached | grep -E 'sk_|secret_|api_key'` before push)
- **Sensitive files are gitignored**: `.env`, `agents.json`, `HANDOFF.md`. If you change `.gitignore`, double-check no secrets land in your commit.

## What we're looking for

- **Browser Use task improvements** — better selectors, fallback paths, more reliable form completion on PG&E, Geico, USPS.
- **More specialist agents** — internet providers we don't cover, regional utility companies, additional carriers.
- **Voice quality tuning** — different ElevenLabs voices, better `interruptionSensitivity` values, shorter `begin_message`.
- **Localization** — multi-language buyer (Diego for Spanish, etc.) with persona translation.
- **A11y** — keyboard navigation paths, screen reader testing, color contrast audit.

## Code of conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Don't open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).
