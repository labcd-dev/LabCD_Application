"""Plant complexity grading utility.

Reuses the same grading logic as AgentAdaptive's system_complexity:
compute a 1–5 grade deterministically from state/input/output counts.
"""

from __future__ import annotations

from typing import Any, Optional

MIN_GRADE = 1
MAX_GRADE = 5

# states plus any inputs/outputs beyond 1-in/1-out (MIMO costs more), bucketed
# into grades 1-5 via _THRESHOLDS below
_THRESHOLDS = ((2, 1), (3, 2), (5, 3), (7, 4))


def complexity_raw(n_states: int, n_inputs: int, n_outputs: int) -> int:
    """Compute raw complexity score from state/input/output counts."""
    return (int(n_states) + max(0, int(n_inputs) - 1)
            + max(0, int(n_outputs) - 1))


def complexity_grade(n_states: int, n_inputs: int, n_outputs: int) -> int:
    """Grade plant complexity as 1–5 from state/input/output counts."""
    raw = complexity_raw(n_states, n_inputs, n_outputs)
    for limit, grade in _THRESHOLDS:
        if raw <= limit:
            return grade
    return MAX_GRADE


def complexity_grade_from_metadata(metadata: Optional[dict[str, Any]]) -> Optional[int]:
    """Extract complexity grade from plant metadata dict.

    Returns None if metadata is missing required fields, or the grade 1–5.
    """
    if not isinstance(metadata, dict):
        return None
    states = metadata.get("states")
    if not isinstance(states, list) or not states:
        return None
    inputs = metadata.get("inputs") or []
    outputs = metadata.get("outputs") or []
    return complexity_grade(len(states), len(inputs), len(outputs))


def add_complexity_to_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    """Attach or recompute the complexity field on a metadata dict.

    Returns the metadata dict (mutated) with complexity field set to 1–5.
    """
    if not isinstance(metadata, dict):
        return metadata
    grade = complexity_grade_from_metadata(metadata)
    if grade is not None:
        metadata["complexity"] = grade
    return metadata
