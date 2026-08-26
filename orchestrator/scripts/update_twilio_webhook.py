"""Point the Twilio number's voice webhooks at the current PUBLIC_BASE_URL.

The development tunnel gets a new hostname whenever it restarts, and a Twilio
number keeps calling whatever URL it was last told about — so without this a
rotation silently sends every caller to a dead host. The supervisor runs this
alongside the AgentPhone re-point.

Idempotent: it reads the number's current configuration and only writes when
something actually changed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402

API = "https://api.twilio.com/2010-04-01"


def main() -> int:
    sid = settings.twilio_account_sid.strip()
    token = settings.twilio_auth_token.strip()
    number = settings.twilio_phone_number.strip()
    if not (sid and token and number):
        print("twilio rail not configured (need SID, auth token and number) — skipping")
        return 0

    base = settings.public_base_url.rstrip("/")
    if not base.startswith("https://"):
        print(f"FATAL: PUBLIC_BASE_URL={base!r} is not https — Twilio would refuse it.")
        return 1

    voice_url = f"{base}/webhook/twilio/voice"
    status_url = f"{base}/webhook/twilio/status"
    auth = (sid, token)

    with httpx.Client(timeout=20, auth=auth) as client:
        found = client.get(
            f"{API}/Accounts/{sid}/IncomingPhoneNumbers.json",
            params={"PhoneNumber": number},
        )
        if found.status_code != 200:
            print(f"FATAL: could not list numbers ({found.status_code}): {found.text[:200]}")
            return 1
        entries = found.json().get("incoming_phone_numbers", [])
        if not entries:
            print(f"FATAL: {number} is not on this Twilio account.")
            return 1

        entry = entries[0]
        if entry.get("voice_url") == voice_url and entry.get("status_callback") == status_url:
            print(f"twilio webhooks already current: {voice_url}")
            return 0

        updated = client.post(
            f"{API}/Accounts/{sid}/IncomingPhoneNumbers/{entry['sid']}.json",
            data={
                "VoiceUrl": voice_url,
                "VoiceMethod": "POST",
                "StatusCallback": status_url,
                "StatusCallbackMethod": "POST",
            },
        )
        if updated.status_code not in (200, 201):
            print(f"FATAL: update failed ({updated.status_code}): {updated.text[:200]}")
            return 1

    print(f"twilio webhook now -> {voice_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
