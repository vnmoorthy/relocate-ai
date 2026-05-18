# Relocate — 90-second demo script

**Memorize. Do not read from notes on stage.**

The honest framing: the **routing infrastructure** is real, the **artifacts** are real, the **calls** are real. The utility-company conversations are real telephony with real audio but synthesized counterparties because PG&E/Comcast don't accept AI cancellations. We label what's REAL vs STUB on the dashboard. No theater.

**Voice**: all 16 agents use ElevenLabs voices (Cleo for the concierge, Ryan/Brian/Grace/Jenny/James for specialists). Prompts written for spoken dialogue — contractions, short sentences, natural pacing. Sounds like a real person, not a chatbot.

**Visual**: dashboard is a "swarm-from-singularity" stage — when the buyer extracts the move spec, all 6 specialist cells **burst outward from the PAVO core** with staggered animation (110ms apart, cubic-bezier easing). Connection lines from each cell to the core breathe; every routing decision spawns a colored particle that flies from the cell back to the core (mint=Gemma-local, amber=Gemini-Flash, magenta=Claude-Opus). PAVO core in the dead center counts decisions and local-tier share.

---

## 0:00–0:18 — Cold open

Stand still. Hold the phone you'll dial. One breath in.

> *"I'm Moorthy, first author of PAVO. Moving is the number-one most stressful event in America.*
> *Watch what one phone number does."*

Hand the phone to the judge (or put yourself on speaker). Dial the buyer number.

## 0:18–0:35 — The inbound call

Buyer agent answers (Polly Joanna voice):

> *"Relocate here — I see you moved Berkeley to SF last September. Where are you going this time?"*

The "I see you moved" line is real Supermemory recall, keyed off the caller's phone number. Pre-seeded artifact, real DB read at call time.

Judge (or you, naturally):
> *"San Francisco to Austin in two weeks. Two-bedroom, no pets."*

Buyer:
> *"On it. I'll text you each task as it closes. Hang up whenever you want."*

Hang up. The dashboard is the demo now.

## 0:35–1:15 — The swarm

Don't narrate the whole swarm. Let the dashboard do the work. The 7-cell grid fills with live transcripts. The PAVO routing panel ticks up.

**ONE narration line at ~0:55:**

> *"Six specialist agents firing in parallel — utilities at both addresses, the insurer, the post office, the moving companies. Every turn is routed by PAVO in real time."*

What's actually happening:
- 6 outbound AgentPhone calls placed (visible on AgentPhone dashboard at agentphone.ai)
- Every turn the agents speak goes through PAVO on the Lambda A10
- Routing decisions stream live to the dashboard — most stay local (Gemma 2-2B on our GPU), some escalate to Gemini Flash, the hard ones to Claude Opus
- The REAL ARTIFACTS panel on the right lights up: Supermemory document ID, AgentMail message ID, etc.

## 1:15–1:35 — The cost reveal

Point at the bottom strip. Read the numbers as they tick.

> *"Eighteen routing decisions. Sixty-one percent stayed local — zero cents.*
>
> *On the fifty-thousand-turn PAVO-Bench, that translates to twenty-five percent cheaper, thirty-four percent faster median latency, seventy-one percent less energy, seven-point-nine times fewer coherence failures vs. fixed-cloud.*
>
> *Peer-reviewed at TMLR. Dataset open-source on HuggingFace.*
>
> *PAVO is the routing layer every voice agent company in your portfolio needs.*
>
> *Relocate is what it lets us build."*

While you speak, the judge's email pings. The PDF receipt is in their inbox. Real artifact. AgentMail delivery confirmation on screen.

## 1:35–1:45 — Walk off

> *"Moving sucks. Now it doesn't."*

Walk off. Total: 1:45.

---

## Anti-patterns (don't do)

- Don't open with "Hi everyone" or "Today we built." Get to the cold open in one breath.
- Don't claim a number you can't defend. The paper's actual numbers (25% / 34% / 71% / 7.9×) are stronger because they're peer-reviewed AND multi-dimensional.
- Don't apologize for cells that error. Narrate around it ("five of six confirmed live").
- Don't read from notes. The cold open is 24 words. The cost reveal is 70 words. Memorize.
- Don't end on "thanks for watching." End on the punchline. Walk off.

## What's real vs. what's theater (memorize this for Q&A)

| What | Status |
|---|---|
| AgentPhone telephony — inbound + 6 outbound calls | **Real.** Audible on stage speakers. Visible on AgentPhone dashboard. |
| PAVO routing — every LLM turn classified and dispatched | **Real.** Lambda A10 with vLLM serving Gemma 2-2b + Gemini Flash + Claude Opus API. Decisions stream to dashboard. |
| Supermemory — prior-move recall on inbound, persist on completion | **Real.** Pre-seeded with prior move history; live DB read on call answer. |
| AgentMail — PDF move-package receipt to judge | **Real.** Generated with reportlab, base64 + send via AgentMail SDK. Lands in real inbox. |
| The counterparty side of each outbound call | **Theater in synthetic mode** (templated reply lines), **real telephony in real mode** (actually dials PG&E etc., but utility IVRs don't accept AI cancellations so the conversation goes nowhere useful). We have a friend-as-counterparty setup if needed. |
| Stripe, Browser Use, Moss sponsor cards | **STUB.** API keys not wired (clearly labeled STUB on the dashboard). |
| sponge | **ERR.** Real key, real call, endpoint paths undocumented — returns 404 and we surface that honestly. |

## YC Partner Q&A — likely questions + answers

**"How big is the routing layer? Is it just an if/else?"**
> *"It's an 85,041-parameter meta-controller trained with multi-objective PPO on 50,000 voice agent turns. Two-regime coupling structure between ASR error and LLM degradation. Paper's on HuggingFace if you want to read it."*

**"What's the moat? Anyone could write a router."**
> *"They could write a router. They couldn't train one. We have the only dataset of 50,000 labeled voice agent turns spanning three LLM families and two hardware platforms. That dataset is the moat. The router is the lever."*

**"What's stopping OpenAI from doing this in their Realtime API?"**
> *"Nothing in principle. In practice — their routing layer would be locked to their own models. Ours is model-agnostic. Every voice agent company that wants to mix Gemma, Llama, Claude, GPT, and on-device models needs a neutral routing layer. That's our wedge."*

**"How are you going to acquire customers?"**
> *"Two channels. Consumer: SEO on 'moving checklist' and 'moving stress' — high-intent. B2B: every voice-agent startup in your portfolio is a candidate. Vapi, Retell, Bland, Pi.ai customers all need this."*

**"What does it cost you to run Relocate per move?"**
> *"$3.50 in direct COGS — $1.40 AgentPhone, $0.55 in PAVO inference, the rest is sponsor APIs. Margin: 96% on a $99 flat fee."*

**"Why didn't this exist before?"**
> *"Two things had to converge. Routing-layer research mature enough to publish — PAVO did that this year. AgentPhone shipping in February. Before AgentPhone, sixteen voice agents in parallel was a Twilio + custom-WebSocket nightmare."*

**"What's actually real on stage?"**
> *"The telephony is real. The routing layer is real. The artifacts the judge gets are real — pull out your phone and look at your inbox right now. The counterparty side of the utility calls is theater because utility IVRs don't accept AI cancellations. We're up-front about that on the dashboard — every sponsor is labeled REAL or STUB or ERR. We don't fake what we couldn't ship."*
