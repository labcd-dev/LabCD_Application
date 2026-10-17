"""Shared plumbing for pipeline stages: prompt loading, template rendering,
JSON turns against the LLM, and vector validation."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from labcd_agents import PromptLibrary, extract_json_from_response

STAGES_DIR = Path(__file__).parent

# Only the fields the stages reason about. Stage-1 extras (complexity, etc.) are left out.
PLANT_CONTEXT_KEYS = (
    "states",
    "state_meanings",
    "inputs",
    "outputs",
    "state_equations",
    "parameters",
    "system_type",
    "assumptions",
)


@lru_cache(maxsize=1)
def _prompt_library() -> PromptLibrary:
    return PromptLibrary(str(STAGES_DIR))


def load_prompt(file_name: str, key: str) -> str:
    """Load ``<file_name>.yaml`` from the stages folder, same mechanism as Stage 1."""
    return _prompt_library().get_key(file_name, key)


def render(template: str, values: dict[str, str]) -> str:
    out = template
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", value)
    return out


def describe_plant(metadata: dict[str, Any]) -> str:
    return json.dumps({k: metadata.get(k) for k in PLANT_CONTEXT_KEYS}, indent=2, default=str)


def format_dialogue(dialogue: list[dict[str, str]]) -> str:
    if not dialogue:
        return "(no previous turns)"
    lines = []
    for turn in dialogue:
        role = "User" if turn.get("role") == "user" else "Assistant"
        lines.append(f"{role}: {turn.get('content', '')}")
    return "\n".join(lines)


def run_json_turn(llm: Any, system_prompt: str, user_prompt: str) -> Optional[dict[str, Any]]:
    """One LLM call expected to return a single JSON object. ``None`` if unparseable."""
    text, _ = llm.invoke_llm(system_prompt=system_prompt, user_prompt=user_prompt)
    try:
        data = extract_json_from_response(text)
    except Exception:  # noqa: BLE001 - any parse failure is handled by the caller
        return None
    return data if isinstance(data, dict) else None


def check_vector(value: Any, length: int, name: str) -> list[float]:
    """Validate a user- or LLM-supplied vector: right length, finite numbers."""
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{name} must be a list of {length} numbers")
    out: list[float] = []
    for item in value:
        try:
            number = float(item)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} contains a non-numeric value: {item!r}") from exc
        if not math.isfinite(number):
            raise ValueError(f"{name} contains a non-finite value: {item!r}")
        out.append(number)
    return out
