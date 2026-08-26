# Relocate — 5-minute product demo

**Before you hit record**

1. `./demo-line.sh` running in its own terminal. Confirm `curl -s $(cat ~/.relocate/runtime/tunnel-url)/healthz` returns ok.
2. Deployed `live.json` matches that tunnel URL. If the supervisor logged `ACTION NEEDED`, commit and push `web/public/live.json` and wait for Pages (~2 min).
3. Open two tabs: `https://vnmoorthy.github.io/relocate-ai/` and `https://vnmoorthy.github.io/relocate-ai/app/`.
4. Sign in at `/app` beforehand so recording starts past the login (or record the login — it's 8 seconds and it proves the gate).
5. Have your own inbox open in a third tab. The emails are the payoff.

Total: 5:00. Timings are generous — cut, don't rush.

---

## 0:00–0:30 · The problem, in one sentence

> "Moving means about thirty separate errands with thirty different institutions, and every one of them wants the same eight facts about you. Nobody has built the thing that just does it."

On screen: the homepage hero.

**Don't** explain the architecture yet. Say the problem, then show the product.

---

## 0:30–1:15 · Brief it once

Go to `/app`, land on **New dispatch**.

Fill the form while talking — don't narrate the fields, narrate the point:

> "One brief. Where you're leaving, where you're going, when, and how to reach you. Pets, kids, car, visa — those four checkboxes decide which specialists are relevant to you."

Use a real-looking move (SF → Austin), tick **pets**, **kids**, **car**. Add a work address.

Hit **Start the dispatch**.

---

## 1:15–2:30 · The swarm, live

The tracker opens on its own.

> "Twenty-four specialists just fanned out in parallel. This is live — this is not a replay."

(Twenty-eight is the full roster; the four visa-only specialists sat out because you didn't tick visa. If you tick it, say twenty-eight.)

Point at three things, in this order:

1. **The counts.** Read the chips off the screen — they move with the flags you ticked and with which providers are configured. Something like: "Fourteen submitted, ten waiting on me."
2. **The honest line under them.** Read it out loud, verbatim:
   > "Submitted means the provider accepted the request — the underlying service change is not confirmed complete."
   Then: *"That sentence is the product. Every agent tool on the market will tell you it finished. This one tells you what actually happened."*
3. **What you still own.** "The rest need me — and every one arrives with the exact script or letter already written." A prepared specialist sits in the submitted column but its line reads "Prepared for you — the final step is yours." Read that line, not the column.

---

## 2:30–3:30 · The part nobody else does

Switch to your inbox. Show three emails:

- **Your arrival pack** — "Nine things prepared. Housing near the office. The commute checked at the hours I actually travel. What to buy the first night." (Twelve sections on a visa move: banking, currency, and the counsel briefing pack join.) Say **prepared**, never "handled" — nothing in that email was sent to anyone but you.
- **What we prepared for you** — "Every blocked task, with the call script filled in from my move."
- **Documents for your review** — open the **Comcast cancellation letter** and the **HIPAA release**. "Written from my details, ready to sign. Relocate never signs them. That's deliberate."

> "This is the difference between an agent that says 'I couldn't do that' and one that hands you the thing you need to finish it yourself."

---

## 3:30–4:15 · The loop closes

Back to the tracker. Scroll to **Quotes**.

> "The movers replied. It parsed the quotes out of the emails — total, deposit, availability — and sorted them. Cheapest is tagged."

Read the footer line out loud:
> "You choose — Relocate never books or signs anything without you."

If you want the live version: send a reply with `[ref:<move-id>:mover_quote]` in the subject before recording, and let it land on camera — the poller picks it up within 45 seconds and the page updates with no reload.

---

## 4:15–5:00 · Why it holds up

Homepage → scroll to the router panel.

> "Most turns run on a two-billion-parameter model on this laptop. It only escalates to a frontier model when the turn is actually hard. That's the unit economics — a move costs cents, not dollars."

Close on the honesty point, because it's the moat:

> "Twenty-nine agents, four execution modes, and zero fabricated successes. When something needs a signature, a credential, or a human decision, it says so and hands you a prepared next step. That's what makes it safe to point at someone's actual move."

---

## If a partner asks

- **"Is this real or a demo?"** — Real emails, real provider receipts, live SQLite state. The phone line is down right now because the number was released by the carrier; the voice pipeline is unchanged and a new number re-points automatically.
- **"What can't it do?"** — Anything requiring credentials or a signature: utility portals, USPS identity verification, prescriptions. Those are gated on purpose, and each one hands back a prepared artifact instead.
- **"Why should you win?"** — The honesty layer is the hard part, not the fan-out. Everyone can call twelve APIs. Reporting truthfully when eleven of them didn't finish is what makes it usable for a real move.

## Recording notes

- 1440×900, browser zoom 100%. Hide bookmarks bar.
- The swarm section is the money shot — let it breathe for 3-4 seconds before talking over it.
- Don't demo the phone line until a number is attached.
- If the tunnel rotates mid-record, the page shows Simulation. Stop, republish `live.json`, start again.
