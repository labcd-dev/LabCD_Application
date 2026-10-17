"""Stage 2 — structural analysis.

[MOCK] Returns a fixed result. The real node must linearize the plant and run
rank / PBH tests. See stages/ASSIGNMENT_stage2_structural_analysis.md.
"""

from __future__ import annotations

from typing import Any

TRACE_LABEL = "Structural analysis (mock)"
TRACE_NOTE = "Checked controllability/observability — looks fine. Moving to trim conditions."


def run_structural_analysis(metadata: dict[str, Any]) -> dict[str, Any]:
    n_states = len(metadata.get("states") or [])
    n_inputs = len(metadata.get("inputs") or [])
    return {
        "controllability": "controllable",
        "observability": "observable",
        "stabilizability": "stabilizable",
        "actuation": "fullyactuated",
        "linearization_point": {"x0": [0.0] * n_states, "u0": [0.0] * n_inputs},
        "notes": "[MOCK] placeholder — real node should return A, B, C, D and rank-based tests, not hardcoded strings.",
    }
