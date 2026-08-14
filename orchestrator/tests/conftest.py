"""Shared test configuration.

Tests never load real service credentials. Environment variables are populated
before application modules import the Pydantic settings singleton, so a clean
checkout can collect the suite without an ``orchestrator/.env`` file.
"""

from __future__ import annotations

import os


os.environ.setdefault("AGENTPHONE_API_KEY", "ap_test_no_network")
os.environ.setdefault("PAVO_API_KEY", "pavo_test_no_network")
os.environ.setdefault("PUBLIC_BASE_URL", "http://testserver")
# The default suite runs purely in memory; persistence tests opt in with an
# explicit temporary database.
os.environ["DATABASE_PATH"] = ""

# Explicitly blank every integration credential. A unit test that needs an
# integration must monkeypatch its boundary rather than reaching the network.
# Supplying only one acceptance gate must never expose the rest of the suite to
# credentials loaded from a developer's .env file.
_acceptance_enabled = (
    os.environ.get("RUN_PROVIDER_ACCEPTANCE") == "1"
    and os.environ.get("PROVIDER_ACCEPTANCE_ACK") == "I_ACCEPT_EXTERNAL_SIDE_EFFECTS"
)
if not _acceptance_enabled:
    for _name in (
        "AGENTMAIL_ALLOWED_RECIPIENTS",
        "AGENTMAIL_API_KEY",
        "ANTHROPIC_API_KEY",
        "BROWSERUSE_API_KEY",
        "GEMINI_API_KEY",
        "LOB_API_KEY",
        "MOSS_PROJECT_ID",
        "MOSS_PROJECT_KEY",
        "OPENAI_API_KEY",
        "SPONGE_API_KEY",
        "STRIPE_SECRET_KEY",
        "SUPERMEMORY_API_KEY",
    ):
        os.environ[_name] = ""
