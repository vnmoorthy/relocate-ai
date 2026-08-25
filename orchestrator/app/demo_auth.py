"""Credential gate for the product surface at /app.

The product page is a static export, so it cannot hold a secret: it posts
the credentials here and the server decides. What comes back is a signed,
expiring bearer token — not the password — so nothing sensitive is ever
stored in the browser or shipped in the bundle.

This is deliberately a SHARED demo workspace, not per-user authentication:
one credential pair, published to reviewers, scoped to moves created through
that workspace. Real callers' moves are never listed to it.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from .config import settings

_TOKEN_VERSION = "v1"
# A blank secret falls back to a per-process key: tokens then die with a
# restart, which is safe (users log in again) and never weaker.
_FALLBACK_SECRET = secrets.token_hex(32)


def _key() -> bytes:
    return (settings.public_ref_secret or _FALLBACK_SECRET).encode()


def enabled() -> bool:
    """The gate is off unless a password is configured."""
    return bool(settings.demo_password.strip())


def verify_credentials(username: str, password: str) -> bool:
    """Constant-time credential check. False whenever the gate is disabled."""
    if not enabled():
        return False
    user_ok = hmac.compare_digest(
        (username or "").strip().lower(), settings.demo_username.strip().lower(),
    )
    pass_ok = hmac.compare_digest(password or "", settings.demo_password)
    # Both comparisons always run: no early return to time against.
    return user_ok and pass_ok


def issue_token(now: float | None = None) -> tuple[str, int]:
    """Return (token, expires_at) for a fresh session."""
    expires_at = int((now or time.time()) + settings.demo_session_hours * 3600)
    payload = f"{_TOKEN_VERSION}.{expires_at}"
    sig = hmac.new(_key(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{sig}", expires_at


def valid_token(token: str | None, now: float | None = None) -> bool:
    """True only for a well-formed, unexpired, correctly-signed token."""
    if not enabled() or not token:
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    version, expires_raw, sig = parts
    if version != _TOKEN_VERSION:
        return False
    try:
        expires_at = int(expires_raw)
    except ValueError:
        return False
    if expires_at <= (now or time.time()):
        return False
    expected = hmac.new(
        _key(), f"{version}.{expires_at}".encode(), hashlib.sha256,
    ).hexdigest()[:32]
    return hmac.compare_digest(expected, sig)
