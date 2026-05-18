<div align="center">

# 🛰️ Relocate

### AI Relocation OS · 12 agents on one phone call

[![License: MIT](https://img.shields.io/badge/License-MIT-00ffa3.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![PAVO Paper](https://img.shields.io/badge/PAVO-TMLR%202026-5cf4ff?style=flat-square)](https://huggingface.co/datasets/vnmoorthy/pavo-bench)
[![Apple Silicon](https://img.shields.io/badge/Local%20LLM-Apple%20Silicon-000000?style=flat-square&logo=apple)](https://ollama.com)
[![Powered by AgentPhone](https://img.shields.io/badge/Telephony-AgentPhone-ffc94a?style=flat-square)](https://agentphone.ai)
[![Built with Next.js](https://img.shields.io/badge/UI-Next.js%2016-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Built with FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![GitHub stars](https://img.shields.io/github/stars/vnmoorthy/relocate-ai?style=flat-square&color=ff4dc1)](https://github.com/vnmoorthy/relocate-ai/stargazers)

**One phone call. Twelve agents. The most stressful event in America, handled in ninety seconds.**

📞 **Try it now: [+1 (618) 414-9537](tel:+16184149537)**

</div>

---

> Built at the **YC Call My Agent Hackathon** (San Francisco, May 2026). Powered by [PAVO](https://huggingface.co/datasets/vnmoorthy/pavo-bench), a peer-reviewed routing layer (TMLR 2026) that runs the cheap turns on your Mac's Apple Silicon and only escalates the hard ones to the cloud. **25% cheaper, 34% faster median latency, 71% less energy, 7.9× fewer coherence failures vs. fixed-cloud** on the 50,000-turn benchmark.

## ⭐ Why this exists

Moving is the **#1 most stressful life event in America** — 45% rank it above divorce. **25.87M Americans relocate every year.** Each move = 15+ coordinated tasks: utility shutoffs, USPS forwarding, DMV updates, insurance, banks, school enrollment, medical records, vet records, mover quotes, prescription transfers, subscription updates. Existing tools cover slices. Nobody runs a real-time AI agent swarm that fans out across all of it in parallel.

Relocate does. Call **+1 (618) 414-9537**, talk for 30 seconds, and watch the dashboard light up as 11 specialists go to work — each one producing a real verifiable artifact (USPS confirmation number, Lob certified-mail tracking, AgentMail message IDs, Browser Use task outputs).

[![Watch the swarm](https://img.shields.io/badge/▶️%20Watch%20the%20swarm-localhost%3A3000-00ffa3?style=for-the-badge)](http://localhost:3000)

## 🚀 What's inside

| | |
|---|---|
| 🌌 **Cinematic dashboard** | Swarm-from-singularity visualization; 12 cells burst from a pulsing PAVO core; tier-colored particles fly back per routing decision |
| 🧠 **PAVO routing** | Pipeline-Aware Voice Orchestration — peer-reviewed at TMLR 2026, model-agnostic, dataset open-source |
| 🍏 **Local on Apple Silicon** | Gemma 2-2B runs on M3 Air via Ollama — cheap turns stay local, hard turns escalate to Gemini Flash / Claude Opus |
| 📞 **Real telephony** | AgentPhone handles the inbound buyer call (ElevenLabs "Cleo"); the 11 specialists fan out across Browser Use, AgentMail, and Lob certified mail. |
| 📨 **Real artifacts** | Every specialist produces a real verifiable artifact (USPS confirmation, Lob letter ID, AgentMail message IDs, Browser Use task outputs). AgentMail also delivers the branded PDF receipt; Supermemory persists move history. |
| 🛡️ **Honest dashboard** | No STUB / PARTIAL / ERR badges in v2 — every shipping agent must produce a real artifact or it isn't in the roster. See `AGENT_COUNT.md`. |

---

## The problem

Moving is the **#1 most stressful life event in America** — 45% rank it above divorce. 25.87M Americans relocate per year. Each move = 15+ coordinated tasks: utility shutoffs and connections, USPS forwarding, DMV updates, voter registration, school enrollment, medical records, insurance, banks, gym, vet, mover quotes.

Existing solutions cover slices. Nobody runs an AI agent fleet that actually executes these in parallel for you. Relocate does.

## What happens when you call

The concierge (ElevenLabs voice "Cleo") picks up:

> *"Relocate here — how can I help with your move?"*

Tell her where you're going. She extracts your move spec (origin, destination, date, household size) and dispatches a **swarm of 11 specialist agents** (12 total counting the concierge). Every one of them produces a verifiable real-world artifact.

| # | Agent | Mode | Endpoint | Artifact |
|---|---|---|---|---|
| 1 | **Concierge** (buyer) | voice (inbound) | AgentPhone | parsed spec + Supermemory recall + emailed PDF receipt |
| 2 | **PG&E shutoff** | browser | pge.com/movingcenter | PG&E confirmation number |
| 3 | **Comcast cancel** | mail (certified) | Lob → Comcast Customer Care | Lob letter ID + USPS tracking number |
| 4 | **Geico address** | browser | geico.com/service | reference + updated declarations PDF |
| 5 | **USPS COA** | browser | moversguide.usps.com | USPS confirmation number + $1.10 charge |
| 6 | **Spectrum Austin** | browser | spectrum.com/internet/order | order number + work-order ID |
| 7 | **Mover quotes (×3)** | email | AgentMail → U-Haul, PODS, Two Men | 3 outbound IDs (+ async replies) |
| 8 | **AISD enrollment** | email | AgentMail → enroll@austinisd.org | message ID + AISD auto-reply |
| 9 | **PCP records transfer** | email | AgentMail → records@onemedical.com | message ID + HIPAA release PDF attached |
| 10 | **Vet records transfer** | email | AgentMail → customer's vet | message ID |
| 11 | **Gym cancellation** | email | AgentMail → memberservices@equinox.com | message ID (45-day notice) |
| 12 | **CVS RX transfer** | browser | cvs.com/pharmacy/transfer | confirmation + pickup ETA (or email fallback) |

> The v1 README listed 16 agents. v2 removes four — `wells_fargo`, `subscriptions`, `ca_dmv`, `ca_voter` — because none could clear the four-question test in `orchestrator/AUDIT.md` (bank/DMV/voter identity bars are insurmountable without compromising real PII; `subscriptions` requires 5 sets of credentials in a headless browser). Better to ship 12 honest agents than 16 theatrical ones.

## Integrations — all REAL in v2, or the agent isn't in the roster

| Integration | Status |
|---|---|
| AgentPhone (inbound buyer) | REAL — verified via `/calls` API |
| AgentMail (5 email-mode agents + buyer PDF receipt) | REAL — message IDs land in inbox |
| Browser Use (5 browser-mode agents) | REAL — requires `BROWSERUSE_API_KEY` |
| Lob.com (Comcast certified mail) | REAL — requires `LOB_API_KEY` (~$1.40/letter) |
| Supermemory (persist + recall by caller phone) | REAL |
| PAVO routing (local Gemma + cloud escalation) | REAL — paper at TMLR 2026 |
| Gemini Flash 2.5 (cloud tier) | REAL when PAVO escalates |

The end-to-end harness in `verify-all-agents.sh` boots the orchestrator, fires a buyer trigger, and asserts every shipping agent produced a real artifact. **No silent stubs in shipping agents.** If a key is missing, the affected agent fails loudly — the test goes red — and the right move is either to acquire the key or remove the agent from `personas.PERSONAS`.

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

Watch `http://localhost:3000`: 12 cells burst from the singularity. A real PDF lands in the email you specified. A real Supermemory document is written.

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

- **Narasinga Moorthy Veilu Kantha Perumal** — author, University of Pennsylvania
- Sponsors: AgentPhone, Google DeepMind, Moss, Browser Use, AgentMail, Stripe, sponge, Supermemory

## License

Relocate (this repo): MIT.
PAVO dataset: CC-BY 4.0 (HuggingFace).
PAVO router weights: proprietary.

---

*"Moving sucks. Now it doesn't."*

## References

- PAVO paper (TMLR 2026) — *Pipeline-Aware Voice Orchestration with Demand-Conditioned Inference Routing* — [HuggingFace dataset](https://huggingface.co/datasets/vnmoorthy/pavo-bench)
- 50,000-turn PAVO-Bench benchmark — CC-BY 4.0
