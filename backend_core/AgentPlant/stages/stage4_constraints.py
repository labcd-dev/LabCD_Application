"""Stage 4 — state and input constraints (HITL).

Scaffolding is real: a prompt YAML, a continue/complete turn contract, and an
accept/edit gate. The initial judgment is [MOCK]: it short-circuits to
unbounded. See stages/ASSIGNMENT_stage4_constraints.md.
"""

from __future__ import annotations

import math
from typing import Any, Optional

from backend_core.AgentPlant.stages.common import describe_plant, format_dialogue, load_prompt, render, run_json_turn

TRACE_LABEL = "Constraints (mock: unbounded)"
PROMPT_FILE = "stage4_constraints"
MOCK_NOTE = (
    "[MOCK] short-circuited to unbounded — real LLM agent should ask the user and "
    "set lower/upper arrays per state/input when bounded."
)
USER_NOTE = "user-specified bounds"


def propose_constraints() -> dict[str, Any]:
    return {"bounded": False, "state_bounds": None, "input_bounds": None, "notes": MOCK_NOTE}


def apply_constraints_edit(
    proposal: dict[str, Any],
    edit: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Return constraints with the given bounds applied. Raises ``ValueError`` on bad input."""
    state_bounds = _bounds_or_keep(edit, "state_bounds", proposal, len(metadata.get("states") or []), "state_bounds")
    input_bounds = _bounds_or_keep(edit, "input_bounds", proposal, len(metadata.get("inputs") or []), "input_bounds")
    bounded = _any_bound(state_bounds) or _any_bound(input_bounds)
    notes = USER_NOTE if edit else proposal.get("notes", "")
    return {
        "bounded": bounded,
        "state_bounds": state_bounds if bounded or state_bounds is not None else None,
        "input_bounds": input_bounds if bounded or input_bounds is not None else None,
        "notes": notes,
    }


def constraints_turn(
    llm: Any,
    metadata: dict[str, Any],
    dialogue: list[dict[str, str]],
    user_message: str,
) -> dict[str, Any]:
    """One conversational turn. Returns ``{"status", "reply", "edit"}``.

    ``edit`` carries ``state_bounds`` / ``input_bounds`` when the model says complete.
    """
    prompt = render(
        load_prompt(PROMPT_FILE, "user_prompt_template"),
        {
            "plant": describe_plant(metadata),
            "conversation_history": format_dialogue(dialogue),
            "user_message": user_message,
        },
    )
    raw = run_json_turn(llm, load_prompt(PROMPT_FILE, "system_prompt"), prompt)
    if raw is None:
        return {"status": "continue", "reply": "Sorry, I didn't catch that. Could you say the limits again?", "edit": None}
    reply = str(raw.get("reply") or "").strip()
    if raw.get("status") == "complete":
        return {
            "status": "complete",
            "reply": reply or "Recorded the bounds. Confirm to continue.",
            "edit": {"state_bounds": raw.get("state_bounds"), "input_bounds": raw.get("input_bounds")},
        }
    return {"status": "continue", "reply": reply, "edit": None}


def _bounds_or_keep(
    edit: dict[str, Any],
    key: str,
    proposal: dict[str, Any],
    length: int,
    name: str,
) -> Optional[list[list[Optional[float]]]]:
    if key in edit:
        return check_bounds(edit[key], length, name)
    return proposal.get(key)


def check_bounds(value: Any, length: int, name: str) -> Optional[list[list[Optional[float]]]]:
    """Validate ``[[lower|None, upper|None], ...]`` aligned with ``length`` variables."""
    if value is None:
        return None
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{name} must have {length} [lower, upper] pairs")
    out: list[list[Optional[float]]] = []
    for index, pair in enumerate(value):
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"{name}[{index}] must be [lower, upper]")
        lower, upper = (_finite_or_none(v, name) for v in pair)
        if lower is not None and upper is not None and lower > upper:
            raise ValueError(f"{name}[{index}]: lower bound {lower} is above upper bound {upper}")
        out.append([lower, upper])
    return out


def _finite_or_none(value: Any, name: str) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} contains a non-numeric bound: {value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} contains a non-finite bound: {value!r}")
    return number


def _any_bound(pairs: Optional[list[list[Optional[float]]]]) -> bool:
    return bool(pairs) and any(lo is not None or hi is not None for lo, hi in pairs)
