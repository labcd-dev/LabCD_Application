"""Stage 3 — trim (initial conditions and feedforward input).

[MOCK] Proposes zeros for x0 and u_ff. HITL gate: the user accepts or edits.
See stages/ASSIGNMENT_stage3_trim.md.
"""

from __future__ import annotations

from typing import Any

from backend_core.AgentPlant.stages.common import check_vector

TRACE_LABEL = "Trim proposal (mock)"
MOCK_SOURCE = "[MOCK] zeros — real agent should solve f(x0,u0)=0 for a user-specified operating point"
USER_SOURCE = "user"


def propose_trim(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "x0": [0.0] * len(metadata.get("states") or []),
        "u_ff": [0.0] * len(metadata.get("inputs") or []),
        "source": MOCK_SOURCE,
    }


def apply_trim_edit(proposal: dict[str, Any], edit: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    """Return a new trim with the user's values applied. Raises ``ValueError`` on bad input."""
    out = dict(proposal)
    if "x0" in edit:
        out["x0"] = check_vector(edit["x0"], len(metadata.get("states") or []), "x0")
    if "u_ff" in edit:
        out["u_ff"] = check_vector(edit["u_ff"], len(metadata.get("inputs") or []), "u_ff")
    if edit:
        out["source"] = USER_SOURCE
    return out
