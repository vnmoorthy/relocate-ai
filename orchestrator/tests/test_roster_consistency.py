"""Roster consistency — every place that names an agent must agree.

Canonical source: app.personas.PERSONAS.
Derived rosters that must match:
  - orchestrator/agents.json → agents[].agent_id, when a local registry exists
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
    registry = ORCH_ROOT / "agents.json"
    if not registry.exists():
        pytest.skip("agents.json is a generated, gitignored deployment registry")
    data = json.loads(registry.read_text())
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
    # Restrict parsing to numbered rows in the canonical shipping table. Agent
    # ids may contain digits (for example ``uscis_ar11``), while the later
    # "removed agents" table must not be treated as part of the live roster.
    return set(
        re.findall(r"^\|\s*\d+\s*\|\s*`([a-z0-9_]+)`\s*\|", text, re.MULTILINE)
    )


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
    assert p_ids == md_ids, (
        "personas.PERSONAS and AGENT_COUNT.md disagree. "
        f"In personas but not docs: {p_ids - md_ids}. "
        f"In docs but not personas: {md_ids - p_ids}."
    )


def test_no_removed_agents_linger():
    """Belt-and-braces: the v1 agents we explicitly removed must NOT reappear."""
    removed = {"wells_fargo", "subscriptions", "ca_dmv", "ca_voter"}
    persona_ids = _personas_ids()
    type_ids = _types_ts_ids()
    assert not (removed & persona_ids), f"Removed agents leaked back into PERSONAS: {removed & persona_ids}"
    assert not (removed & type_ids), f"Removed agents leaked back into ALL_AGENTS: {removed & type_ids}"

    registry = ORCH_ROOT / "agents.json"
    if registry.exists():
        registry_ids = _agents_json_ids()
        assert not (removed & registry_ids), (
            f"Removed agents leaked back into agents.json: {removed & registry_ids}"
        )


def test_every_persona_has_a_handler():
    """Every persona must declare a mode marketplace knows how to dispatch."""
    valid = {"voice", "browser", "email", "mail"}
    for p in PERSONAS:
        assert p.voice_mode in valid, f"persona {p.agent_id} has unsupported voice_mode={p.voice_mode}"


def test_shipping_count_is_seventeen():
    """v2.1 ships 17 agents (1 buyer + 16 specialists). If this needs to change,
    edit AGENT_COUNT.md + this test + ALL_AGENTS in web/src/lib/types.ts."""
    assert len(PERSONAS) == 17, (
        f"Expected 17 shipping agents, got {len(PERSONAS)}. "
        "If intentional, update test_shipping_count_is_seventeen + AGENT_COUNT.md."
    )
