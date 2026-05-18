# Relocate — AI Relocation OS

> **One phone number. Sixteen agents. The most stressful event in America, handled in ninety seconds.**

📞 **Call now: +1 (618) 414-9537** — talk to the concierge, get your relocation tasks dispatched.

Built at the **YC Call My Agent Hackathon** (San Francisco, 2026-05-17). Hosted by [AgentPhone](https://agentphone.ai). Powered by [PAVO](https://huggingface.co/datasets/vnmoorthy/pavo-bench) — a peer-reviewed routing layer for voice agent fleets (TMLR 2026).

---

## The problem

Moving is the **#1 most stressful life event in America** — 45% rank it above divorce. 25.87M Americans relocate per year. Each move = 15+ coordinated tasks: utility shutoffs and connections, USPS forwarding, DMV updates, voter registration, school enrollment, medical records, insurance, banks, gym, vet, mover quotes.

Existing solutions cover slices. Nobody runs an AI agent fleet that actually executes these in parallel for you. Relocate does.

## What happens when you call

The concierge (ElevenLabs voice "Cleo") picks up:

> *"Relocate here — how can I help with your move?"*

Tell her where you're going. She extracts your move spec (origin, destination, date, household size) and dispatches a **swarm of 16 specialist agents**.

| Agent | What it does | Real today? |
|---|---|---|
| **Concierge** | Inbound call, spec extraction, Supermemory recall of prior moves | ✅ REAL |
| **PG&E shutoff** | Outbound call to PG&E customer service | ⚠ Telephony real, IVR doesn't accept AI cancel |
| **Comcast cancel** | Outbound call to Comcast retention | ⚠ Telephony real, IVR doesn't accept AI cancel |
| **Geico address** | Outbound call to Geico | ⚠ Telephony real, IVR doesn't accept AI |
| **USPS COA** | Browser Use submission at moversguide.usps.com | ❌ Stub (needs Browser Use key) |
| **Spectrum Austin** | Outbound call for new install scheduling | ⚠ Telephony real, IVR-dependent |
| **Mover quotes** | Outbound calls to 3 movers + comparison | ⚠ Telephony real, depends on mover lines |
| **Move-package PDF** | reportlab PDF emailed via AgentMail with attachment | ✅ REAL — lands in your inbox during the call |
| **Move history persist** | Written to Supermemory; next call recalls you | ✅ REAL |
| **9 backlog agents** | DMV, voter, bank, school, PCP, vet, gym, pharmacy, subscriptions | ❌ Queued for async post-call follow-up |

## The honest "really does work" audit

We label every integration on the dashboard with **REAL / PARTIAL / STUB / ERR** so you know exactly what's happening:

| Integration | Status | Evidence / why |
|---|---|---|
| AgentPhone telephony | REAL | Inbound + outbound calls verified via `/calls` API |
| PAVO routing layer | REAL | 50K-turn benchmark, peer-reviewed at TMLR 2026 |
| Gemma 2-2B local | REAL | Runs on **M3 Air (Apple Silicon)** via Ollama, gemma2:2b model |
| Gemini Flash 2.5 | REAL | Real Google API calls when PAVO escalates |
| Claude Opus 4.7 | STUB | Anthropic key not set — fallback to Gemini |
| AgentMail PDF | REAL | Real email with PDF attachment lands in inbox |
| Supermemory persist | REAL | Real document writes |
| Supermemory recall | REAL | Prior moves keyed by caller phone number |
| Stripe PaymentIntent | STUB | Needs `sk_test_*` key |
| Browser Use (USPS COA, DMV, voter) | STUB | Needs Browser Use API key |
| Moss runbook RAG | STUB | Needs `MOSS_PROJECT_ID` (user only has one of two creds) |
| sponge agent payments | ERR | Real key, but endpoint paths undocumented |
| Outbound utility calls (PG&E/Comcast/Geico/Spectrum) | PARTIAL | Real telephony, but utility IVRs reject AI cancellations. Production needs carrier API integrations or human-in-the-loop. |

**Bottom line**: PAVO routing + telephony + email + persistence + recall **all work right now**. The actual cancellation of your PG&E account is theatrical today — that's the wedge into carrier APIs / human-in-the-loop, not the demo.

## Architecture

```
                            CALLER (you)
                              │
                              │ inbound voice
                              ▼
              ┌──────────────────────────────────┐
              │  AgentPhone (host telephony)     │
              │  voice in + voice/SMS/iMessage out│
              └──────────────┬───────────────────┘
                             │ webhook + HMAC-SHA256
                             ▼
              ┌──────────────────────────────────┐
              │  Orchestrator (FastAPI, M3 Air)  │
              │  - Buyer turn handler            │
              │  - asyncio fan-out to 7 LIVE     │
              │  - WebSocket → dashboard         │
              │  - Sponsor integration hooks     │
              └─┬─────────┬──────────┬───────────┘
                │         │          │
                ▼      ▼              ▼
   ┌──────────┐ AgentPhone     AgentMail (PDF receipt) +
   │ PAVO     │ outbound       Supermemory (persist + recall) +
   │ local    │ ↓              Browser Use (USPS form) +
   │ :8765    │ PG&E, Comcast, Stripe (test mode) + others
   └────┬─────┘ Geico, ...
        │
        ▼ tier-based dispatch:
   ┌─────────────────────────────────────┐
   │  gemma-local  → localhost:11434     │  Ollama (gemma2:2b on M3 Air)
   │  gemini-flash → Google API          │  cloud
   │  claude-opus  → Anthropic API       │  cloud (escalation only)
   └─────────────────────────────────────┘
```

**Local tier runs on YOUR Mac.** No Lambda dependency. Cloud only when PAVO escalates.

## Running it yourself

### Prereqs

- macOS with [Ollama](https://ollama.com) (`brew install ollama`)
- `gemma2:2b` pulled (`ollama pull gemma2:2b`, 1.6 GB)
- Python 3.12 + [`uv`](https://docs.astral.sh/uv/)
- Node 20+ + [pnpm](https://pnpm.io)
- AgentPhone account + API key
- Google Gemini API key (free tier works)
- Optional: Anthropic, Stripe test, Browser Use, Moss credentials

### Start the stack

```bash
# 1. Ollama (Apple Silicon local LLM)
ollama serve &

# 2. Local PAVO server
cd pavo_server
VLLM_URL=http://localhost:11434/v1/chat/completions \
VLLM_MODEL=gemma2:2b \
GEMINI_API_KEY=$YOUR_GEMINI_KEY \
GEMINI_MODEL=gemini-2.5-flash \
PAVO_API_KEY=local-shared-secret \
uvicorn app:app --host 127.0.0.1 --port 8765

# 3. Orchestrator
cd orchestrator
cp .env.example .env  # fill in keys
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4. Dashboard
cd web
pnpm install && pnpm dev   # http://localhost:3000

# 5. Public tunnel for AgentPhone webhooks (rotates ~hourly)
ssh -R 80:localhost:8000 nokey@localhost.run
# Set PUBLIC_BASE_URL in orchestrator/.env, restart orchestrator,
# then push the new URL to AgentPhone agents:
cd orchestrator && uv run python scripts/update_webhooks.py
```

Verify:

```bash
curl http://localhost:8000/healthz           # orchestrator
curl http://localhost:8765/healthz           # local PAVO
curl http://localhost:11434/api/tags         # Ollama (gemma2:2b listed)
```

### Demo without dialing (synthetic mode)

Trigger a 4-turn-per-specialist synthetic run via PAVO + real sponsor calls (no AgentPhone outbound dialing):

```bash
# orchestrator/.env: SYNTHETIC_MODE=true, then restart
curl -X POST http://localhost:8000/api/test/buyer-trigger \
  -H "Content-Type: application/json" \
  -d '{"spec":{"origin_address":"123 Main St SF","destination_address":"456 Oak Austin","move_date":"2026-05-31","homeowner_email":"you@example.com"}}'
```

Watch `http://localhost:3000`: 16 cells burst from the singularity. A real PDF lands in the email you specified. A real Supermemory document is written.

## Repo layout

```
.
├── README.md, DEMO_SCRIPT.md, HANDOFF.md, run.sh
├── orchestrator/                        ← FastAPI: buyer + specialist agents + sponsor wires
│   ├── app/
│   │   ├── main.py                      ← webhook handlers + WS dashboard + sponsor fan-out
│   │   ├── marketplace.py               ← asyncio fan-out + wave-mode cap
│   │   ├── personas.py                  ← 16 agent prompts + ElevenLabs voices + begin_message
│   │   ├── pavo_client.py               ← client to local PAVO server
│   │   ├── agentphone.py, state.py, security.py (HMAC), ws.py
│   │   └── integrations/
│   │       ├── agentmail.py             ← email + PDF attachment
│   │       ├── pdf_receipt.py           ← reportlab PDF generator
│   │       ├── supermemory.py           ← persist + recall
│   │       ├── stripe_integration.py, browser_use.py, sponge.py, moss.py
│   └── scripts/
│       ├── provision_agents.py          ← one-time: create 16 AgentPhone agents
│       ├── update_webhooks.py           ← re-push webhook URLs after tunnel rotation
│       ├── refresh_agent_config.py      ← push ElevenLabs voices + prompts to AgentPhone
│       ├── seed_supermemory.py          ← seed prior-move + preferences for recall
│       └── seed_moss.py                 ← upload runbooks to Moss index
├── pavo_server/                         ← PAVO routing + LLM dispatch (local on M3 Air)
│   ├── app.py                           ← FastAPI /v1/chat/completions
│   ├── route.py                         ← heuristic classifier (neural model post-MVP)
│   └── README.md
└── web/                                 ← Next.js + shadcn cinematic dashboard
    └── src/
        ├── app/page.tsx                 ← swarm stage + side panels + cost ticker
        ├── lib/types.ts                 ← WSEvent union, ALL_AGENTS roster (16)
        └── components/
            ├── SwarmStage.tsx           ← swarm-from-singularity viz (2 concentric rings, burst animation)
            ├── AgentCell.tsx            ← live transcript card with tier color bars
            ├── PAVOFlow.tsx             ← 3-tier routing flow panel
            ├── CostTicker.tsx           ← Bloomberg-style big-number panel
            ├── ArtifactsPanel.tsx       ← live links to real artifacts (PDF, doc IDs)
            └── SponsorRow.tsx           ← REAL / STUB / ERR badges
```

## Credits

- **Moorthy VeiluKanthaPerumal** — first author of [PAVO](https://huggingface.co/datasets/vnmoorthy/pavo-bench), University of Pennsylvania
- **Mohammed Imthathullah** — co-author of PAVO, Google
- Sponsors: AgentPhone, Google DeepMind, Moss, Browser Use, AgentMail, Stripe, sponge, Supermemory

## License

Relocate (this repo): MIT.
PAVO dataset: CC-BY 4.0 (HuggingFace).
PAVO router weights: proprietary.

---

*"Moving sucks. Now it doesn't."*
