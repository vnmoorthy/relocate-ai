"""Buy phone numbers for voice-mode agents that don't have one yet.

During the initial provisioning run, 3 backlog voice agents (vet_transfer, gym_cancel,
pharmacy) failed at the buy_number step. This script retries just those.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agentphone import AgentPhoneClient, AgentPhoneError  # noqa: E402


REGISTRY = Path(__file__).resolve().parent.parent / "agents.json"


async def main() -> None:
    data = json.loads(REGISTRY.read_text())
    agents = data.get("agents", [])

    missing = [a for a in agents if a["voice_mode"] == "voice" and not a.get("phone_e164")]
    if not missing:
        print("All voice-mode agents have phone numbers.")
        return

    print(f"Buying numbers for {len(missing)} agents:")
    for a in missing:
        print(f"  - {a['agent_id']} (status={a['status']})")
    print()

    client = AgentPhoneClient()
    fixed = 0
    for entry in missing:
        ap_id = entry["agentphone_id"]
        try:
            num = await client.buy_number(ap_id, country="US")
            entry["number_id"] = num.get("id")
            entry["phone_e164"] = num.get("phoneNumber") or num.get("phone_e164")
            print(f"  [ok]    {entry['agent_id']:18s} phone={entry['phone_e164']}")
            fixed += 1
        except AgentPhoneError as e:
            print(f"  [ERROR] {entry['agent_id']}: {e}")
    await client.aclose()

    REGISTRY.write_text(json.dumps({"agents": agents}, indent=2))
    print(f"\nFixed {fixed}/{len(missing)}. Registry saved.")


if __name__ == "__main__":
    asyncio.run(main())
