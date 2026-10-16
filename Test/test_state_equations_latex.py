"""Unit tests for deterministic state-equation LaTeX generation."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

# Load module by path to avoid backend_core.AgentPlant.__init__ pulling in LLM deps.
_MOD_PATH = (
    Path(__file__).resolve().parents[1]
    / "backend_core"
    / "AgentPlant"
    / "state_equations_latex.py"
)
_spec = importlib.util.spec_from_file_location("state_equations_latex", _MOD_PATH)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)

_build_symbol_dict = _mod._build_symbol_dict
_equation_to_latex = _mod._equation_to_latex
format_equations_for_response = _mod.format_equations_for_response
generate_state_equations_latex = _mod.generate_state_equations_latex



class TestBuildSymbolDict:
    def test_basic(self):
        d = _build_symbol_dict(["theta", "omega"], ["V"], {"K": 0.1, "b": 0.1, "J": 0.01})
        assert set(d.keys()) == {"theta", "omega", "V", "K", "b", "J"}


class TestEquationToLatex:
    def test_simple(self):
        d = _build_symbol_dict(["omega"], [], {})
        assert _equation_to_latex("omega", d) is not None

    def test_complex_fraction(self):
        d = _build_symbol_dict(["theta", "omega"], ["V"], {"K": 1, "b": 1, "J": 1})
        out = _equation_to_latex("(K*V - b*omega)/J", d)
        assert out is not None
        assert "frac" in out
        assert "K" in out

    def test_invalid(self):
        d = _build_symbol_dict(["x"], [], {})
        assert _equation_to_latex("not a valid (((", d) is None

    def test_empty(self):
        assert _equation_to_latex("", {}) is None
        assert _equation_to_latex("   ", {}) is None


class TestGenerateStateEquationsLatex:
    def test_dc_motor(self):
        meta = {
            "states": ["theta", "omega"],
            "inputs": ["V"],
            "state_equations": ["omega", "(K * V - b * omega) / J"],
            "parameters": {"K": 0.1, "b": 0.1, "J": 0.01},
        }
        out = generate_state_equations_latex(meta)
        assert out is not None
        assert r"\begin{aligned}" in out
        assert r"\dot{x}_{1}" in out
        assert r"\dot{x}_{2}" in out
        assert "frac" in out
        assert r"\end{aligned}" in out

    def test_single_state(self):
        meta = {
            "states": ["x"],
            "inputs": ["u"],
            "state_equations": ["-a * x + u"],
            "parameters": {"a": 1.0},
        }
        out = generate_state_equations_latex(meta)
        assert out is not None
        assert r"\dot{x}_{1}" in out
        # single equation — no aligned required
        assert "aligned" not in out or r"\dot{x}_{1}" in out

    def test_three_state(self):
        meta = {
            "states": ["x", "y", "z"],
            "inputs": ["u1", "u2"],
            "state_equations": ["-a*x + u1", "-b*y + u2 + x", "-c*z + y"],
            "parameters": {"a": 1, "b": 1, "c": 1},
        }
        out = generate_state_equations_latex(meta)
        assert out is not None
        assert r"\dot{x}_{3}" in out

    def test_missing_keys(self):
        assert generate_state_equations_latex({}) is None
        assert generate_state_equations_latex({"states": ["x"]}) is None

    def test_mismatched_count(self):
        meta = {
            "states": ["a", "b"],
            "inputs": ["u"],
            "state_equations": ["u"],
            "parameters": {},
        }
        assert generate_state_equations_latex(meta) is None

    def test_empty_states(self):
        assert generate_state_equations_latex({"states": [], "state_equations": []}) is None

    def test_invalid_equation_in_list(self):
        meta = {
            "states": ["x"],
            "inputs": [],
            "state_equations": ["(((broken"],
            "parameters": {},
        }
        assert generate_state_equations_latex(meta) is None


class TestFormatEquationsForResponse:
    def test_wraps_display_math(self):
        meta = {
            "states": ["theta", "omega"],
            "inputs": ["V"],
            "state_equations": ["omega", "(K*V - b*omega)/J"],
            "parameters": {"K": 0.1, "b": 0.1, "J": 0.01},
        }
        out = format_equations_for_response(meta)
        assert out is not None
        assert r"\[" in out
        assert r"\]" in out
        assert "aligned" in out

    def test_none_on_invalid(self):
        assert format_equations_for_response({}) is None
        assert format_equations_for_response({"states": ["x"]}) is None
