"""Reply ingestion: outbound ref-tagging, inbound correlation, redaction.

The poller never touches the network here — the SDK listing boundary is
monkeypatched. The invariants under test:
- our own tagged outbound mail is never ingested as a reply to itself
- a correlated reply attaches once (durable dedupe) and broadcasts
- the public snapshot exposes sender domain + timestamp only
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import cast
from unittest.mock import AsyncMock

import pytest

from app.integrations import replies
from app.state import MarketplaceEvent, state
from app.ws import ws_broker


@pytest.fixture(autouse=True)
def _isolated(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    state.events.clear()
    replies._seen_ids.clear()
    replies._high_water = 0.0
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())
    yield
    state.events.clear()
    replies._seen_ids.clear()
    replies._high_water = 0.0


def _listing(monkeypatch: pytest.MonkeyPatch, messages: list[dict]) -> None:
    monkeypatch.setattr(replies, "_list_inbox_sync", lambda _after: messages)
    # Full-body fetch degrades to the listing preview in tests.
    monkeypatch.setattr(replies, "_get_message_text_sync", lambda _mid: "")


def test_extract_ref() -> None:
    assert replies.extract_ref("Re: Quote request [ref:mkt_ab12cd34ef]") == ("mkt_ab12cd34ef", None)
    assert replies.extract_ref("Re: [ref:mkt_ab12cd34ef:mover_quote]") == (
        "mkt_ab12cd34ef", "mover_quote",
    )
    assert replies.extract_ref("[demo → x] Quote [ref:mkt_ab12cd34ef] more") == (
        "mkt_ab12cd34ef", None,
    )
    assert replies.extract_ref("no tag here") is None
    assert replies.extract_ref(None) is None
    assert replies.extract_ref("[ref:evil_injection]") is None


def test_parse_quote_extraction() -> None:
    q = replies.parse_quote(
        "Out-the-door: $3,150 including fuel, $300 deposit, truck confirmed."
    )
    assert q == {"total_display": "$3,150", "deposit_display": "$300", "availability": True}
    # Unlabeled amounts: the largest wins.
    q2 = replies.parse_quote("We charge $95/hr, most jobs run $2,400 all told.")
    assert q2 is not None and q2["total_display"] == "$2,400"
    assert replies.parse_quote("Thanks, we'll get back to you.") is None
    assert replies.parse_quote("") is None


def test_correlated_reply_attaches_and_broadcasts(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_ab12cd34ef", homeowner_call_id="call", spec={})
    state.events[event.id] = event
    _listing(monkeypatch, [{
        "message_id": "msg_reply_1",
        "from": "quotes@uhaul.com",
        "subject": "Re: Quote request [ref:mkt_ab12cd34ef:mover_quote]",
        "preview": "Your OTD price is $2,850 including fuel.",
        "timestamp": 1_700_000_000.0,
    }])

    attached = asyncio.run(replies.ingest_once())

    assert attached == 1
    assert len(event.replies) == 1
    reply = event.replies[0]
    assert reply["from_domain"] == "uhaul.com"
    assert "2,850" in reply["preview"]
    assert reply["agent_id"] == "mover_quote"
    assert reply["quote"] == {
        "total_display": "$2,850", "deposit_display": None, "availability": False,
    }
    broadcast = cast(AsyncMock, ws_broker.broadcast)
    assert broadcast.await_count == 1
    assert broadcast.await_args is not None
    payload = broadcast.await_args.args[0]
    assert payload["type"] == "reply_received"
    assert payload["event_id"] == event.id
    assert payload["from_domain"] == "uhaul.com"


def test_display_name_sender_yields_clean_domain(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_ab12cd34ef", homeowner_call_id="call", spec={})
    state.events[event.id] = event
    _listing(monkeypatch, [{
        "message_id": "msg_display",
        "from": "U-Haul Dispatch <Quotes@UHAUL.com>",
        "subject": "Re: [ref:mkt_ab12cd34ef]",
        "preview": "quote",
        "timestamp": 1_700_000_000.0,
    }])
    assert asyncio.run(replies.ingest_once()) == 1
    assert event.replies[0]["from"] == "quotes@uhaul.com"
    assert event.replies[0]["from_domain"] == "uhaul.com"


def test_dedupe_across_polls(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_ab12cd34ef", homeowner_call_id="call", spec={})
    state.events[event.id] = event
    msg = {
        "message_id": "msg_reply_1",
        "from": "quotes@uhaul.com",
        "subject": "Re: [ref:mkt_ab12cd34ef]",
        "preview": "quote",
        "timestamp": 1_700_000_000.0,
    }
    _listing(monkeypatch, [msg])
    assert asyncio.run(replies.ingest_once()) == 1
    assert asyncio.run(replies.ingest_once()) == 0
    assert len(event.replies) == 1


def test_own_outbound_is_never_ingested(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_ab12cd34ef", homeowner_call_id="call", spec={})
    state.events[event.id] = event
    # The send path ledgers its message id before the poller ever sees it.
    replies.note_outbound("msg_we_sent", event.id)
    _listing(monkeypatch, [{
        "message_id": "msg_we_sent",
        "from": "vnarasingamoorthy@agentmail.to",
        "subject": "Quote request [ref:mkt_ab12cd34ef]",
        "preview": "outbound body",
        "timestamp": 1_700_000_000.0,
    }])
    assert asyncio.run(replies.ingest_once()) == 0
    assert event.replies == []


def test_uncorrelated_mail_is_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    _listing(monkeypatch, [{
        "message_id": "msg_spam",
        "from": "news@example.com",
        "subject": "Weekly newsletter",
        "preview": "hello",
        "timestamp": 1_700_000_000.0,
    }])
    assert asyncio.run(replies.ingest_once()) == 0


def test_poll_survives_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_after: float) -> list[dict]:
        raise RuntimeError("provider down")

    monkeypatch.setattr(replies, "_list_inbox_sync", boom)
    with pytest.raises(RuntimeError):
        asyncio.run(replies.ingest_once())
    # The loop itself catches this — assert the summarizer/dedupe state is intact.
    assert replies._seen_ids == set()


def test_correlated_reply_forwards_to_user(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.integrations import agentmail

    event = MarketplaceEvent(
        id="mkt_ab12cd34ef", homeowner_call_id="call",
        spec={"user_email": "mover@test.invalid"},
    )
    state.events[event.id] = event
    forwarded: list[dict] = []

    async def fake_send(**kwargs):  # noqa: ANN003
        forwarded.append(kwargs)
        return {"count": 1, "messages": [{"message_id": "msg_fwd"}]}

    monkeypatch.setattr(agentmail, "_send_via_agentmail", fake_send)
    _listing(monkeypatch, [{
        "message_id": "msg_reply_fw",
        "from": "quotes@uhaul.com",
        "subject": "Re: Quote [ref:mkt_ab12cd34ef:mover_quote]",
        "preview": "OTD $3,150",
        "timestamp": 1_700_000_000.0,
    }])

    assert asyncio.run(replies.ingest_once()) == 1
    assert len(forwarded) == 1
    assert forwarded[0]["to"] == "mover@test.invalid"
    assert "uhaul.com" in forwarded[0]["subject"]
    assert "[ref:mkt_ab12cd34ef:mover_quote]" in forwarded[0]["subject"]


def test_users_own_reply_is_never_echoed_back(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.integrations import agentmail

    event = MarketplaceEvent(
        id="mkt_ab12cd34ef", homeowner_call_id="call",
        spec={"user_email": "mover@test.invalid"},
    )
    state.events[event.id] = event
    forwarded: list[dict] = []

    async def fake_send(**kwargs):  # noqa: ANN003
        forwarded.append(kwargs)
        return {"count": 1, "messages": [{"message_id": "x"}]}

    monkeypatch.setattr(agentmail, "_send_via_agentmail", fake_send)
    _listing(monkeypatch, [{
        "message_id": "msg_own",
        "from": "Mover <MOVER@test.invalid>",
        "subject": "Re: [ref:mkt_ab12cd34ef]",
        "preview": "ok thanks",
        "timestamp": 1_700_000_000.0,
    }])

    assert asyncio.run(replies.ingest_once()) == 1  # attached to the timeline
    assert forwarded == []  # but never bounced back at its author


def test_reply_increments_soliciting_specialist(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.state import SpecialistCallContext

    event = MarketplaceEvent(id="mkt_ab12cd34ef", homeowner_call_id="call", spec={})
    ctx = SpecialistCallContext(
        call_id="c", agent_id="mover_quote", event_id=event.id,
        state="submitted",
    )
    ctx.bid = {"count": 3}
    event.specialist_calls["mover_quote"] = ctx
    state.events[event.id] = event
    _listing(monkeypatch, [{
        "message_id": "msg_link",
        "from": "quotes@uhaul.com",
        "subject": "Re: [ref:mkt_ab12cd34ef:mover_quote]",
        "preview": "OTD $3,150",
        "timestamp": 1_700_000_000.0,
    }])

    asyncio.run(replies.ingest_once())

    assert ctx.bid["replies_received"] == 1
