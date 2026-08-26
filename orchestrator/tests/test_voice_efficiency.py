"""The concierge must not interrogate a caller for what they already said.

A 2B model writes its reply before the deterministic backstop merges the
turn's fields, so unsteered it asks for the email the caller just gave. These
tests pin the two properties that make the call short: a complete brief in
one breath dispatches without a single follow-up question, and every question
that IS asked names only fields still missing.
"""
from __future__ import annotations

from app.buyer_schema import blocking_fields, next_question
from app.main import _merge_backstop_fields, _steer_reply
from app.state import BuyerCallContext

ONE_BREATH = (
    "I'm moving from 950 Howard Street, San Francisco to 4700 Duval Street, "
    "Austin, TX 78751 on August 20th, 2027. My email is jane@example.com. "
    "One dog, no kids, and a car. No visa, I'm a citizen."
)


def test_complete_brief_in_one_breath_needs_no_follow_up_question() -> None:
    ctx = BuyerCallContext(call_id="c1", event_id="e1")
    _merge_backstop_fields(ONE_BREATH, ctx)

    assert ctx.collected["origin_address"].startswith("950 Howard")
    assert ctx.collected["destination_address"].startswith("4700 Duval")
    assert ctx.collected["move_date"] == "2027-08-20"
    assert ctx.collected["user_email"] == "jane@example.com"
    assert ctx.collected["has_pets"] is True
    assert ctx.collected["has_children"] is False
    assert ctx.collected["has_car"] is True
    assert ctx.collected["has_visa"] is False
    assert blocking_fields(ctx.collected) == []
    assert next_question(ctx.collected) is None

    # The model still asked for the email it did not know we had; steering
    # replaces that question with the closing line rather than re-asking.
    steered = _steer_reply("Got it. What's the best email?", ctx)
    assert "?" not in steered
    assert "email with a live tracking link" in steered


def test_question_names_only_the_fields_still_missing() -> None:
    ctx = BuyerCallContext(call_id="c2", event_id="e2")
    _merge_backstop_fields(
        "Moving from 950 Howard Street, San Francisco to 4700 Duval Street, "
        "Austin, TX 78751 on August 20th, 2027. One dog, no kids, and a car.",
        ctx,
    )
    question = next_question(ctx.collected)
    assert question is not None
    # Email and visa are outstanding; pets/kids/car were answered and must
    # not be recited back at the caller.
    assert "email" in question
    assert "visa" in question
    assert "pets" not in question
    assert "kids" not in question
    assert "a car" not in question


def test_two_turns_collect_the_whole_brief() -> None:
    ctx = BuyerCallContext(call_id="c3", event_id="e3")
    assert "moving from" in (next_question(ctx.collected) or "")
    _merge_backstop_fields(
        "950 Howard Street, San Francisco to 4700 Duval Street, Austin, "
        "TX 78751, moving August 20th 2027.", ctx,
    )
    second = next_question(ctx.collected)
    assert second is not None and "email" in second
    _merge_backstop_fields(
        "jane@example.com, one dog, no kids, a car, and no visa.", ctx,
    )
    assert next_question(ctx.collected) is None


def test_steering_leaves_post_dispatch_conversation_alone() -> None:
    """Once dispatched the call is ordinary conversation; questions the
    concierge asks then are its own, not intake, and must survive."""
    ctx = BuyerCallContext(call_id="c4", event_id="e4")
    _merge_backstop_fields(ONE_BREATH, ctx)
    ctx.dispatched = True
    reply = "PG&E is scheduled. Want me to add the vet records too?"
    assert _steer_reply(reply, ctx) == reply
