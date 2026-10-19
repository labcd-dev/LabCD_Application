"""Checks for the uncertainty / disturbance terms coming out of Stage 6."""

from __future__ import annotations

import re
from typing import Any

import sympy as sp

from backend_core.AgentAdaptive.controller.structure_build import ALLOWED_FUNCS

NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def clean_terms(raw: Any, kind: str, metadata: dict[str, Any]) -> list[dict[str, str]]:
    """Keep state + expr, check them, one term per state. Raises ValueError with a question for the user."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError(f"The {kind} should be a list of terms.")
    states = list(metadata.get("states") or [])
    exprs_by_state: dict[str, list[str]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        state = str(item.get("state") or "").strip()
        if state not in states:
            raise ValueError(
                f"The {kind} term names '{state}', which does not exist on this plant. "
                f"The states are: {', '.join(states)}. Which state does it enter?"
            )
        expr = str(item.get("expr") or "").strip()
        problem = expr_problem(expr, kind, metadata)
        if problem:
            raise ValueError(problem)
        exprs_by_state.setdefault(state, [])
        if expr:
            exprs_by_state[state].append(expr)
    return [{"state": state, "expr": _join(exprs)} for state, exprs in exprs_by_state.items()]


def expr_problem(expr: str, kind: str, metadata: dict[str, Any]) -> str | None:
    """Why this expression can't be used, or None. Empty = formula unknown, a bare name = placeholder."""
    if not expr or NAME.fullmatch(expr):
        return None
    states = set(metadata.get("states") or [])
    known = states | set(metadata.get("inputs") or []) | set(metadata.get("parameters") or {}) | {"t"}
    names = set(NAME.findall(expr)) - set(ALLOWED_FUNCS)

    unknown = sorted(names - known)
    if unknown:
        return f"'{expr}' uses names I can't place: {', '.join(unknown)}. Can you write it with t, the states or the parameters?"
    try:
        sp.sympify(expr, locals={**{n: sp.Symbol(n) for n in names}, **ALLOWED_FUNCS})
    except Exception:  # noqa: BLE001 - any sympy failure means the text isn't a formula
        return f"I can't read '{expr}' as a formula. Can you write it again, like 0.2*sin(t) + 0.1*x2?"

    if kind == "disturbance" and names & states:
        return f"'{expr}' depends on a state, so it's an uncertainty and not a disturbance. Should I record it as an uncertainty?"
    if kind == "uncertainty" and names == {"t"}:
        return f"'{expr}' only depends on time, so it's a disturbance and not an uncertainty. Should I record it as a disturbance?"
    return None


def _join(exprs: list[str]) -> str:
    # Adaptive keeps one expr per state, so several terms on a state get summed
    if len(exprs) > 1:
        return " + ".join(f"({expr})" for expr in exprs)
    return exprs[0] if exprs else ""
