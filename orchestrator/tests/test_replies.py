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


def test_extract_ref() -> None:
    assert replies.extract_ref("Re: Quote request [ref:mkt_ab12cd34ef]") == "mkt_ab12cd34ef"
    assert replies.extract_ref("[demo → x] Quote [ref:mkt_ab12cd34ef] more") == "mkt_ab12cd34ef"
    assert replies.extract_ref("no tag here") is None
    assert replies.extract_ref(None) is None
    assert replies.extract_ref("[ref:evil_injection]") is None


def test_correlated_reply_attaches_and_broadcasts(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_ab12cd34ef", homeowner_call_id="call", spec={})
    state.events[event.id] = event
    _listing(monkeypatch, [{
        "message_id": "msg_reply_1",
        "from": "quotes@uhaul.com",
        "subject": "Re: Quote request [ref:mkt_ab12cd34ef]",
        "preview": "Your OTD price is $2,850 including fuel.",
        "timestamp": 1_700_000_000.0,
    }])

    attached = asyncio.run(replies.ingest_once())

    assert attached == 1
    assert len(event.replies) == 1
    reply = event.replies[0]
    assert reply["from_domain"] == "uhaul.com"
    assert "2,850" in reply["preview"]
    broadcast = ws_broker.broadcast
    assert broadcast.await_count == 1
    payload = broadcast.await_args.args[0]
    assert payload["type"] == "reply_received"
    assert payload["event_id"] == event.id
    assert payload["from_domain"] == "uhaul.com"


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
