"""Stage 7 — routing to downstream modules.

Adaptive comes from ``stage7_adaptive_check``. The other modules are still [MOCK],
and ``stage7_routing.yaml`` is the prompt their real judgment will use.
Output shape stays extensible: add a key to ``applicable`` for a new module, with
no schema change. ``null`` means "not evaluated yet", and ``False`` hides the module.
See stages/ASSIGNMENT_stage7_routing.md.
"""

from __future__ import annotations

from typing import Any

from backend_core.AgentPlant.stages.stage7_adaptive_check import check_adaptive

TRACE_LABEL = "Routing"
MOCK_RATIONALE = (
    "[MOCK] mpc, silo and mulo are placeholders (mulo is off) — a real agent should check linearity, "
    "actuation, state count and constraint type against each module's documented preconditions. "
    "null = module not yet implemented."
)


def route_plant(metadata: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    adaptive = check_adaptive(metadata, (data or {}).get("trim"))
    applicable: dict[str, bool | None] = {
        "mpc": True,
        "adaptive": adaptive["launchable"],
        "silo": True,
        "mulo": False,
        "pid_tuner": None,
        "lqr": None,
    }
    return {
        "mpc_applicable": applicable["mpc"] is True,
        "adaptive_applicable": applicable["adaptive"] is True,
        "applicable": applicable,
        "adaptive_check": adaptive,
        "rationale": f"Adaptive: {adaptive['reason']} {MOCK_RATIONALE}",
    }
