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


def test_dictated_email_becomes_an_address() -> None:
    """Nobody says "@" out loud. A dictated address must still land, or a
    caller who gave their email plainly is asked for it again."""
    from app.transcript_extract import extract_email

    assert extract_email("My email is moorthy at example dot com.") == "moorthy@example.com"
    assert extract_email("jane dot smith at gmail dot com") == "jane.smith@gmail.com"
    assert extract_email("sam at company dot co dot uk") == "sam@company.co.uk"
    # The recognizer sometimes writes the domain correctly but not the "@".
    assert extract_email("reach me at moorthy at gmail.com") == "moorthy@gmail.com"
    # A written address always wins over anything dictated later in the turn.
    assert extract_email("a@b.com, or say it: jane at gmail dot com") == "a@b.com"


def test_ordinary_prepositions_never_become_emails() -> None:
    """"at" is one of the commonest words in English. A dotted domain is what
    separates a dictated address from a person saying where they are."""
    from app.transcript_extract import extract_email

    for benign in (
        "meet me at the store",
        "I'm at 950 Howard Street, San Francisco",
        "We arrive at noon on the 3rd",
        "moving to Austin at some point",
        "I work at Google",
        "the movers get there at 9",
    ):
        assert extract_email(benign) is None, benign


def test_a_named_domain_in_prose_is_not_the_callers_email() -> None:
    """A dotted domain is not consent to invent a CORE field.

    "I work at Salesforce dot com" was becoming work@salesforce.com — and
    once user_email is filled the concierge stops asking for it, so the caller
    never gets the chance to correct an address they never gave.
    """
    from app.transcript_extract import extract_email

    for prose in (
        "I work at Salesforce dot com and I am relocating next spring",
        "I used to live at Amazon dot com headquarters",
        "Look at bing dot com for details",
        "I saw your ad at moving dot com so I am calling",
    ):
        assert extract_email(prose) is None, prose

    # An employer's domain in the same breath must not shadow the real answer.
    assert extract_email(
        "I work at Salesforce dot com, and my email is jane at example dot com"
    ) == "jane@example.com"


def test_addresses_do_not_swallow_the_words_beside_them() -> None:
    """The extracted string is emailed verbatim to real movers and utilities.

    Three ways it used to run on: a date before the address became the house
    number, a ZIP-less city at a sentence end chained onto the next
    capitalised word, and a preceding ZIP became the next street number.
    """
    from app.transcript_extract import extract_addresses

    assert [a for _s, a in extract_addresses(
        "Hi, we're moving June 1, 2026 from 950 Howard Street, San Francisco "
        "to 4700 Duval Street, Austin."
    )] == ["950 Howard Street, San Francisco", "4700 Duval Street, Austin"]

    assert [a for _s, a in extract_addresses(
        "Relocating from 950 Howard Street, San Francisco to 4700 Duval "
        "Street, Austin. June 1st, 2026."
    )] == ["950 Howard Street, San Francisco", "4700 Duval Street, Austin"]

    assert [a for _s, a in extract_addresses(
        "moving from 1 Ferry Building, San Francisco, CA 94111 to "
        "98 San Jacinto Blvd, Austin, TX 78701"
    )] == ["98 San Jacinto Blvd, Austin, TX 78701"]

    # Abbreviated city names still hold together, and prose still yields none.
    assert [a for _s, a in extract_addresses(
        "from 5 Elm Street, St. Louis, MO 63101 to 9 Oak Avenue, Ft. Worth, TX"
    )] == ["5 Elm Street, St. Louis, MO 63101", "9 Oak Avenue, Ft. Worth, TX"]
    assert extract_addresses("123 Main Street, please help me move") == []


def test_spoken_brief_with_dictated_email_is_dispatchable() -> None:
    """The whole point: a caller who says everything out loud, including the
    email, dispatches without a follow-up question."""
    ctx = BuyerCallContext(call_id="c5", event_id="e5")
    _merge_backstop_fields(
        "I am moving from 950 Howard Street, San Francisco to 4700 Duval "
        "Street, Austin, TX 78751 on August 20th, 2027. My email is moorthy "
        "at example dot com. One dog, no kids, and a car. No visa, I am a citizen.",
        ctx,
    )
    assert ctx.collected["user_email"] == "moorthy@example.com"
    assert blocking_fields(ctx.collected) == []
    assert next_question(ctx.collected) is None


def test_the_closing_is_never_spoken_twice() -> None:
    """The prompt teaches the model this closing, so on a one-breath brief it
    often says it unprompted. Appending ours made the caller sit through the
    whole thing twice — verified live before this guard existed."""
    from app.main import _steer_reply

    ctx = BuyerCallContext(call_id="c6", event_id="e6")
    _merge_backstop_fields(ONE_BREATH, ctx)
    assert next_question(ctx.collected) is None

    already = "Got it. You'll get an email with a live tracking link in a minute. Hang up whenever."
    assert _steer_reply(already, ctx) == already

    # A model that did NOT close still gets ours appended, exactly once.
    steered = _steer_reply("Cool. SF to Austin, August 20th.", ctx)
    assert steered.lower().count("tracking link") == 1


def test_a_complete_first_breath_needs_no_model_call() -> None:
    """The turn the caller is actually waiting on. Every field is recoverable
    from their own words, so asking a 2B model with a 15KB prompt to produce a
    line we already know is ~13 seconds of pure silence."""
    from app.main import _deterministic_turn

    ctx = BuyerCallContext(call_id="c7", event_id="e7")
    ctx.turn_count = 1
    reply = _deterministic_turn(ONE_BREATH, ctx)
    assert reply is not None
    assert reply.cost_cents == 0.0
    assert reply.tier == "deterministic"
    # It still echoes the route back — hearing it repeated is what tells the
    # caller they were understood.
    assert "San Francisco" in reply.content and "Austin" in reply.content


def test_an_incomplete_breath_still_reaches_the_model() -> None:
    """Anything the backstop cannot finish alone must still be modelled —
    the fast path is an optimisation, never a downgrade."""
    from app.main import _deterministic_turn

    ctx = BuyerCallContext(call_id="c8", event_id="e8")
    ctx.turn_count = 1
    assert _deterministic_turn("Hi, I'm moving next month sometime.", ctx) is None


def test_a_later_turn_always_reaches_the_model() -> None:
    """The backstop fills gaps and never overrides, so a correction like
    "no, make it the 22nd" is only understood by the model. Skipping it on a
    later turn would silently drop the correction."""
    from app.main import _deterministic_turn

    ctx = BuyerCallContext(call_id="c9", event_id="e9")
    ctx.turn_count = 2
    assert _deterministic_turn(ONE_BREATH, ctx) is None

    # Same on turn one if anything was already collected out of band.
    ctx2 = BuyerCallContext(call_id="c10", event_id="e10")
    ctx2.turn_count = 1
    ctx2.collected["move_date"] = "2027-08-20"
    assert _deterministic_turn(ONE_BREATH, ctx2) is None
