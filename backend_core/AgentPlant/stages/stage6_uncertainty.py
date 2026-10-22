"""Stage 6 — uncertainty and disturbance screening (shallow clone).

Literal shallow clone of ``backend_core/AgentAdaptive/prompts/clarifier_agent_prompt.yaml``
with the ``references`` handling removed (no reference signal exists at the Plant
stage yet). The original clarifier and its prompt are untouched.
See stages/ASSIGNMENT_stage6_uncertainty_clarifier.md.
"""

from __future__ import annotations

from typing import Any

from backend_core.AgentPlant.stages.common import describe_plant, format_dialogue, load_prompt, render, run_json_turn

TRACE_LABEL = "Uncertainty / disturbance screen"
PROMPT_FILE = "stage6_uncertainty_clarifier"
FIRST_TURN_MARKER = "(none — this is the first turn; ask your first question)"
FALLBACK_QUESTION = "Does the real plant differ from these equations in any way, such as an unmodelled or external effect?"


def clarifier_turn(
    llm: Any,
    metadata: dict[str, Any],
    dialogue: list[dict[str, str]],
    user_message: str | None,
) -> dict[str, Any]:
    """One turn. Returns ``{"status": "continue", "reply"}`` or
    ``{"status": "complete", "reply", "uncertainty", "disturbance"}``.

    Only ``uncertainty`` and ``disturbance`` are read from the model, so a stray
    ``references`` key can never come back out of this function.
    """
    prompt = render(
        load_prompt(PROMPT_FILE, "user_prompt_template"),
        {
            "plant": describe_plant(metadata),
            "conversation_history": format_dialogue(dialogue),
            "user_message": user_message or FIRST_TURN_MARKER,
        },
    )
    raw = run_json_turn(llm, load_prompt(PROMPT_FILE, "system_prompt"), prompt)
    if raw is None:
        return {"status": "continue", "reply": FALLBACK_QUESTION}

    reply = str(raw.get("reply") or "").strip()
    if raw.get("status") != "complete":
        return {"status": "continue", "reply": reply or FALLBACK_QUESTION}

    dynamics = raw.get("dynamics") if isinstance(raw.get("dynamics"), dict) else {}
    states = list(metadata.get("states") or [])
    uncertainty = clean_terms(dynamics.get("uncertainty"), states)
    disturbance = clean_terms(dynamics.get("disturbance"), states)
    if uncertainty is None or disturbance is None:
        return {
            "status": "continue",
            "reply": f"One of the terms names a state I don't have. The states are: {', '.join(states)}. Which state does it enter?",
        }
    return {
        "status": "complete",
        "reply": reply or "Recorded.",
        "uncertainty": uncertainty,
        "disturbance": disturbance,
    }


def clean_terms(raw: Any, states: list[str]) -> list[dict[str, str]] | None:
    """Keep only ``state`` and ``expr``. ``None`` if any term names a non-existent state."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        return None
    cleaned: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        state = str(item.get("state") or "").strip()
        if state not in states:
            return None
        cleaned.append({"state": state, "expr": str(item.get("expr") or "").strip()})
    return cleaned
