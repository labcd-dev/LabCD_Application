"""
================================================================================
dynamics/loader.py
================================================================================
Loads a user-supplied dynamics plugin (.py file) and validates it against the
BaseDynamics contract. This is the *only* place that should reflect on / probe
a plugin's shape -- everywhere else in the codebase can trust the contract.
"""

from __future__ import annotations

import copy
import importlib.util
import inspect
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Type

import numpy as np

from .base import BaseDynamics, SystemConfig


class DynamicsPluginError(Exception):
    """Raised whenever a plugin file does not satisfy the plugin contract."""


@dataclass
class DynamicLoader:
    module: types.ModuleType
    dynamics_class: Type[BaseDynamics]
    config: SystemConfig
    source_name: str

    # ------------------------------------------------------------------
    @classmethod
    def load_from_path(cls, path: str) -> "DynamicLoader":
        source_path = Path(path).expanduser().resolve()
        if not source_path.exists():
            raise DynamicsPluginError(f"File not found: {source_path}")
        if source_path.suffix != ".py":
            raise DynamicsPluginError(f"Expected a .py file, got: {source_path.suffix}")

        module_name = f"agent_mpc_plugin_{source_path.stem}"
        spec = importlib.util.spec_from_file_location(module_name, source_path)
        if spec is None or spec.loader is None:
            raise DynamicsPluginError(f"Could not load module spec for {source_path}")

        module = importlib.util.module_from_spec(spec)

        # Inject the contract symbols so the plugin file can use them without
        # a `from backend_core.AgentMPC.dynamics.base import ...` line, mirroring the
        # original notebook's "auto-injected namespace" behaviour.
        module.__dict__.update(
            {
                "BaseDynamics": BaseDynamics,
                "SystemConfig": SystemConfig,
                "np": np,
            }
        )

        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)  # type: ignore[union-attr]
        except Exception as e:  # noqa: BLE001 - re-raised as a domain error
            raise DynamicsPluginError(f"Error while executing '{source_path.name}': {e}") from e

        return cls._build_from_module(module, source_path.name)

    @classmethod
    def load_from_module(cls, module: types.ModuleType) -> "DynamicLoader":
        """Load from an already-imported module (useful for notebook cells)."""
        return cls._build_from_module(module, getattr(module, "__name__", "<module>"))

    # ------------------------------------------------------------------
    @classmethod
    def _build_from_module(cls, module: types.ModuleType, source_name: str) -> "DynamicLoader":
        if not hasattr(module, "create_config"):
            raise DynamicsPluginError(f"'{source_name}' must define create_config() -> SystemConfig")

        config = module.create_config()
        if not isinstance(config, SystemConfig):
            raise DynamicsPluginError(
                f"create_config() must return a SystemConfig, got {type(config).__name__}"
            )

        # Ensure module.dynamics is resilient to scalar/array u mismatches and inhomogeneous array outputs
        if hasattr(module, "dynamics") and callable(module.dynamics):
            orig_dyn = module.dynamics

            def resilient_module_dynamics(t, x, u):
                # If single-input system and u passed as 1-element array, try scalar float first
                if isinstance(u, (np.ndarray, list)) and np.size(u) == 1:
                    try:
                        res = orig_dyn(t, x, float(np.asarray(u).item()))
                        if isinstance(res, (list, tuple)):
                            return np.array([float(np.squeeze(v)) for v in res], dtype=float)
                        return res
                    except (TypeError, IndexError):
                        pass
                res = orig_dyn(t, x, u)
                if isinstance(res, (list, tuple)):
                    try:
                        return np.asarray(res, dtype=float)
                    except ValueError:
                        return np.array([float(np.squeeze(v)) for v in res], dtype=float)
                return res

            module.dynamics = resilient_module_dynamics

        dynamics_class = cls._find_dynamics_class(module, source_name)

        # Also wrap dynamics_class.dynamics to ensure clean 1D float array return and handle array vs scalar u
        orig_cls_dynamics = dynamics_class.dynamics

        def resilient_class_dynamics(self, x: np.ndarray, u: np.ndarray) -> np.ndarray:
            try:
                out = orig_cls_dynamics(self, x, u)
            except (ValueError, TypeError) as err:
                u_arr = np.asarray(u, dtype=float).reshape(-1)
                if u_arr.size == 1:
                    try:
                        out = orig_cls_dynamics(self, x, float(u_arr[0]))
                    except Exception:
                        raise err
                else:
                    raise err

            if isinstance(out, (list, tuple)):
                try:
                    return np.asarray(out, dtype=float).reshape(-1)
                except ValueError:
                    return np.array([float(np.squeeze(v)) for v in out], dtype=float).reshape(-1)
            return np.asarray(out, dtype=float).reshape(-1)

        dynamics_class.dynamics = resilient_class_dynamics

        cls._validate_dynamics(dynamics_class, config, source_name)

        return cls(module=module, dynamics_class=dynamics_class, config=config, source_name=source_name)

    @staticmethod
    def _find_dynamics_class(module: types.ModuleType, source_name: str) -> Type[BaseDynamics]:
        candidates = [
            obj
            for _, obj in inspect.getmembers(module, inspect.isclass)
            if issubclass(obj, BaseDynamics)
            and obj is not BaseDynamics
            and not inspect.isabstract(obj)
            and obj.__module__ == module.__name__
        ]
        if not candidates:
            raise DynamicsPluginError(
                f"No concrete BaseDynamics subclass found in '{source_name}'."
            )
        if len(candidates) > 1:
            names = ", ".join(c.__name__ for c in candidates)
            raise DynamicsPluginError(
                f"Multiple BaseDynamics subclasses found in '{source_name}': {names}. "
                "Only one dynamics class per plugin file is allowed."
            )
        return candidates[0]

    @staticmethod
    def _validate_dynamics(dynamics_class: Type[BaseDynamics], config: SystemConfig, source_name: str) -> None:
        try:
            instance = dynamics_class(config)
        except Exception as e:  # noqa: BLE001
            raise DynamicsPluginError(f"Could not instantiate '{dynamics_class.__name__}': {e}") from e

        # Test at default_initial_state if available, falling back to zero state
        if (
            config.default_initial_state is not None
            and len(config.default_initial_state) == config.n_states
        ):
            x_test = np.asarray(config.default_initial_state, dtype=float)
        else:
            x_test = np.zeros(max(1, config.n_states))
        u_test = np.zeros(max(1, config.n_inputs))

        try:
            dx = np.asarray(instance.dynamics(x_test, u_test), dtype=float)
        except Exception as e:  # noqa: BLE001
            # Fallback to zero state in case default_initial_state was out of bounds
            x_test_zero = np.zeros(max(1, config.n_states))
            try:
                dx = np.asarray(instance.dynamics(x_test_zero, u_test), dtype=float)
            except Exception as e2:  # noqa: BLE001
                raise DynamicsPluginError(f"dynamics(x, u) raised at test state: {e}") from e

        if dx.shape != (config.n_states,):
            raise DynamicsPluginError(
                f"dynamics() must return shape ({config.n_states},), got {dx.shape}"
            )
        if not np.all(np.isfinite(dx)):
            raise DynamicsPluginError(
                "dynamics() returned non-finite values during validation "
                "(check for division by zero in the model parameters)."
            )

    # ------------------------------------------------------------------
    def create_dynamics(self, params: Optional[Dict[str, Any]] = None) -> BaseDynamics:
        # Deep-copy so each dynamics instance gets its OWN independent
        # config -- self.config is loaded once and would otherwise be
        # shared (by reference) across every call, meaning any mutation to
        # a previous instance's params/default_initial_state/default_target
        # (e.g. agents/scenario_presets.py's Level 3 parameter perturbation,
        # or any scenario's initial-state override) would silently leak
        # into every later create_dynamics() call from this same plugin,
        # even though each call looks like it should be getting a clean
        # instance.
        config = copy.deepcopy(self.config)
        if params:
            config.params.update(params)
        return self.dynamics_class(config)

    def summary(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "source_file": self.source_name,
            "dynamics_class": self.dynamics_class.__name__,
            "n_states": self.config.n_states,
            "n_inputs": self.config.n_inputs,
            "state_names": self.config.state_names,
            "input_names": self.config.input_names,
            "params": self.config.params,
        }
        if self.config.input_bounds is not None:
            out["input_bounds"] = tuple(b.tolist() for b in self.config.input_bounds)
        if self.config.state_bounds is not None:
            out["state_bounds"] = tuple(b.tolist() for b in self.config.state_bounds)
        return out
