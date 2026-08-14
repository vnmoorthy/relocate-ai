"""WebSocket broker: orchestrator → dashboard.

Single channel, server → client, no ack, no replay (per locked protocol in /plan-eng-review).
Multiple dashboard tabs may connect; broadcast fans out to all subscribers.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket


log = logging.getLogger(__name__)


class WSBroker:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

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
