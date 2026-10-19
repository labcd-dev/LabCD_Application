"""Stage 6: asks the user about uncertainty and disturbance, one question at a time.

Same prompt as the Adaptive clarifier (no references), plus python guards: no
early "complete", a turn cap, and the terms are checked in stage6_terms.py.
See stages/ASSIGNMENT_stage6_uncertainty_clarifier.md.
"""

from __future__ import annotations

from typing import Any

from backend_core.AgentPlant.stages.common import describe_plant, format_dialogue, load_prompt, render, run_json_turn
from backend_core.AgentPlant.stages.stage6_terms import clean_terms

TRACE_LABEL = "Uncertainty / disturbance screen"
PROMPT_FILE = "stage6_uncertainty_clarifier"
FIRST_TURN_MARKER = "(none — this is the first turn; ask your first question)"
FALLBACK_QUESTION = "Does the real plant differ from these equations in any way, such as an unmodelled or external effect?"
MAX_USER_TURNS = 6
NUDGE = (
    "You answered complete before asking anything. The plant JSON saying nothing about "
    "uncertainty is not the user saying there is none, so ask them first."
)
FORCE_FINISH = (
    "Reply now with status \"complete\", using your best understanding of everything said so far. "
    "If existence is still unclear, treat it as no uncertainty or disturbance."
)


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
    raw = _ask(llm, metadata, dialogue, user_message, _closing_note(dialogue, user_message))
    if raw is not None and raw.get("status") == "complete" and user_message is None:
        # nothing was asked yet, so complete is too early: one retry, then just ask
        raw = _ask(llm, metadata, dialogue, user_message, NUDGE)
        if raw is not None and raw.get("status") == "complete":
            raw = None
    if raw is None:
        return {"status": "continue", "reply": FALLBACK_QUESTION}

    reply = str(raw.get("reply") or "").strip()
    if raw.get("status") != "complete":
        return {"status": "continue", "reply": reply or FALLBACK_QUESTION}

    dynamics = raw.get("dynamics") if isinstance(raw.get("dynamics"), dict) else {}
    try:
        uncertainty = clean_terms(dynamics.get("uncertainty"), "uncertainty", metadata)
        disturbance = clean_terms(dynamics.get("disturbance"), "disturbance", metadata)
    except ValueError as exc:
        return {"status": "continue", "reply": str(exc)}
    return {
        "status": "complete",
        "reply": reply or "Recorded.",
        "uncertainty": uncertainty,
        "disturbance": disturbance,
    }


def _ask(llm, metadata, dialogue, user_message, note=""):
    prompt = render(
        load_prompt(PROMPT_FILE, "user_prompt_template"),
        {
            "plant": describe_plant(metadata),
            "conversation_history": format_dialogue(dialogue),
            "user_message": user_message or FIRST_TURN_MARKER,
        },
    )
    if note:
        prompt += "\n\n" + note
    return run_json_turn(llm, load_prompt(PROMPT_FILE, "system_prompt"), prompt)


def _closing_note(dialogue, user_message):
    # after enough user turns the model has to wrap up
    user_turns = sum(1 for turn in dialogue if turn.get("role") == "user") + (1 if user_message else 0)
    return FORCE_FINISH if user_turns >= MAX_USER_TURNS else ""
