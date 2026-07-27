"""Pure configuration helpers for the Silo Designer workflow."""

from copy import deepcopy
from typing import Any, Dict, Optional


DEFAULT_DESIGN_CONFIG: Dict[str, Any] = {
    "llm_model": "gpt-oss-120b",
    "controllers": ["PID", "FSF"],
    "max_scenarios": 2,
    "max_iter": 20,
    "seed": 42,
    "max_tries": 0,
    "target_metrics": {
        "mse": 0.15,
        "settling_time": 3.5,
        "overshoot": 0.0,
        "max_iterations": 20,
    },
    "dt": 0.01,
    "max_time": 5.0,
    "target": 0.0,
    "num_inputs": 1,
    "input_channel": 0,
    "output_channel": 0,
    "min_ctrl": -10.0,
    "max_ctrl": 10.0,
    "trim_values": None,
    "num_states": None,
    "matlab_func_name": None,
    "param_ranges": None,
    "custom_scenarios": None,
    "enable_ga": False,
    "ga_config": None,
}


def get_default_param_ranges(controller_type: str, system: Optional[Any] = None) -> Dict[str, list[float]]:
    """Get default parameter ranges for a controller type."""
    if controller_type == "P":
        return {"Kp": [0.0, 100.0]}
    if controller_type == "PI":
        return {"Kp": [0.0, 100.0], "Ki": [0.0, 10.0]}
    if controller_type == "PD":
        return {"Kp": [0.0, 100.0], "Kd": [0.0, 50.0]}
    if controller_type == "PID":
        return {"Kp": [0.0, 200.0], "Ki": [0.0, 50.0], "Kd": [0.0, 100.0]}
    if controller_type == "FSF":
        num_states = 4
        if system and hasattr(system, "num_states"):
            num_states = system.num_states
        return {f"K{i + 1}": [-50.0, 50.0] for i in range(num_states)}
    return {}


def get_default_param_ranges_for_all() -> Dict[str, Dict[str, list[float]]]:
    """Get default parameter ranges for all supported controller types."""
    defaults = {}
    for controller in ["P", "PI", "PD", "PID", "FSF"]:
        defaults[controller] = get_default_param_ranges(controller)
    return defaults


def _matlab_func_name_from_config(config: Dict[str, Any]) -> Optional[str]:
    """Resolve MATLAB function name from config or uploaded filename."""
    explicit = config.get("matlab_func_name")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()

    file_name = config.get("file_name")
    if isinstance(file_name, str) and file_name.strip():
        stem = file_name.strip().split("/")[-1].split("\\")[-1]
        if stem.lower().endswith(".m"):
            stem = stem[:-2]
        if stem:
            return stem

    return "dynamics"


def build_design_config(
    base_config: Optional[Dict[str, Any]] = None,
    *,
    custom_dynamics_path: Optional[str] = None,
    file_type: str = "Python (.py)",
    control_objective: str = "",
    file_content: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the Silo Designer runtime config from collected UI values."""
    selected_base_config = base_config or deepcopy(DEFAULT_DESIGN_CONFIG)

    # Uploaded dynamics are always executed as Python (MATLAB is converted upstream).
    if file_content:
        file_type = "Python (.py)"

    config = {
        **selected_base_config,
        "run_id": 1,
        "system_name": "custom",
        "custom_dynamics_path": custom_dynamics_path,
        "file_type": file_type,
        "control_objective": control_objective,
        "param_ranges": selected_base_config.get("param_ranges"),
        "file_content": file_content,
    }

    if config["file_type"] == "MATLAB/Octave (.m)":
        config["matlab_func_name"] = _matlab_func_name_from_config(config)
        config["num_states"] = selected_base_config.get("num_states")
    elif "FSF" in config.get("controllers", []):
        config["num_states"] = selected_base_config.get("num_states")

    config["trim_values"] = selected_base_config.get("trim_values")
    config["custom_scenarios"] = selected_base_config.get("custom_scenarios")
    config["enable_ga"] = selected_base_config.get("enable_ga", False)
    config["ga_config"] = selected_base_config.get("ga_config")

    return config
