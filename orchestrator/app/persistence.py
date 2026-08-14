"""Durable single-node state: SQLite with WAL.

Design notes:
- One process-wide connection guarded by a lock; every write is a tiny
  single-row upsert, so synchronous calls from async handlers stay sub-ms.
- Rows store JSON blobs; (de)serialization of the domain dataclasses lives in
  ``state.py`` so this module stays dependency-free.
- ``DATABASE_PATH`` empty/unset in tests disables persistence entirely: every
  call becomes a no-op and the mocked suite keeps running purely in memory.
- Single node only. Multiple orchestrator replicas would race this file; the
  multi-replica story (Postgres + queue) remains on the roadmap in STATUS.md.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS buyer_contexts (
    call_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    agent_id TEXT NOT NULL,
    webhook_id TEXT NOT NULL,
    status TEXT NOT NULL,
    seen_at REAL NOT NULL,
    PRIMARY KEY (agent_id, webhook_id)
);
"""


class Persistence:
    """Tiny JSON-row store. All methods are no-ops until ``open()`` succeeds."""

    def __init__(self) -> None:
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self._conn is not None

    def open(self, path: str) -> None:
        if not path:
            log.info("persistence disabled (DATABASE_PATH is empty)")
            return
        db_path = Path(path)
        if db_path.parent and str(db_path.parent) not in ("", "."):
            db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.executescript(_SCHEMA)
        conn.commit()
        self._conn = conn
        log.info("persistence open: %s", db_path)

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    # ── generic JSON rows ────────────────────────────────────────────────
    def _upsert(self, table: str, key_col: str, key: str, data: dict[str, Any]) -> None:
        if self._conn is None:
            return
        payload = json.dumps(data, separators=(",", ":"))
        with self._lock:
            self._conn.execute(
                f"INSERT INTO {table} ({key_col}, data, updated_at) VALUES (?, ?, ?) "
                f"ON CONFLICT({key_col}) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (key, payload, time.time()),
            )
            self._conn.commit()

    def _load_all(self, table: str, key_col: str) -> dict[str, dict[str, Any]]:
        if self._conn is None:
            return {}
        with self._lock:
            rows = self._conn.execute(f"SELECT {key_col}, data FROM {table}").fetchall()
        out: dict[str, dict[str, Any]] = {}
        for key, payload in rows:
            try:
                out[key] = json.loads(payload)
            except json.JSONDecodeError:
                log.warning("skipping corrupt %s row: %s", table, key)
        return out

    def save_event(self, event_id: str, data: dict[str, Any]) -> None:
        self._upsert("events", "id", event_id, data)

    def load_events(self) -> dict[str, dict[str, Any]]:
        return self._load_all("events", "id")

    def save_buyer_context(self, call_id: str, data: dict[str, Any]) -> None:
        self._upsert("buyer_contexts", "call_id", call_id, data)

    def load_buyer_contexts(self) -> dict[str, dict[str, Any]]:
        return self._load_all("buyer_contexts", "call_id")

    # ── webhook replay/idempotency records ───────────────────────────────
    def save_webhook_delivery(
        self, agent_id: str, webhook_id: str, status: str, seen_at: float,
    ) -> None:
        if self._conn is None:
            return
        with self._lock:
            self._conn.execute(
                "INSERT INTO webhook_deliveries (agent_id, webhook_id, status, seen_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(agent_id, webhook_id) "
                "DO UPDATE SET status=excluded.status, seen_at=excluded.seen_at",
                (agent_id, webhook_id, status, seen_at),
            )
            self._conn.commit()

    def delete_webhook_delivery(self, agent_id: str, webhook_id: str) -> None:
        if self._conn is None:
            return
        with self._lock:
            self._conn.execute(
                "DELETE FROM webhook_deliveries WHERE agent_id=? AND webhook_id=?",
                (agent_id, webhook_id),
            )
            self._conn.commit()

    def load_webhook_deliveries(
        self, newer_than: float,
    ) -> list[tuple[str, str, str, float]]:
        if self._conn is None:
            return []
        with self._lock:
            return self._conn.execute(
                "SELECT agent_id, webhook_id, status, seen_at FROM webhook_deliveries "
                "WHERE seen_at > ? ORDER BY seen_at ASC",
                (newer_than,),
            ).fetchall()

    def prune_webhook_deliveries(self, older_than: float) -> None:
        if self._conn is None:
            return
        with self._lock:
            self._conn.execute(
                "DELETE FROM webhook_deliveries WHERE seen_at <= ?", (older_than,),
            )
            self._conn.commit()


persistence = Persistence()
