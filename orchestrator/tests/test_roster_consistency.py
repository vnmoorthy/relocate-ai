"""Roster consistency — every place that names an agent must agree.

Canonical source: app.personas.PERSONAS.
Derived rosters that must match:
  - orchestrator/agents.json → agents[].agent_id
  - web/src/lib/types.ts → ALL_AGENTS[].id
  - AGENT_COUNT.md → the table

This test is CHEAP (no network). It runs on every commit.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.personas import PERSONAS


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ORCH_ROOT = REPO_ROOT / "orchestrator"
WEB_ROOT = REPO_ROOT / "web"
AGENT_COUNT_MD = REPO_ROOT / "AGENT_COUNT.md"


def _personas_ids() -> set[str]:
    return {p.agent_id for p in PERSONAS}


def _agents_json_ids() -> set[str]:
    data = json.loads((ORCH_ROOT / "agents.json").read_text())
    return {e["agent_id"] for e in data.get("agents", [])}


def _types_ts_ids() -> set[str]:
    src = (WEB_ROOT / "src" / "lib" / "types.ts").read_text()
    # Extract the ALL_AGENTS block, then pull each `id: "..."` literal.
    m = re.search(r"export const ALL_AGENTS\s*=\s*\[(.+?)\]\s*as const", src, re.S)
    if not m:
        raise AssertionError("ALL_AGENTS block not found in web/src/lib/types.ts")
    block = m.group(1)
    return set(re.findall(r'id:\s*"([^"]+)"', block))


def _agent_count_md_ids() -> set[str]:
    if not AGENT_COUNT_MD.exists():
        raise AssertionError(
            "AGENT_COUNT.md not found at repo root — Phase 4 not run yet."
        )
    text = AGENT_COUNT_MD.read_text()
    # Expect a markdown table with one column literally `agent_id` containing
    # snake_case ids inside backticks: `pge_shutoff`.
    return set(re.findall(r"`([a-z_]+)`", text))


def test_personas_match_agents_json():
    p_ids = _personas_ids()
    j_ids = _agents_json_ids()
    diff = p_ids.symmetric_difference(j_ids)
    assert not diff, (
        f"personas.PERSONAS and agents.json disagree. "
        f"In personas but not in json: {p_ids - j_ids}. "
        f"In json but not in personas: {j_ids - p_ids}."
    )


def test_personas_match_types_ts():
    p_ids = _personas_ids()
    t_ids = _types_ts_ids()
    diff = p_ids.symmetric_difference(t_ids)
    assert not diff, (
        f"personas.PERSONAS and web/src/lib/types.ts ALL_AGENTS disagree. "
        f"In personas but not in ts: {p_ids - t_ids}. "
        f"In ts but not in personas: {t_ids - p_ids}."
    )


def test_personas_match_agent_count_md():
    p_ids = _personas_ids()
    md_ids = _agent_count_md_ids()
    missing = p_ids - md_ids
    assert not missing, (
        f"AGENT_COUNT.md is missing these shipping agents: {missing}. "
        "Update the markdown table."
    )


def test_no_removed_agents_linger():
    """Belt-and-braces: the v1 agents we explicitly removed must NOT reappear."""
    removed = {"wells_fargo", "subscriptions", "ca_dmv", "ca_voter"}
    assert not (removed & _personas_ids()), \
        f"Removed agents leaked back into PERSONAS: {removed & _personas_ids()}"
    assert not (removed & _agents_json_ids()), \
        f"Removed agents leaked back into agents.json: {removed & _agents_json_ids()}"
    assert not (removed & _types_ts_ids()), \
        f"Removed agents leaked back into ALL_AGENTS: {removed & _types_ts_ids()}"


def test_every_persona_has_a_handler():
    """Every persona must declare a mode marketplace knows how to dispatch."""
    valid = {"voice", "browser", "email", "mail"}
    for p in PERSONAS:
        assert p.voice_mode in valid, \
            f"persona {p.agent_id} has unsupported voice_mode={p.voice_mode}"


def test_shipping_count_is_twelve():
    """v2 ships 12 agents. If this needs to change, edit AGENT_COUNT.md too."""
    assert len(PERSONAS) == 12, \
        f"Expected 12 shipping agents, got {len(PERSONAS)}. " \
        "If intentional, update test_shipping_count_is_twelve + AGENT_COUNT.md."
