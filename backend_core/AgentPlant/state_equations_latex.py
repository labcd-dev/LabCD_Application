"""Deterministic LaTeX for plant state equations from metadata.

Converts the symbolic ``state_equations`` list (already produced by the
metadata / reconcile path) into a display-math block suitable for the
AgentPlant chat reply. Uses sympy so fractions, products, and trig
functions are formatted correctly without LLM authorship.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

try:
    from sympy import Symbol, latex, sympify
except ImportError:  # pragma: no cover - sympy is a project dependency
    Symbol = None  # type: ignore[assignment, misc]
    latex = None  # type: ignore[assignment, misc]
    sympify = None  # type: ignore[assignment, misc]


def _build_symbol_dict(
    states: List[str],
    inputs: List[str],
    parameters: Dict[str, Any],
) -> Dict[str, Any]:
    """Map every identifier that may appear in an equation to a sympy Symbol."""
    symbol_dict: Dict[str, Any] = {}
    for name in states:
        if isinstance(name, str) and name.strip():
            symbol_dict[name] = Symbol(name, real=True)
    for name in inputs:
        if isinstance(name, str) and name.strip():
            symbol_dict[name] = Symbol(name, real=True)
    for name in parameters:
        if isinstance(name, str) and name.strip():
            symbol_dict[name] = Symbol(name, real=True)
    return symbol_dict


def _equation_to_latex(equation_str: str, symbol_dict: Dict[str, Any]) -> Optional[str]:
    """Parse one RHS equation string and return its LaTeX form, or None on failure."""
    if not isinstance(equation_str, str) or not equation_str.strip():
        return None
    if sympify is None or latex is None:
        return None
    try:
        expr = sympify(equation_str.strip(), locals=symbol_dict)
        return latex(expr)
    except Exception:  # noqa: BLE001 - any parse failure is non-fatal
        return None


def generate_state_equations_latex(metadata: Dict[str, Any]) -> Optional[str]:
    r"""Build an ``aligned`` (or single) equation block from metadata.

    Expected keys (all optional-tolerant; returns None if insufficient):
      - states: list[str]
      - state_equations: list[str] (same length as states)
      - inputs: list[str] (may be empty)
      - parameters: dict (may be empty)

    States are shown as ``\dot{x}_1``, ``\dot{x}_2``, … in declared order.
    RHS symbols keep their original names (theta, omega, V, K, …) so they
    match the metadata panel the user already sees.
    """
    if not isinstance(metadata, dict):
        return None
    if sympify is None or latex is None:
        return None

    states = metadata.get("states") or []
    inputs = metadata.get("inputs") or []
    state_equations = metadata.get("state_equations") or []
    parameters = metadata.get("parameters") or {}

    if not isinstance(states, list) or not states:
        return None
    if not isinstance(state_equations, list) or len(state_equations) != len(states):
        return None
    if not isinstance(inputs, list):
        inputs = []
    if not isinstance(parameters, dict):
        parameters = {}

    symbol_dict = _build_symbol_dict(
        [s for s in states if isinstance(s, str)],
        [i for i in inputs if isinstance(i, str)],
        parameters,
    )

    rhs_list: List[str] = []
    for eq_str in state_equations:
        latex_expr = _equation_to_latex(eq_str, symbol_dict)
        if latex_expr is None:
            return None
        rhs_list.append(latex_expr)

    if not rhs_list:
        return None

    if len(rhs_list) == 1:
        return f"\\dot{{x}}_{{1}} = {rhs_list[0]}"

    lines = [
        f"\\dot{{x}}_{{{i + 1}}} &= {rhs}"
        for i, rhs in enumerate(rhs_list)
    ]
    body = " \\\\\n".join(lines)
    return f"\\begin{{aligned}}\n{body}\n\\end{{aligned}}"


def format_equations_for_response(metadata: Dict[str, Any]) -> Optional[str]:
    """Wrap generated LaTeX in ``\\[ ... \\]`` for remark-math / KaTeX.

    Returns None when generation fails so callers can leave the reply unchanged.
    """
    latex_block = generate_state_equations_latex(metadata)
    if latex_block is None:
        return None
    return f"\n\n\\[\n{latex_block}\n\\]\n"
