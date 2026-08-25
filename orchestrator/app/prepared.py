"""Prepared-artifact specialists.

Some relocation work cannot be transacted for the customer — nobody should
sign their lease notice, book their flight, or open their bank account on
their behalf, and several of these needs have no API at all. What a
concierge can do is arrive with the specific, personalized thing they need
next: the notice ready to send, the route checked at the right hour, the
port-out steps in the right order.

These specialists produce exactly that. Each returns a titled section built
deterministically from the move spec; the orchestrator batches every section
into ONE "arrival pack" email rather than sending a dozen. Nothing here is
inferred: unknown values render as explicit <placeholders>, and the honest
terminal outcome is ``prepared_for_user`` — never "submitted", because no
counterparty received anything.
"""
from __future__ import annotations

import string
from typing import Any


class _Placeholders(dict):
    """Missing spec values render as an explicit <placeholder>, never blank."""

    def __missing__(self, key: str) -> str:
        return f"<{key.replace('_', ' ')}>"


def render(template: str, spec: dict[str, Any]) -> str:
    """Format a section template against the move spec.

    Unknown keys become <angle bracket placeholders> so a gap is visible to
    the customer instead of silently disappearing.
    """
    values = _Placeholders(
        {k: v for k, v in spec.items() if isinstance(v, (str, int, float)) and v != ""}
    )
    return string.Formatter().vformat(template, (), values)


# agent_id -> (section title, body template). Populated by the roster below.
SECTIONS: dict[str, tuple[str, str]] = {}


def register(agent_id: str, title: str, body: str) -> None:
    SECTIONS[agent_id] = (title, body)


def build_section(agent_id: str, spec: dict[str, Any]) -> dict[str, str] | None:
    """Return {"title", "body"} for a prepared specialist, or None if unknown."""
    entry = SECTIONS.get(agent_id)
    if entry is None:
        return None
    title, template = entry
    return {"title": title, "body": render(template, spec)}


# Load the generated section content. Imported last so ``register`` exists by
# the time it runs; without this the registry would be silently empty.
from . import prepared_sections  # noqa: E402,F401
