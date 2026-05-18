"""Push refreshed AgentPhone agent configs — voice, begin_message, system_prompt, tuning.

After updating personas.py (voice swapped to ElevenLabs, prompts rewritten for natural
dialogue, begin_message set for buyer), this script syncs the changes to AgentPhone
for all 16 provisioned agents. Idempotent.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from app.config import settings  # noqa: E402
from app.personas import PERSONAS  # noqa: E402


REGISTRY = Path(__file__).resolve().parent.parent / "agents.json"


async def main() -> None:
    data = json.loads(REGISTRY.read_text())
    agents = {a["agent_id"]: a for a in data.get("agents", [])}

    print(f"Refreshing config for {len(agents)} agents…")
    print()

    async with httpx.AsyncClient(
        timeout=20.0,
        headers={"Authorization": f"Bearer {settings.agentphone_api_key}"},
    ) as c:
        for persona in PERSONAS:
            entry = agents.get(persona.agent_id)
            if not entry:
                print(f"  [skip] {persona.agent_id}: not in agents.json")
                continue
            ap_id = entry["agentphone_id"]

            body: dict = {
                "systemPrompt": persona.system_prompt,
                "modelTier": "turbo",
            }
            if persona.voice:
                body["voice"] = persona.voice
            if persona.begin_message:
                body["beginMessage"] = persona.begin_message
            body["voiceSpeed"] = persona.voice_speed
            body["interruptionSensitivity"] = persona.interruption_sensitivity

            r = await c.patch(f"{settings.agentphone_base_url}/agents/{ap_id}", json=body)
            if r.status_code >= 400:
                # Some APIs use PUT for full updates
                r2 = await c.put(f"{settings.agentphone_base_url}/agents/{ap_id}", json=body)
                if r2.status_code >= 400:
                    print(f"  [ERR] {persona.agent_id}: PATCH {r.status_code} / PUT {r2.status_code}")
                    print(f"        PATCH body: {r.text[:160]}")
                    continue
            voice_label = persona.voice or "(browser, no voice)"
            print(f"  [ok]  {persona.agent_id:18s} voice={voice_label:20s} speed={persona.voice_speed}")

    print()
    print("Done. Agents now use ElevenLabs voices + conversational prompts.")


if __name__ == "__main__":
    asyncio.run(main())
