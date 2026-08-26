"""Provision the one AgentPhone voice agent used by the current roster.

Run ONCE before the demo. Idempotent: re-running skips agents that already have
an entry in agents.json.

Output: orchestrator/agents.json with entries like:
  {"agent_id": "pge_shutoff", "agentphone_id": "agt_xxx", "number_id": "num_xxx",
   "phone_e164": "+15551234567", "webhook_secret": "whsec_xxx"}

Only ``buyer`` is a voice-mode persona. The 28 specialists run in-process via
browser, email, or mail providers and must not consume AgentPhone agents or
phone numbers.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Allow running as `python scripts/provision_agents.py` from orchestrator/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agentphone import AgentPhoneClient, AgentPhoneError  # noqa: E402
from app.config import settings  # noqa: E402
from app.personas import PERSONAS  # noqa: E402


REGISTRY_PATH = Path(__file__).resolve().parent.parent / "agents.json"


async def main() -> None:
    existing: dict[str, dict] = {}
    if REGISTRY_PATH.exists():
        existing = {e["agent_id"]: e for e in json.loads(REGISTRY_PATH.read_text()).get("agents", [])}

    client = AgentPhoneClient()
    out: list[dict] = list(existing.values())
    voice_personas = [persona for persona in PERSONAS if persona.voice_mode == "voice"]

    public_base = settings.public_base_url.rstrip("/")
    if "CHANGE_ME" in public_base or "localhost" in public_base:
        print(f"WARN: PUBLIC_BASE_URL={public_base} — webhooks will not reach this box from AgentPhone.")
        print("WARN: start `ngrok http 8000` and update PUBLIC_BASE_URL in .env before running this script.")
        if "--ignore-tunnel" not in sys.argv:
            sys.exit(1)

    for persona in voice_personas:
        if persona.agent_id in existing:
            print(f"[skip] {persona.agent_id} already provisioned: {existing[persona.agent_id].get('phone_e164')}")
            continue

        print(f"[create-agent] {persona.agent_id} ({persona.name})...")
        try:
            agent = await client.create_agent(
                name=f"move-{persona.agent_id}",
                system_prompt=persona.system_prompt,
                voice_mode="webhook",
                voice=persona.voice,
                model_tier="turbo",
            )
        except AgentPhoneError as e:
            print(f"[ERROR] create_agent failed for {persona.agent_id}: {e}")
            continue
        ap_id = agent.get("id") or agent.get("agentId")
        if not isinstance(ap_id, str) or not ap_id:
            print(f"[ERROR] create_agent returned no id for {persona.agent_id}")
            continue

        entry = {
            "agent_id": persona.agent_id,
            "agentphone_id": ap_id,
            "category": persona.category,
            "voice_mode": persona.voice_mode,
        }

        # Webhook registration.
        try:
            wh = await client.set_agent_webhook(
                ap_id,
                url=f"{public_base}/webhook/agent/{persona.agent_id}",
                timeout=30,
                context_limit=5,
            )
            entry["webhook_secret"] = wh.get("secret", "")
        except AgentPhoneError as e:
            print(f"[ERROR] set_agent_webhook failed for {persona.agent_id}: {e}")
            continue

        # Number provisioning — only for voice-mode agents (browser-mode skip).
        if persona.voice_mode == "voice":
            try:
                num = await client.buy_number(ap_id, country="US")
                number_id = num.get("id")
                phone_e164 = num.get("phoneNumber") or num.get("phone_e164")
                if isinstance(number_id, str) and number_id:
                    entry["number_id"] = number_id
                if isinstance(phone_e164, str) and phone_e164:
                    entry["phone_e164"] = phone_e164
            except AgentPhoneError as e:
                print(f"[ERROR] buy_number failed for {persona.agent_id}: {e}")

        out.append(entry)
        print(f"[ok] {persona.agent_id}: agentphone_id={ap_id} phone={entry.get('phone_e164', '(none)')}")
        # Save incrementally so a partial run is recoverable.
        REGISTRY_PATH.write_text(json.dumps({"agents": out}, indent=2))

    await client.aclose()
    print(f"\nManaged {len(voice_personas)} voice agent(s). Registry at {REGISTRY_PATH}.")
    buyer = next((e for e in out if e["agent_id"] == "buyer"), None)
    if buyer:
        print(f"\n>>> BUYER AGENT NUMBER (judge dials this): {buyer.get('phone_e164')}\n")


if __name__ == "__main__":
    asyncio.run(main())
