"""WebSocket broker: orchestrator → dashboard.

Single channel, server → client, no ack, no replay (per locked protocol in /plan-eng-review).
Multiple dashboard tabs may connect; broadcast fans out to all subscribers.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from fastapi import WebSocket


log = logging.getLogger(__name__)


class WSBroker:
    def __init__(self, *, max_clients: int | None = None) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self.max_clients = max_clients
        # Optional (broker, projector) mirror: every broadcast is re-published
        # to `broker` after passing through `projector` (None drops the event).
        self.mirror: tuple["WSBroker", Callable[[dict[str, Any]], dict[str, Any] | None]] | None = None

    @property
    def at_capacity(self) -> bool:
        return self.max_clients is not None and len(self._clients) >= self.max_clients

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def subscribe(self, ws: WebSocket, subprotocol: str | None = None) -> None:
        await ws.accept(subprotocol=subprotocol)
        async with self._lock:
            self._clients.add(ws)
        log.info("ws subscribe: %d clients", len(self._clients))

    async def unsubscribe(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)
        log.info("ws unsubscribe: %d clients", len(self._clients))

    async def broadcast(self, event: dict[str, Any]) -> None:
        """Send the event JSON to every connected client. Drop disconnected clients.

        Sends run concurrently and outside the lock so one slow or stuck client
        cannot stall the other clients or block subscribe/unsubscribe.
        """
        if self.mirror is not None:
            mirror_broker, projector = self.mirror
            projected = projector(event)
            if projected is not None:
                await mirror_broker.broadcast(projected)
        async with self._lock:
            clients = list(self._clients)
        if not clients:
            return
        payload = json.dumps(event)

        async def _send(ws: WebSocket) -> WebSocket | None:
            try:
                await ws.send_text(payload)
                return None
            except Exception as e:
                log.warning("ws send failed: %s", e)
                return ws

        results = await asyncio.gather(*[_send(ws) for ws in clients])
        dead = [ws for ws in results if ws is not None]
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)


ws_broker = WSBroker()
# Unauthenticated, redacted projection for the public website (see public_feed.py).
public_broker = WSBroker(max_clients=300)
