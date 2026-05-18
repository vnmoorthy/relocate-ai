# PAVO server (Lambda side)

Runs on the Lambda A100 box alongside `vllm` serving Gemma 2-2b-it on `localhost:8001`.

## Deploy

```bash
# On the Lambda box:
cd ~ && mkdir -p pavo_server
# scp the three files (app.py, route.py, requirements.txt) here.
pip install -r requirements.txt

# Set env:
export PAVO_API_KEY="local-shared-secret"   # must match orchestrator's PAVO_API_KEY
export VLLM_URL="http://localhost:8001/v1/chat/completions"
export VLLM_MODEL="google/gemma-2-2b-it"
export ANTHROPIC_API_KEY="sk-ant-..."

# Run (tmux/screen session):
tmux new -s pavo
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
# Detach: Ctrl-B, D
```

## Verify

From the orchestrator host (Mac):

```bash
curl http://129.146.122.8:8000/healthz
# Expected: {"status":"ok","vllm_url":"http://localhost:8001/v1/chat/completions","model":"google/gemma-2-2b-it"}

curl -X POST http://129.146.122.8:8000/v1/chat/completions \
  -H "Authorization: Bearer local-shared-secret" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi, calling about an account update."}],"role_hint":"contractor-generic","max_tokens":50}'
# Expected: {"content":"...","x_pavo_tier":"gemma-local","x_pavo_cost_cents":...}
```

## Architecture

```
orchestrator (Mac)  ──┐
                       │ POST /v1/chat/completions
                       ▼
              ┌─────────────────────┐
              │  PAVO server (8000) │
              │  - route_turn()     │
              │  - tier dispatch    │
              └────┬──────┬─────────┘
                   │      │
        gemma-local│      │claude-haiku|opus
                   ▼      ▼
            vllm:8001    Anthropic API
            (Gemma 2-2b) (cloud)
```

## Routing policy

See `route.py`. Heuristic + small-LM hybrid trained on PAVO-Bench (50K voice-agent
turns). Proprietary. Sub-5ms per route decision.
