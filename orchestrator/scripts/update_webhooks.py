"""Update provisioned AgentPhone webhook URLs to the current PUBLIC_BASE_URL.

Use when a development tunnel URL changes.
Does NOT create new agents or buy new numbers — only updates webhook URL/secret.
Updates agents.json in place with any new webhook_secrets returned.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agentphone import AgentPhoneClient, AgentPhoneError  # noqa: E402
from app.config import settings  # noqa: E402


REGISTRY = Path(__file__).resolve().parent.parent / "agents.json"


async def main() -> None:
    data = json.loads(REGISTRY.read_text())
    agents = data.get("agents", [])
    public_base = settings.public_base_url.rstrip("/")
    if "localhost" in public_base or "CHANGE_ME" in public_base:
        print(f"FATAL: PUBLIC_BASE_URL={public_base} — won't reach AgentPhone webhooks.")
        sys.exit(1)

    print(f"Updating {len(agents)} webhook URLs → {public_base}/webhook/agent/<agent_id>")
    client = AgentPhoneClient()
    updated = 0
    for entry in agents:
        agent_id = entry["agent_id"]
        ap_id = entry.get("agentphone_id")
        if not ap_id:
            # v2: only the buyer is an AgentPhone voice agent. The other 16
            # are browser/email/mail mode and have no AgentPhone webhook to
            # push.
            print(f"  [skip] {agent_id}: no agentphone_id (mode={entry.get('voice_mode', '?')})")
            continue
        url = f"{public_base}/webhook/agent/{agent_id}"
        try:
            wh = await client.set_agent_webhook(ap_id, url=url, timeout=30, context_limit=5)
            secret = wh.get("secret")
            if secret and secret != entry.get("webhook_secret"):
                entry["webhook_secret"] = secret
                print(f"  [updated+secret-rotated] {agent_id}")
            else:
                print(f"  [updated] {agent_id}")
            updated += 1
        except AgentPhoneError as e:
            print(f"  [ERROR] {agent_id}: {e}")
    await client.aclose()

    REGISTRY.write_text(json.dumps({"agents": agents}, indent=2))
    print(f"\nUpdated {updated}/{len(agents)} webhooks. Registry saved.")


if __name__ == "__main__":
    asyncio.run(main())
