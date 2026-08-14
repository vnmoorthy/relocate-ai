# Relocate demo runbook

This runbook keeps the demonstration aligned with what the repository proves.
Choose one mode before presenting and state it plainly:

- **Replay demo (recommended):** deterministic client-side events; no provider
  calls or external side effects.
- **Authorized live demo:** a provisioned AgentPhone account and explicitly
  selected provider sandboxes/test accounts. Never improvise a live run against
  real customer or institution accounts.

Do not describe replay events, mocked tests, playbook emails, or provider
submission IDs as completed relocation transactions.

## 90-second replay demo

### 0:00–0:15 — Problem and boundary

> “Relocate is a relocation-orchestration platform in developer preview: it
> turns one moving conversation into a set of parallel specialist workflows.
> This screen is running a deterministic
> simulation — you can see the SIMULATION tag on the panel, the same way SpaceX
> stamps its renders; I’ll distinguish implemented code from live-provider
> validation as we go.”

Point to the SIMULATION tag on the dashboard panel before the animation
starts; in a live session it reads LIVE instead.

### 0:15–0:35 — Buyer and dispatch

> “The inbound buyer is the one voice persona. The backend incrementally
> collects origin, destination, date, and email, then applies household flags.
> Once the core fields and the household questions are answered, it chooses
> the applicable specialists — and if the caller hangs up early, it dispatches
> at call end with whatever was confirmed.”

Call out that the configured roster is one buyer plus 16 specialists, while an
individual move dispatches 11–16 specialists.

### 0:35–1:00 — Parallel workflows

> “The specialists are browser, email, and postal-mail workflows—not 16 voice
> calls. The orchestrator runs them concurrently and streams state, transcript,
> routing, and artifact events to the dashboard. One failure is isolated from
> the rest.”

The simulation shows this honestly: one specialist fails mid-run while the
others continue, three end as needs-user-action handoffs (USCIS signature,
HIPAA consent, gym authorization), and the rest end as submissions. Point at
the failed and paused cells when you say the line above.

When an artifact appears, describe it precisely:

- “replayed blocked-browser workflow,” not “PG&E was disconnected”;
- “email request identifier,” not “the school enrolled the child”;
- “letter submission identifier,” not “the provider accepted cancellation”;
- “user-action handoff,” not “the government form was filed.”

### 1:00–1:20 — Routing and fallback

> “PAVO is an authenticated completion service. The open repository routes
> deterministically among a local model, Gemini, and Anthropic using transparent
> heuristics. If a provider tier fails, it tries another configured tier; if all
> fail, the request errors rather than inventing a response.”

If the UI displays cost, explain that it is an estimate based on configured
prices and provider usage, not an invoice. Do not present historical benchmark
numbers unless the exact reproducible benchmark artifact is separately shown.

### 1:20–1:30 — Honest close

> “What is built is the orchestration and demonstration layer. The next work is
> durable jobs and state, secure customer intake and approvals, provider sandbox
> certification, authenticated live UI, and production operations.”

Open [STATUS.md](STATUS.md) for detailed questions.

## Authorized live-demo checklist

Complete this checklist before placing a call or enabling any provider path:

- [ ] The operator owns or is explicitly authorized to use every identity,
  account, phone number, recipient, and address in the test.
- [ ] `orchestrator/.env` contains only isolated development/sandbox keys.
- [ ] Stripe test mode is on; Lob uses test mode; no live payment/mail key is
  present.
- [ ] The generated `agents.json` matches the provisioned AgentPhone buyer.
- [ ] PAVO, orchestrator, and dashboard health checks pass.
- [ ] Webhook signing has been verified against the current vendor contract.
- [ ] The exact specialist subset is known; unapproved integrations are blank or
  feature-disabled.
- [ ] Any email recipient is allowlisted and controlled by the demo team, and
  `AGENTMAIL_ALLOWED_RECIPIENTS` lists exactly those addresses (it is empty by
  default, which blocks every outbound email).
- [ ] Browser targets cannot mutate a real account or charge a real card without
  a deliberate approval.
- [ ] Expected cleanup, cancellation, mail suppression, and data deletion are
  documented.
- [ ] A replay-demo fallback is already open if the live path fails.

Run safe checks first:

```bash
./verify-all-agents.sh
bash orchestrator/tests/preflight.sh

cd web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Start locally with `./run.sh`. It prints a `http://127.0.0.1:3000/#ws-token=…`
URL for the authenticated live view; open that URL (not the bare dashboard) if
the demo should show live orchestrator events instead of the simulation. A
public tunnel is opt-in via `--ngrok`; do not enable it until the exposed
webhook routes and authentication have been reviewed. The current phone number
is deployment state and should be read from the authorized AgentPhone account,
not hard-coded into presentation material.

## Live narration rules

Say:

- “request submitted” when a provider accepted a request;
- “needs user action” when a signature, MFA, payment, or final click remains;
- “completed” only after final provider confirmation that meets a documented
  evidence contract;
- “policy blocked” when Browser Use, Lob, medical, pharmacy, or another unsafe
  path requires a secure/user-approved workflow;
- “failed” or “unavailable” when a provider errors.

Never say:

- all 17 agents fired if conditional selection launched fewer;
- every artifact is live during replay/mocked mode;
- a letter ID proves delivery or cancellation;
- an email ID proves the recipient acted;
- a browser task ID proves the target transaction succeeded;
- a prepared USCIS/DMV form was filed or accepted;
- a routing benchmark, model parameter count, latency, energy, margin, or cost
  is current without showing its reproducible source;
- the system is production-secure, HIPAA compliant, legally authorized, or
  fully autonomous.

## Failure plan

If live connectivity or a provider fails:

1. state the failure without hiding or relabeling it;
2. show the surfaced error/retry state if useful;
3. switch to the simulation (the panel tag flips from LIVE to SIMULATION);
4. explain which contract or infrastructure layer remains incomplete;
5. do not rerun an irreversible provider action unless idempotency and cleanup
   have been verified.

The best demo is legible about the boundary between product vision, implemented
workflow code, and externally verified completion.
