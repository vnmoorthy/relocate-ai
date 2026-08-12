"""Synthetic-input tests for the repository's PAVO routing policy.

Import through the ``pavo_server`` package so test collection cannot shadow the
orchestrator's top-level ``app`` package. The cases cover the documented policy
branches:

  1. Hysteresis: prior opus, non-trivial → stays opus
  2. Hard escalation keywords → opus
  3. Buyer-extract role → Gemini floor
  4. Medium pattern (pricing) → Gemini
  5. Early-call greeting → gemma-local
  6. Default small-talk → gemma-local
"""
from __future__ import annotations

from pavo_server.route import route_turn


# -----------------------------------------------------------------------------
# 1. Hysteresis — sticky opus
# -----------------------------------------------------------------------------
def test_hysteresis_keeps_opus_on_substantive_followup() -> None:
    d = route_turn(
        transcript="I would also like to file a complaint about the rate calculation method.",
        history_depth=4,
        role_hint="contractor-insurance-auto",
        prior_tier="claude-opus",
    )
    assert d.tier == "claude-opus"
    assert "hysteresis" in d.reason


def test_hysteresis_releases_opus_on_trivial_followup() -> None:
    d = route_turn(
        transcript="Yes.",
        history_depth=4,
        role_hint="contractor-utility-electric-gas",
        prior_tier="claude-opus",
    )
    # Short trivial turn: hysteresis releases.
    assert d.tier != "claude-opus"


# -----------------------------------------------------------------------------
# 2. Hard escalation
# -----------------------------------------------------------------------------
def test_legal_keyword_routes_to_opus() -> None:
    d = route_turn(
        transcript="If you don't process this refund I'll escalate to a supervisor and contact my attorney.",
        history_depth=3,
        role_hint="contractor-utility-internet-sf",
    )
    assert d.tier == "claude-opus"


def test_compliance_keyword_routes_to_opus() -> None:
    d = route_turn(
        transcript="I need to speak to a compliance officer about TCPA.",
        history_depth=3,
        role_hint="contractor-insurance-auto",
    )
    assert d.tier == "claude-opus"


# -----------------------------------------------------------------------------
# 3. Buyer-extract role floor
# -----------------------------------------------------------------------------
def test_buyer_extract_floors_at_gemini() -> None:
    d = route_turn(
        transcript="Hi.",  # trivial content but extract role forces floor
        history_depth=1,
        role_hint="buyer-extract",
    )
    assert d.tier in ("gemini-flash", "claude-opus")
    assert "buyer-extract" in d.reason


# -----------------------------------------------------------------------------
# 4. Medium patterns → Gemini
# -----------------------------------------------------------------------------
def test_pricing_keyword_routes_to_gemini() -> None:
    d = route_turn(
        transcript="What's the early termination fee on the disconnect?",
        history_depth=3,
        role_hint="contractor-utility-electric-gas",
    )
    assert d.tier == "gemini-flash"


def test_cancellation_keyword_routes_to_gemini() -> None:
    d = route_turn(
        transcript="I want to cancel my service, what's the final-bill date?",
        history_depth=3,
        role_hint="contractor-utility-internet-sf",
    )
    assert d.tier == "gemini-flash"


def test_quote_keyword_routes_to_gemini() -> None:
    d = route_turn(
        transcript="Can you give me an out-the-door quote including parts and labor?",
        history_depth=3,
        role_hint="contractor-mover",
    )
    assert d.tier == "gemini-flash"


# -----------------------------------------------------------------------------
# 5. Early-call greeting clamp
# -----------------------------------------------------------------------------
def test_early_greeting_clamps_to_gemma_local() -> None:
    d = route_turn(
        transcript="Hello, how can I help you today?",
        history_depth=1,
        role_hint="contractor-utility-electric-gas",
    )
    assert d.tier == "gemma-local"


# -----------------------------------------------------------------------------
# 6. Default small-talk
# -----------------------------------------------------------------------------
def test_default_small_talk_routes_to_gemma_local() -> None:
    d = route_turn(
        transcript="Got it.",
        history_depth=4,
        role_hint="contractor-utility-electric-gas",
    )
    assert d.tier == "gemma-local"


def test_acknowledgment_routes_to_gemma_local() -> None:
    d = route_turn(
        transcript="Yes, that's correct, thanks.",
        history_depth=3,
        role_hint="contractor-postal",
    )
    assert d.tier == "gemma-local"


# -----------------------------------------------------------------------------
# Smoke: full call simulation (sanity check the policy emits a mix)
# -----------------------------------------------------------------------------
def test_full_call_simulation_emits_mixed_tiers() -> None:
    turns = [
        ("Hello.", 1, "contractor-utility-electric-gas"),
        ("Hi, calling about a service disconnect.", 2, "contractor-utility-electric-gas"),
        ("What's the disconnect fee?", 3, "contractor-utility-electric-gas"),
        ("I'd like to dispute that.", 4, "contractor-utility-electric-gas"),
        ("Thanks, that's all I needed.", 5, "contractor-utility-electric-gas"),
    ]
    tiers = []
    prior = None
    for transcript, depth, role in turns:
        d = route_turn(transcript=transcript, history_depth=depth, role_hint=role, prior_tier=prior)
        tiers.append(d.tier)
        prior = d.tier
    # At least 2 different tiers should appear across a 5-turn realistic call.
    assert len(set(tiers)) >= 2, f"Expected mixed tiers, got: {tiers}"
