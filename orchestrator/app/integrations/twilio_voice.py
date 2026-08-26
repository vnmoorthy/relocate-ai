"""Twilio as a second telephony rail for the concierge.

The concierge core (`_run_buyer_turn`) does not care where a transcript came
from — AgentPhone posts one shape, a browser microphone posts another, and
Twilio posts a third. This module is only the translation layer: verify the
request really came from Twilio, hand the speech to the core, and render the
reply as TwiML.

Speech recognition is Twilio's (`<Gather input="speech">`), so no audio ever
reaches this service — only the transcript, exactly as with the other rails.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from urllib.parse import urlencode
from xml.sax.saxutils import escape

log = logging.getLogger(__name__)


def verify_signature(
    *, auth_token: str, url: str, params: dict[str, str], signature: str | None,
) -> bool:
    """Validate Twilio's X-Twilio-Signature over the exact request.

    Twilio signs the full URL with the POST parameters appended in sorted
    order. An unsigned or mismatched request is not from Twilio and must not
    be allowed to drive a call.
    """
    if not auth_token or not signature:
        return False
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    digest = hmac.new(
        auth_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha1,
    ).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, signature)


def _say(text: str) -> str:
    # Twilio reads the TwiML body literally, so anything unescaped breaks the
    # document rather than merely looking wrong.
    return f"<Say voice=\"Polly.Joanna\">{escape(text)}</Say>"


def gather_twiml(
    *, say: str, action_url: str, timeout: int = 5, speech_timeout: str = "auto",
) -> str:
    """Speak a line, then listen for the caller's reply.

    ``<Gather>`` posts the transcript back to ``action_url``; the trailing
    redirect covers the case where the caller says nothing at all, so the
    call never dead-ends in silence.
    """
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Gather input="speech" action="{escape(action_url, {chr(34): "&quot;"})}" '
        f'method="POST" timeout="{timeout}" speechTimeout="{speech_timeout}" '
        f'actionOnEmptyResult="true">'
        f"{_say(say)}"
        "</Gather>"
        f'<Redirect method="POST">{escape(action_url, {chr(34): "&quot;"})}</Redirect>'
        "</Response>"
    )


def hangup_twiml(say: str) -> str:
    """Say a closing line and end the call."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Response>{_say(say)}<Hangup/></Response>"
    )


def build_action_url(base_url: str) -> str:
    """Absolute URL Twilio should post the next turn to."""
    return f"{base_url.rstrip('/')}/webhook/twilio/voice"


def signed_url_for(base_url: str, params: dict[str, str] | None = None) -> str:
    """The exact URL Twilio signs — used by tests and by signature checks."""
    url = build_action_url(base_url)
    return f"{url}?{urlencode(params)}" if params else url
