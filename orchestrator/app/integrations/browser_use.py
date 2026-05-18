"""Browser Use — submit the USPS Change-of-Address form via web automation.

Fires when the USPS specialist agent is dispatched during fan-out (~0:30 of demo).
Real submission against a burner USPS account staged earlier.
"""
from __future__ import annotations

import httpx

from ..config import settings
from ._common import safe_call


BROWSERUSE_BASE = "https://api.browser-use.com/v1"  # adjust to actual


async def submit_usps_coa(
    event_id: str,
    old_address: str,
    new_address: str,
    move_date: str,
    burner_email: str = "moorthy.usps.burner@gmail.com",
) -> dict | None:
    """Tell Browser Use to fill the USPS COA form.

    Browser Use's typical pattern: submit a 'task' describing the goal in natural
    language; Browser Use spawns a headless browser, executes, and returns a task
    ID + result.
    """
    has_key = bool(settings.browseruse_api_key) and settings.browseruse_api_key != "REPLACE_ME"

    task_description = (
        f"Go to moversguide.usps.com. Click 'Get Started'. Fill out the Change of "
        f"Address form with: old address '{old_address}', new address '{new_address}', "
        f"move date '{move_date}', mover type 'family', individual move. "
        f"Use burner credentials for login if prompted (email {burner_email}). "
        f"Submit the form. Capture the USPS confirmation number from the success page."
    )

    async def _do() -> dict:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                f"{BROWSERUSE_BASE}/tasks",
                headers={"Authorization": f"Bearer {settings.browseruse_api_key}"},
                json={
                    "task": task_description,
                    "max_steps": 25,
                    "metadata": {"event_id": event_id, "specialist": "usps_coa"},
                },
            )
            r.raise_for_status()
            data = r.json()
            return {"task_id": data.get("id"), "status": data.get("status", "running")}

    return await safe_call(
        event_id=event_id,
        sponsor="browser_use",
        action="usps_form_submitted",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would submit USPS COA for {old_address} → {new_address}",
    )
