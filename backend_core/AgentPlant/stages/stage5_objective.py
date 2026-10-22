"""Stage 5 — control objective (real LLM agent, HITL).

Drafts a plain-language objective from Stages 1-4 and revises it on request.
The prompt adapts its scope to SISO/MIMO, continuous/discrete, and actuation.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from backend_core.AgentPlant.stages.common import describe_plant, load_prompt, render, run_json_turn

TRACE_LABEL = "Control objective"
PROMPT_FILE = "stage5_objective"


def draft_control_objective(
    llm: Any,
    metadata: dict[str, Any],
    data: dict[str, Any],
    *,
    current_text: Optional[str] = None,
    revision_request: Optional[str] = None,
) -> Optional[str]:
    """Return the drafted (or revised) objective text, or ``None`` if the model reply was unusable."""
    context = {
        "plant": describe_plant(metadata),
        "analysis": json.dumps(data.get("analysis") or {}, indent=2, default=str),
        "trim": json.dumps(data.get("trim") or {}, indent=2, default=str),
        "constraints": json.dumps(data.get("constraints") or {}, indent=2, default=str),
        "current_objective": current_text or "(none yet — draft one)",
        "revision_request": revision_request or "(none — first draft)",
    }
    raw = run_json_turn(llm, load_prompt(PROMPT_FILE, "system_prompt"), render(
        load_prompt(PROMPT_FILE, "user_prompt_template"), context
    ))
    text = str((raw or {}).get("control_objective") or "").strip()
    return text or None
