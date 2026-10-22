"""Stage 7 — routing to downstream modules.

[MOCK] Always returns the placeholder routing. ``stage7_routing.yaml`` holds the
prompt the real judgment will use. The mock never loads it.
Output shape stays extensible: add a key to ``applicable`` for a new module, with
no schema change. ``null`` means "not evaluated yet", and ``False`` hides the module.
See stages/ASSIGNMENT_stage7_routing.md.
"""

from __future__ import annotations

from typing import Any

TRACE_LABEL = "Routing (mock)"
MOCK_RATIONALE = (
    "[MOCK] always true/true for now — real agent should check linearity, actuation, state count "
    "and constraint type against each module's documented preconditions before flagging it "
    "applicable. null = module not yet implemented."
)


def route_plant(metadata: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    applicable: dict[str, bool | None] = {
        "mpc": True,
        "adaptive": True,
        "silo": True,
        "mulo": False,
        "pid_tuner": None,
        "lqr": None,
    }
    return {
        "mpc_applicable": applicable["mpc"] is True,
        "adaptive_applicable": applicable["adaptive"] is True,
        "applicable": applicable,
        "rationale": MOCK_RATIONALE,
    }
