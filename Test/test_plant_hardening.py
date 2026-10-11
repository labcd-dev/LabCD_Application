"""Unit tests for plant drafting / plugin generation hardening.

Covers:
  A. digit-safe class names
  B. multi-input arity from u[i] scan
  C. zero-state epsilon retry in DynamicLoader
  E. sandbox module-level params (single namespace exec)
  F. smoke_test_dynamics
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import numpy as np
import pytest

from backend_core.plant_compiler import PlantCompiler, _safe_class_name
from backend_core.AgentMPC.dynamics.loader import DynamicLoader, DynamicsPluginError

# Import sandbox module directly to avoid PlantModelChat package __init__
# (which pulls labcd_agents / langchain at import time).
import importlib.util
import sys as _sys

_sandbox_path = Path(__file__).resolve().parents[1] / "backend_api" / "PlantModelChat" / "plant_tools" / "sandbox.py"
_spec = importlib.util.spec_from_file_location("plant_sandbox_under_test", _sandbox_path)
_sandbox = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_sys.modules["plant_sandbox_under_test"] = _sandbox
_spec.loader.exec_module(_sandbox)
compile_dynamics = _sandbox.compile_dynamics
smoke_test_dynamics = _sandbox.smoke_test_dynamics
DynamicsCodeError = _sandbox.DynamicsCodeError


# ---------------------------------------------------------------------------
# A. _safe_class_name
# ---------------------------------------------------------------------------

def test_safe_class_name_never_starts_with_digit():
    assert _safe_class_name("Cart-Pole") == "CartPole"
    assert not _safe_class_name("2-DOF Arm")[0].isdigit()
    assert _safe_class_name("2-DOF Arm").startswith("Sys")
    assert _safe_class_name("123") == "Sys123"
    assert _IDENT_START(_safe_class_name("Inverted_Pendulum_Cart-Pole"))


def _IDENT_START(name: str) -> bool:
    return bool(name) and (name[0].isalpha() or name[0] == "_")


def test_safe_class_name_empty_fallback():
    assert _safe_class_name("") == "System"
    assert _safe_class_name("!!!") == "System" or _safe_class_name("!!!").startswith("Sys")


# ---------------------------------------------------------------------------
# B. multi-input arity
# ---------------------------------------------------------------------------

VEHICLE_LIKE = textwrap.dedent("""\
import numpy as np
def dynamics(t, x, u):
    throttle = float(u[0])
    brake = float(u[1])
    delta = float(u[2])
    return np.array([x[3], x[4], x[5], throttle - brake, delta, 0.0, 0.0, 0.0])
""")


def test_generate_mpc_plugin_infers_three_inputs():
    compiler = PlantCompiler()
    plant = {
        "system_name": "Vehicle Dynamics Model",
        "python_code": VEHICLE_LIKE,
        "metadata": {
            # Intentionally under-declare inputs (the bug case)
            "states": [f"x{i}" for i in range(8)],
            "inputs": ["u"],
            "outputs": ["y"],
            "state_meanings": ["m"] * 8,
            "state_equations": ["0"] * 8,
            "parameters": {},
            "system_type": "MIMO",
            "assumptions": ["test"],
        },
    }
    src = compiler.generate_mpc_plugin(plant, {})
    assert "n_inputs=3" in src
    # Class must be loadable
    path = Path("/tmp/test_vehicle_plugin.py")
    path.write_text(src)
    # Inject base symbols like loader does
    import types, sys
    from backend_core.AgentMPC.dynamics.base import BaseDynamics, SystemConfig
    mod = types.ModuleType("test_vehicle_plugin")
    mod.__dict__.update({"BaseDynamics": BaseDynamics, "SystemConfig": SystemConfig, "np": np})
    exec(compile(src, str(path), "exec"), mod.__dict__)
    cfg = mod.create_config()
    assert cfg.n_inputs == 3
    inst = mod.__dict__[
        [k for k, v in mod.__dict__.items()
         if isinstance(v, type) and issubclass(v, BaseDynamics) and v is not BaseDynamics][0]
    ](cfg)
    dx = inst.dynamics(np.zeros(8), np.zeros(3))
    assert dx.shape == (8,)
    assert np.all(np.isfinite(dx))


# ---------------------------------------------------------------------------
# C. zero-state epsilon
# ---------------------------------------------------------------------------

TURBOJET_LIKE = textwrap.dedent("""\
import numpy as np
def dynamics(t, x, u):
    q = x[0]
    r = x[1]
    omega = x[2]
    T = x[3]
    T_comb = x[4]
    m_dot = x[5]
    unc = x[6]
    gamma = 1.4
    P0 = 101325.0
    T0 = 288.15
    dqdt = u[0] if np.ndim(u) else u
    drdt = (gamma * P0 / (T0 * r)) * (q - r)
    domega = (T - omega) / 10.0
    dT = (q * 1000.0) - (T / 5.0)
    dTcomb = (q * 1000.0 / m_dot) - (T_comb / 20.0)
    dmdot = (q - m_dot) / 2.0
    dunc = -0.1 * unc
    return np.array([dqdt, drdt, domega, dT, dTcomb, dmdot, dunc])
""")


def test_loader_accepts_zero_state_singularity_with_epsilon(tmp_path):
    compiler = PlantCompiler()
    plant = {
        "system_name": "Complex Turbojet Engine with Uncertainty",
        "python_code": TURBOJET_LIKE,
        "metadata": {
            "states": ["q", "r", "omega", "T", "T_comb", "m_dot", "unc"],
            "inputs": ["fuel"],
            "outputs": ["T"],
            "state_meanings": ["m"] * 7,
            "state_equations": ["0"] * 7,
            "parameters": {},
            "system_type": "SISO",
            "assumptions": ["test"],
        },
    }
    src = compiler.generate_mpc_plugin(plant, {})
    path = tmp_path / "turbojet_plugin.py"
    path.write_text(src)
    # Should not raise DynamicsPluginError thanks to epsilon retry
    plugin = DynamicLoader.load_from_path(str(path))
    assert plugin.config.n_states == 7


def test_loader_still_rejects_always_nonfinite(tmp_path):
    bad = textwrap.dedent("""\
import numpy as np
from backend_core.AgentMPC.dynamics.base import BaseDynamics, SystemConfig

def create_config():
    return SystemConfig(
        n_states=1, n_inputs=1, params={},
        state_names=['x'], input_names=['u'],
        default_initial_state=np.zeros(1), default_target=np.zeros(1),
    )

class BadDynamics(BaseDynamics):
    def dynamics(self, x, u):
        return np.array([np.nan])
""")
    path = tmp_path / "always_nan.py"
    path.write_text(bad)
    with pytest.raises(DynamicsPluginError, match="non-finite"):
        DynamicLoader.load_from_path(str(path))


# ---------------------------------------------------------------------------
# E. sandbox module-level params
# ---------------------------------------------------------------------------

def test_sandbox_module_level_params_visible():
    code = textwrap.dedent("""\
import numpy as np
R = 1.0
K = 2.5
def dynamics(t, x, u):
    return np.array([-R * x[0] + K * (u if np.ndim(u) == 0 else u[0])])
""")
    fn = compile_dynamics(code)
    out = fn(0.0, np.array([1.0]), 0.0)
    assert np.isfinite(out).all()
    assert abs(float(out[0]) - (-1.0)) < 1e-9


# ---------------------------------------------------------------------------
# F. smoke_test_dynamics
# ---------------------------------------------------------------------------

def test_smoke_ok_simple():
    code = textwrap.dedent("""\
import numpy as np
def dynamics(t, x, u):
    return np.array([-x[0] + (u if np.ndim(u) == 0 else u[0])])
""")
    r = smoke_test_dynamics(code)
    assert r.ok, r.message


def test_smoke_detects_bad_code():
    code = "def dynamics(t, x, u):\n    return unknown_name\n"
    r = smoke_test_dynamics(code)
    assert not r.ok


def test_digit_class_name_in_generated_plugin():
    compiler = PlantCompiler()
    plant = {
        "system_name": "2-DOF Rigid Planar Manipulator",
        "python_code": textwrap.dedent("""\
import numpy as np
def dynamics(t, x, u):
    return np.array([x[2], x[3], u[0], u[1]])
"""),
        "metadata": {
            "states": ["th1", "th2", "dth1", "dth2"],
            "inputs": ["tau1", "tau2"],
            "outputs": ["th1", "th2"],
            "state_meanings": ["a"] * 4,
            "state_equations": ["0"] * 4,
            "parameters": {},
            "system_type": "MIMO",
            "assumptions": ["test"],
        },
    }
    src = compiler.generate_mpc_plugin(plant, {})
    # Class line must be a valid identifier (not starting with digit)
    import re
    m = re.search(r"^class (\w+)\(BaseDynamics\)", src, re.M)
    assert m, src[:400]
    assert m.group(1)[0].isalpha() or m.group(1)[0] == "_"
    assert "n_inputs=2" in src


def test_smoke_allows_coulomb_with_euler():
    """Fixed-step Euler must accept discontinuous Coulomb friction (RK45 stalls)."""
    code = textwrap.dedent("""\
    import numpy as np
    def dynamics(t, x, u):
        th1, th2, d1, d2 = x[0], x[1], x[2], x[3]
        m1, l1, p1, I1 = 0.1, 0.8, 0.4, 0.064
        m2, p2, I2 = 0.1, 0.2, 0.016
        g = 9.8
        D11 = m1*p1**2 + m2*p2**2 + m2*l1**2 + 2*m2*l1*p2*np.cos(th2)
        D12 = m2*p2**2 + m2*l1*p2*np.cos(th2)
        D = np.array([[I1+I2+D11, I2+D12], [I2+D12, I2+m2*p2**2]])
        C = np.array([[-2*m2*l1*p2*np.sin(th2)*d2, -m2*l1*p2*np.sin(th2)*d2],
                      [m2*l1*p2*np.sin(th2)*d1, 0.0]])
        G = np.array([(m1*p1+m2*l1)*g*np.sin(th1)+m2*p2*g*np.sin(th1+th2),
                      m2*p2*g*np.sin(th1+th2)])
        tau = np.array([u[0], u[1]])
        Fs = np.sign([d1, d2])  # discontinuous Coulomb — OK with Euler
        qdd = np.linalg.inv(D) @ (tau - C @ np.array([d1, d2]) - 0.1*np.array([d1, d2]) - Fs - G)
        return np.array([d1, d2, qdd[0], qdd[1]])
    """)
    r = smoke_test_dynamics(code)
    assert r.ok, r.message


def test_smoke_still_rejects_name_error():
    code = textwrap.dedent("""\
    import numpy as np
    def dynamics(t, x, u):
        return np.array([x[0] + undefined_param, x[1]])
    """)
    r = smoke_test_dynamics(code)
    assert not r.ok
    assert "undefined" in r.message.lower() or "name" in r.message.lower()


def test_smoke_passes_smooth_friction():
    code = textwrap.dedent("""\
    import numpy as np
    def dynamics(t, x, u):
        th, dth = x[0], x[1]
        tau = u[0] if np.ndim(u) else u
        F_c = 0.2 * np.tanh(dth / 1e-2)
        ddth = -9.8 * np.sin(th) - 0.1 * dth - F_c + tau
        return np.array([dth, ddth])
    """)
    r = smoke_test_dynamics(code)
    assert r.ok, r.message
