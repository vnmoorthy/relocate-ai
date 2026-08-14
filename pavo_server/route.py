"""Transparent heuristic router used by the open-source PAVO service.

No learned weights or benchmark dataset are included in this repository.  This
module is a deterministic policy that can be tested and audited locally.

route_turn(transcript, history_depth, role_hint, prior_tier) -> RoutingDecision

Policy:
  1. Hysteresis: if prior_tier was claude-opus, stay opus for 1 more turn unless
     turn looks trivial (length < 20 chars).
  2. Hard escalation keywords: legal / dispute / policy / code / NFPA → claude-opus.
  3. Pricing / quote / specifics → gemini-flash.
  4. Buyer-extract role → gemini-flash floor (we need structured JSON output).
  5. Early-call greeting turns (history_depth < 2) → clamp to gemma-local.
  6. Default → gemma-local.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Tier = Literal["gemma-local", "gemini-flash", "claude-opus"]


HARD_PATTERNS = re.compile(
    r"\b(dispute|insurance fraud|legal|policy section|hipaa|escalate|supervisor|attorney|"
    r"warrant|lien|nfpa|cpc|ipc|tcpa|compliance officer|class action)\b",
    re.IGNORECASE,
)
MED_PATTERNS = re.compile(
    r"\b(quote|estimate|warranty|guarantee|fee|deposit|cancel|cancellation|refund|"
    r"retention|disconnect|connect|appointment|reschedule|effective date|policy reference|"
    r"records release|consent form|confirmation number)\b",
    re.IGNORECASE,
)


@dataclass
class RoutingDecision:
    tier: Tier
    reason: str
    complexity: float


def route_turn(
    *,
    transcript: str,
    history_depth: int,
    role_hint: str,
    prior_tier: str | None = None,
) -> RoutingDecision:
    t = (transcript or "").strip()

    # 1. Hysteresis — sticky opus.
    if prior_tier == "claude-opus" and len(t) >= 20:
        return RoutingDecision(tier="claude-opus", reason="hysteresis: prior opus, non-trivial turn", complexity=0.85)

    # 2. Hard escalation keywords.
    if HARD_PATTERNS.search(t):
        return RoutingDecision(tier="claude-opus", reason="hard pattern hit (legal/policy/compliance)", complexity=0.9)

    # 4. Buyer-extract floor.
    if role_hint == "buyer-extract":
        return RoutingDecision(tier="gemini-flash", reason="buyer-extract requires JSON output → gemini-flash floor", complexity=0.55)

    # 3. Medium patterns.
    if MED_PATTERNS.search(t):
        return RoutingDecision(tier="gemini-flash", reason="medium pattern (pricing/specifics/confirmation)", complexity=0.5)

    # 5. Early-call greeting clamp.
    if history_depth < 2:
        return RoutingDecision(tier="gemma-local", reason="early-call greeting; clamp to gemma-local", complexity=0.15)

    # 6. Default.
    complexity = min(0.35, len(t) / 800.0)
    return RoutingDecision(tier="gemma-local", reason="default: small-talk / simple ack", complexity=complexity)
