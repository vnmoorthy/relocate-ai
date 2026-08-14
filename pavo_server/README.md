# PAVO routing service

PAVO exposes one authenticated completion endpoint and selects among a local
OpenAI-compatible vLLM server, Gemini, and Anthropic. The router included here is
the deterministic heuristic in `route.py`; learned routing weights and the
PAVO-Bench dataset referenced in earlier project material are **not** part of
this repository.

## Configuration

`PAVO_API_KEY` is mandatory for `/v1/*`. There is no built-in shared secret.
Generate a long random value and deliver it through the deployment secret store.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAVO_API_KEY` | yes | Bearer token accepted by PAVO |
| `VLLM_URL` | yes for local inference | OpenAI-compatible completion URL |
| `VLLM_MODEL` | yes for local inference | Model served by vLLM |
| `GEMINI_API_KEY` | only for Gemini | Gemini provider credential |
| `GEMINI_MODEL` | no | Gemini model identifier |
| `ANTHROPIC_API_KEY` | only for Anthropic | Anthropic provider credential |
| `ANTHROPIC_MODEL` | no | Anthropic model identifier |

Provider pricing variables (`*_USD_PER_MILLION`) are operator configuration and
must be reviewed against the current provider terms before cost reporting is used.

## Run locally

```bash
cd pavo_server
export PAVO_API_KEY="$(openssl rand -hex 32)"
export VLLM_URL="http://localhost:8001/v1/chat/completions"
export VLLM_MODEL="google/gemma-2-2b-it"
uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
```

Use a private network or an HTTPS reverse proxy in every remote deployment. Do
not expose this service over public plain HTTP.

## API

- `GET /healthz`: unauthenticated process liveness; discloses no provider URLs.
- `GET /readyz`: configuration readiness.
- `GET /v1/models`: authenticated provider capability list.
- `POST /v1/chat/completions`: authenticated routing and completion.

Example request:

```bash
curl -X POST https://pavo.internal.example/v1/chat/completions \
  -H "Authorization: Bearer $PAVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi, I need an account update."}],"role_hint":"contractor-generic","max_tokens":50}'
```

The response reports the provider tier that actually produced the completion. If
the selected provider fails and another succeeds, the decision reason records the
fallback. If every configured provider fails, PAVO returns `503`; it does not
invent a reply.

## Verification

From the repository root:

```bash
orchestrator/.venv/bin/python -m pytest -q pavo_server/tests orchestrator/tests/test_pavo_routing.py
```
