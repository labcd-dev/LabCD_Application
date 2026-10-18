"""Stage 7: checks if a plant can launch in Adaptive (SMC or backstepping). Pure Python, no LLM.

SMC needs a square plant, finite relative degrees and a non-singular decoupling matrix.
Backstepping needs one input, outputs == [states[0]] and a strict-feedback chain.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

import sympy as sp

from backend_core.AgentAdaptive.controller.structure_build import _parse_system, _strict_feedback_violations
from backend_core.AgentAdaptive.tools.system_spec import substitute_parameters

MAX_RELATIVE_DEGREE = 6
SINGULAR_TOLERANCE = 1e-9
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def check_adaptive(metadata: dict[str, Any], trim: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """launchable is True if a method accepts the plant, False if none does, None if it can't be judged."""
    bad_names = _non_identifier_names(metadata)
    if bad_names:
        return _verdict(
            False, {}, [], [],
            f"These names aren't plain identifiers, so Adaptive can't read the equations: {', '.join(bad_names)}.",
        )
    try:
        system = _parse_plant(metadata)
    except ValueError as exc:
        return _verdict(None, {}, [], [], f"Not evaluated: {exc}")

    problem = _missing_basics(system)
    if problem:
        return _verdict(False, {}, [], [], problem)

    smc, rel_degrees, warnings = _smc_report(system, _trim_point(trim, system["states"]))
    backstepping = _backstepping_report(system)
    methods = {"smc": smc, "backstepping": backstepping}
    return _verdict(
        smc["ok"] or backstepping["ok"], methods, rel_degrees, warnings, _reason(methods)
    )


def _non_identifier_names(metadata: dict[str, Any]) -> list[str]:
    """States, inputs, outputs and parameters whose name sympy can't use as a symbol (like u[0])."""
    names = [*(metadata.get("states") or []), *(metadata.get("inputs") or []),
             *(metadata.get("outputs") or []), *(metadata.get("parameters") or {})]
    return [str(name) for name in names if not IDENTIFIER.match(str(name))]


def _parse_plant(metadata: dict[str, Any]) -> dict[str, Any]:
    """Sympy equations with the parameter values plugged in."""
    states = list(metadata.get("states") or [])
    equations = list(metadata.get("state_equations") or [])
    if not states or len(equations) != len(states):
        raise ValueError("the plant has no usable states and state equations")
    spec = {
        "status": "complete",
        "system_name": "",
        "dynamics": {
            "states": states,
            "inputs": list(metadata.get("inputs") or []),
            "outputs": list(metadata.get("outputs") or []),
            "state_equations": equations,
            "parameters": dict(metadata.get("parameters") or {}),
        },
    }
    dyn = substitute_parameters(spec)["dynamics"]
    try:
        state_syms, input_syms, output_syms, f, _ = _parse_system(
            states, dyn["state_equations"], dyn["inputs"], dyn["outputs"]
        )
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"the state equations could not be parsed ({type(exc).__name__}: {exc})") from exc
    return {
        "states": states,
        "inputs": dyn["inputs"],
        "outputs": dyn["outputs"],
        "equations": dyn["state_equations"],
        "state_syms": state_syms,
        "input_syms": input_syms,
        "output_syms": output_syms,
        "f": f,
    }


def _missing_basics(system: dict[str, Any]) -> Optional[str]:
    if not system["inputs"]:
        return "The plant has no inputs, so there is nothing to control."
    if not system["outputs"]:
        return "The plant has no outputs to track."
    unknown = [name for name in system["outputs"] if name not in system["states"]]
    if unknown:
        return f"Adaptive tracks states, but these outputs are not states: {', '.join(unknown)}."
    return None


def plant_metadata_from_json(raw: Any) -> tuple[dict[str, Any], Optional[list[float]]]:
    """Gets (metadata, initial_state) out of a plant JSON (agent output, final_result or artifact)."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError("the JSON must be an object")
    raw = raw.get("final_result") if isinstance(raw.get("final_result"), dict) else raw
    plant = raw.get("plant") if isinstance(raw.get("plant"), dict) else raw
    metadata = plant.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("metadata is missing; expected states, inputs, outputs and state_equations")
    initial_state = (raw.get("pre_launch") or {}).get("initial_state")
    return metadata, initial_state if isinstance(initial_state, list) else None


def _trim_point(trim: Optional[dict[str, Any]], states: list[str]) -> list[float]:
    x0 = (trim or {}).get("x0")
    return list(x0) if isinstance(x0, list) and len(x0) == len(states) else [0.0] * len(states)


def _smc_report(system: dict[str, Any], x0: list[float]) -> tuple[dict, list, list]:
    reasons: list[str] = []
    n_in, n_out = len(system["inputs"]), len(system["outputs"])
    if n_in != n_out:
        reasons.append(f"SMC needs a square plant, but there are {n_in} input(s) and {n_out} output(s).")
        return _report(reasons), [], []

    rel_degrees: list[Optional[int]] = []
    rows: list[list[sp.Expr]] = []
    for name, symbol in zip(system["outputs"], system["output_syms"]):
        degree, row = _relative_degree(symbol, system)
        rel_degrees.append(degree)
        if degree is None:
            reasons.append(
                f"No input reaches output {name} within {MAX_RELATIVE_DEGREE} derivatives, "
                "so its relative degree is undefined."
            )
        elif any(entry.has(*system["input_syms"]) for entry in row):
            reasons.append(f"The input enters output {name} non-affinely, so SMC cannot invert it.")
        else:
            rows.append(row)
    if reasons:
        return _report(reasons), rel_degrees, []

    warnings = _decoupling_warnings(sp.Matrix(rows), system, x0, reasons)
    return _report(reasons), rel_degrees, warnings


def _relative_degree(output: sp.Expr, system: dict[str, Any]) -> tuple[Optional[int], list[sp.Expr]]:
    """Lie-derivative search, capped so it can't hang. Gives (degree, decoupling row) or (None, [])."""
    current = output
    for degree in range(1, MAX_RELATIVE_DEGREE + 1):
        current = sp.expand(sum(sp.diff(current, s) * fi for s, fi in zip(system["state_syms"], system["f"])))
        if any(current.has(u) for u in system["input_syms"]):
            return degree, [sp.diff(current, u) for u in system["input_syms"]]
    return None, []


def _decoupling_warnings(matrix: sp.Matrix, system: dict[str, Any], x0: list[float], reasons: list[str]) -> list[str]:
    """Adds a reason if the matrix is always singular, warns if it's singular at x0."""
    try:
        determinant = sp.simplify(matrix.det())
    except Exception:  # noqa: BLE001
        return ["Could not decide whether the decoupling matrix is singular."]
    if determinant == 0:
        reasons.append("The decoupling matrix is singular for every state, so the inputs cannot be separated.")
        return []
    at_x0 = determinant.subs(dict(zip(system["state_syms"], x0)))
    if at_x0.is_number and abs(complex(at_x0)) < SINGULAR_TOLERANCE:
        return ["The decoupling matrix is singular at the trim point."]
    return []


def _backstepping_report(system: dict[str, Any]) -> dict[str, Any]:
    structure = {
        "states": system["states"],
        "dynamics": system["equations"],
        "inputs": system["inputs"],
        "outputs": system["outputs"],
    }
    reasons = _strict_feedback_violations(structure)
    reasons += _non_affine_input_reasons(system)
    return _report(reasons)


def _non_affine_input_reasons(system: dict[str, Any]) -> list[str]:
    """Backstepping needs every equation to be affine in the input."""
    if len(system["input_syms"]) != 1:
        return []
    u = system["input_syms"][0]
    return [
        f"Equation of {state} is not affine in input {system['inputs'][0]}, which backstepping requires."
        for state, expr in zip(system["states"], system["f"])
        if sp.simplify(sp.diff(expr, u, 2)) != 0
    ]


def _report(reasons: list[str]) -> dict[str, Any]:
    return {"ok": not reasons, "reasons": reasons}


def _verdict(launchable, methods, rel_degrees, warnings, reason) -> dict[str, Any]:
    return {
        "launchable": launchable,
        "methods": methods,
        "relative_degrees": rel_degrees,
        "warnings": warnings,
        "reason": reason,
    }


def _reason(methods: dict[str, dict[str, Any]]) -> str:
    accepted = [name for name, report in methods.items() if report["ok"]]
    if accepted:
        return "Adaptive can launch this plant with: " + ", ".join(accepted) + "."
    lines = [f"{name}: {'; '.join(report['reasons'])}" for name, report in methods.items()]
    return "Adaptive cannot launch this plant. " + " | ".join(lines)
