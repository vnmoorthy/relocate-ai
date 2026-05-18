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

    async def subscribe(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
        log.info("ws subscribe: %d clients", len(self._clients))

    async def unsubscribe(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)
        log.info("ws unsubscribe: %d clients", len(self._clients))

    async def broadcast(self, event: dict[str, Any]) -> None:
        """Send the event JSON to every connected client. Drop disconnected clients."""
        if not self._clients:
            return
        payload = json.dumps(event)
        dead: list[WebSocket] = []
        async with self._lock:
            for ws in self._clients:
                try:
                    await ws.send_text(payload)
                except Exception as e:
                    log.warning("ws send failed: %s", e)
                    dead.append(ws)
            for ws in dead:
                self._clients.discard(ws)


ws_broker = WSBroker()
