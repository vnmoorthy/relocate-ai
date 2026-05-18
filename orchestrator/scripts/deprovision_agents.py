"""Deprovision AgentPhone agents + numbers that were removed in the v2 roster cut.

Reads `_removed_v2` from orchestrator/agents.json, then for each entry:
  - DELETE /numbers/{number_id}   (if present)  — stops monthly billing per number
  - DELETE /agents/{agentphone_id}              — frees the AgentPhone slot

USAGE:
  cd orchestrator
  uv run python scripts/deprovision_agents.py --dry-run     # show what would be deleted
  uv run python scripts/deprovision_agents.py --execute     # actually delete

DESTRUCTIVE — requires --execute to actually call DELETE.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_JSON = REPO_ROOT / "agents.json"


def load_removed() -> list[dict]:
    data = json.loads(AGENTS_JSON.read_text())
    return data.get("_removed_v2", [])


async def deprovision(execute: bool) -> int:
    # Lazy import so dry-run works without a real .env.
    sys.path.insert(0, str(REPO_ROOT))
    from app.config import settings

    base = settings.agentphone_base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.agentphone_api_key}",
        "Content-Type": "application/json",
    }

    removed = load_removed()
    if not removed:
        print("No removed agents in agents.json — nothing to deprovision.")
        return 0

    errors = 0
    print(f"\n{'EXECUTING' if execute else 'DRY-RUN'} — would deprovision {len(removed)} entries\n")
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as c:
        for entry in removed:
            agent_id = entry.get("agent_id", "?")
            ap_id = entry.get("agentphone_id")
            num_id = entry.get("number_id")
            print(f"• {agent_id}")
            if num_id:
                print(f"    DELETE /numbers/{num_id}")
                if execute:
                    try:
                        r = await c.delete(f"{base}/numbers/{num_id}")
                        print(f"      → {r.status_code}")
                        if r.status_code >= 400 and r.status_code != 404:
                            errors += 1
                    except Exception as e:
                        print(f"      ERROR: {e}")
                        errors += 1
            if ap_id:
                print(f"    DELETE /agents/{ap_id}")
                if execute:
                    try:
                        r = await c.delete(f"{base}/agents/{ap_id}")
                        print(f"      → {r.status_code}")
                        if r.status_code >= 400 and r.status_code != 404:
                            errors += 1
                    except Exception as e:
                        print(f"      ERROR: {e}")
                        errors += 1
            print()

    if execute:
        print(f"Done. {errors} errors.")
    else:
        print("Dry-run complete. Re-run with --execute to actually delete.")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="actually delete (destructive)")
    ap.add_argument("--dry-run", action="store_true", help="default — show only")
    args = ap.parse_args()
    if not args.execute and not args.dry_run:
        args.dry_run = True
    return asyncio.run(deprovision(execute=args.execute))


if __name__ == "__main__":
    raise SystemExit(main())
