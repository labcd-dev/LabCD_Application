"""MuloDesigner HTTP service adapter."""

from __future__ import annotations

import copy
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend_api.MuloDesigner.GaAgent.data import (
    DEFAULT_OBJECTIVES,
    apply_ga_event,
    empty_plot_data,
    load_case_study_content,
)
from backend_api.MuloDesigner.GaAgent.src.utils import coerce_metric_targets, coerce_simulation_params
from backend_api.MuloDesigner.GaAgent.src.callbacks import register_callback, unregister_callback
from backend_api.MuloDesigner.controller_tuning import (
    active_controller_index,
    apply_pid_gains_to_controller_structure,
    controller_loop_name,
    get_pid_gain_bounds,
    get_pid_gains,
    replace_last_pid_controller_gains,
)
from backend_api.MuloDesigner.design_controller import MuloControllerDesigner
from backend_api.MuloDesigner.simulation_utils import simulate_system_response
from backend_api.common.serialization import make_serializable
from backend_api.http.config import PROJECT_ROOT
from backend_api.http.services.job_store import JobStatus, job_store
from backend_api.http.services.project_service import link_or_create_for_job, sync_project_from_job

MULO_INPUTS_DIR = PROJECT_ROOT / "frontend_streamlit" / "inputs"
MULO_REQUIRED_FILES = (
    "controller.json",
    "trimming_result.json",
    "system_identification.json",
    "equation.py",
)

DEFAULT_MULO_RUN_CONFIG: Dict[str, Any] = {
    "case_study_file": "",
    "seed": 42,
    "llm_model": "gpt-4o-mini",
    "web_search_model": None,
    "max_attempts": 5,
    "buffer_size": 3,
    "max_wall_clock": 120.0,
    "max_cost_budget": 1.0,
    "prompt_variant": "elaborate",
    "control_objective": "",
}


def normalize_run_config(run_config: Dict[str, Any]) -> Dict[str, Any]:
    """Merge caller overrides with safe defaults for the GA workflow."""
    merged = {**DEFAULT_MULO_RUN_CONFIG, **(run_config or {})}
    merged["max_attempts"] = max(int(float(merged.get("max_attempts", 5))), 1)
    merged["seed"] = int(float(merged.get("seed", 42)))
    merged["buffer_size"] = max(int(float(merged.get("buffer_size", 3))), 1)
    merged["max_wall_clock"] = float(merged.get("max_wall_clock", 120.0))
    merged["max_cost_budget"] = float(merged.get("max_cost_budget", 1.0))
    return merged


def list_mulo_case_studies() -> List[str]:
    """Return case-study folder names that contain all required Mulo inputs."""
    if not MULO_INPUTS_DIR.exists():
        return []
    studies: List[str] = []
    for folder in MULO_INPUTS_DIR.iterdir():
        if folder.is_dir() and all((folder / file_name).exists() for file_name in MULO_REQUIRED_FILES):
            studies.append(folder.name)
    return sorted(studies)


def load_mulo_case_study(name: str) -> Dict[str, Any]:
    """Load a bundled Mulo case study from the inputs directory."""
    return load_case_study_content(name, run_by_mulo_designer=True, inputs_dir=MULO_INPUTS_DIR)


def get_mulo_default_objectives() -> Dict[str, str]:
    """Return default control objectives keyed by case-study name."""
    return DEFAULT_OBJECTIVES


def _create_designer(
    run_config: Dict[str, Any],
    controller_structure: List[Dict[str, Any]],
    system_identification: Dict[str, Any],
    trimming_result: Dict[str, Any],
    equation: str,
) -> MuloControllerDesigner:
    normalized_run_config = normalize_run_config(run_config)
    return MuloControllerDesigner(
        normalized_run_config,
        controller_structure,
        system_identification,
        trimming_result,
        equation,
    )


def _pid_gain_bounds(final_state: Dict[str, Any]) -> Dict[str, float]:
    if not final_state:
        return {"Kp": 50.0, "Ki": 50.0, "Kd": 50.0}
    try:
        kp_bound, ki_bound, kd_bound = get_pid_gain_bounds(final_state)
        return {"Kp": float(kp_bound), "Ki": float(ki_bound), "Kd": float(kd_bound)}
    except (KeyError, TypeError, ValueError):
        return {"Kp": 50.0, "Ki": 50.0, "Kd": 50.0}


def _serialize_designer_state(job_id: str) -> Dict[str, Any]:
    job = job_store.get(job_id)
    designer: MuloControllerDesigner = job.metadata["designer"]
    modified_code = job.metadata.get("modified_code", designer.equation)
    modified_controller_structure = job.metadata.get(
        "modified_controller_structure",
        designer.controller_structure,
    )

    kp, ki, kd = 0.0, 0.0, 0.0
    if designer.controller_designed and designer.controller_index > 0:
        kp, ki, kd = get_pid_gains(modified_controller_structure, designer.controller_index)

    loop_name = ""
    if designer.controller_structure:
        loop_name = controller_loop_name(designer.controller_structure, designer.controller_index)

    return {
        "job_id": job_id,
        "controller_index": designer.controller_index,
        "controller_designed": designer.controller_designed,
        "total_loops": len(designer.controller_structure),
        "loop_name": loop_name,
        "is_complete": designer.controller_index >= len(designer.controller_structure),
        "equation": designer.equation,
        "controller_structure": make_serializable(designer.controller_structure),
        "case_study": make_serializable(designer.case_study),
        "run_config": make_serializable(job.metadata.get("run_config", {})),
        "final_state": make_serializable(designer.final_state or {}),
        "modified_code": modified_code,
        "modified_controller_structure": make_serializable(modified_controller_structure),
        "pid_gains": {"Kp": kp, "Ki": ki, "Kd": kd},
        "pid_gain_bounds": _pid_gain_bounds(designer.final_state or {}),
    }


def _mulo_worker(job_id: str) -> None:
    job = job_store.get(job_id)
    designer: MuloControllerDesigner = job.metadata["designer"]
    plot_data = job.metadata["plot_data"]

    def _push(event: Dict[str, Any]) -> None:
        updates = apply_ga_event(plot_data, event)
        job.metadata["plot_data"] = plot_data
        job.metadata.update(updates)
        job.event_queue.put({"type": "ga_event", "content": make_serializable(event)})

    try:
        job.touch(JobStatus.RUNNING)
        register_callback(_push)
        final_state = designer.design_controller()
        job.metadata["final_state"] = make_serializable(final_state)
        job.metadata["modified_code"] = designer.equation
        job.metadata["modified_controller_structure"] = make_serializable(designer.controller_structure)
        job.event_queue.put({"type": "run_complete", "final_state": job.metadata["final_state"]})
        job.touch(JobStatus.COMPLETED)
        sync_project_from_job(
            project_id=job.metadata.get("project_id"),
            job_id=job_id,
            status="completed",
            results={
                "final_state": job.metadata["final_state"],
                "plot_data": make_serializable(job.metadata.get("plot_data", {})),
                "modified_code": job.metadata.get("modified_code"),
                "modified_controller_structure": job.metadata.get("modified_controller_structure"),
            },
        )
    except Exception as exc:
        job.error = str(exc)
        job.event_queue.put({"type": "run_error", "error": str(exc)})
        job.touch(JobStatus.FAILED)
        sync_project_from_job(
            project_id=job.metadata.get("project_id"),
            job_id=job_id,
            status="failed",
            error=str(exc),
        )
    finally:
        unregister_callback()


def _start_worker(job_id: str) -> None:
    job = job_store.get(job_id)
    thread = threading.Thread(target=_mulo_worker, args=(job_id,), daemon=True)
    job.thread = thread
    thread.start()


def init_mulo_designer(
    run_config: Dict[str, Any],
    controller_structure: List[Dict[str, Any]],
    system_identification: Dict[str, Any],
    trimming_result: Dict[str, Any],
    equation: str,
    user_id: int | None = None,
    project_id: int | None = None,
    file_name: str = "",
    file_type: str = "python",
) -> str:
    """Initialize the Mulo designer (LLM constraint estimation) without running GA."""
    normalized_run_config = normalize_run_config(run_config)
    designer = _create_designer(
        normalized_run_config,
        controller_structure,
        system_identification,
        trimming_result,
        equation,
    )
    job = job_store.create(
        "mulo",
        metadata={
            "designer": designer,
            "plot_data": empty_plot_data(),
            "run_config": normalized_run_config,
            "modified_code": designer.equation,
            "modified_controller_structure": copy.deepcopy(designer.controller_structure),
        },
        user_id=user_id,
    )
    from backend_api.http.services.analytics_service import record_module_use

    record_module_use(user_id, "mulo")
    case_name = str(normalized_run_config.get("case_study_file") or file_name or "mulo")
    linked_project_id = link_or_create_for_job(
        user_id=user_id,
        project_id=project_id,
        pipeline_type="muloDesign",
        job_id=job.id,
        file_name=file_name or case_name,
        file_type=file_type or "python",
        file_content=equation,
        title=case_name,
    )
    if linked_project_id is not None:
        job.metadata["project_id"] = linked_project_id
    job.touch(JobStatus.COMPLETED)
    sync_project_from_job(
        project_id=linked_project_id,
        job_id=job.id,
        status="running",
        results={
            "controller_structure": make_serializable(designer.controller_structure),
            "run_config": make_serializable(normalized_run_config),
        },
    )
    return job.id


def configure_mulo_job(
    job_id: str,
    case_study: Dict[str, Any],
    controller_structure: List[Dict[str, Any]],
) -> None:
    """Apply case-study edits before starting GA optimization."""
    job = job_store.get(job_id)
    designer: MuloControllerDesigner = job.metadata["designer"]
    if "fixed_targets" in case_study:
        case_study["fixed_targets"] = coerce_metric_targets(case_study.get("fixed_targets"))
    if "simulation_params" in case_study:
        case_study["simulation_params"] = coerce_simulation_params(case_study.get("simulation_params"))
    designer.set_case_study(case_study)
    designer.set_controller_structure(controller_structure)


def run_mulo_optimization(job_id: str) -> None:
    """Start GA optimization for the current cascade loop."""
    job = job_store.get(job_id)
    job.metadata["plot_data"] = empty_plot_data()
    job.metadata["final_state"] = None
    job.error = None
    job.cancel_requested = False
    job.touch(JobStatus.PENDING)
    sync_project_from_job(
        project_id=job.metadata.get("project_id"),
        job_id=job_id,
        status="running",
    )
    _start_worker(job_id)


def update_mulo_scratchpad(
    job_id: str,
    modified_code: str,
    modified_controller_structure: List[Dict[str, Any]],
) -> None:
    """Persist scratchpad edits from the performance tuning UI."""
    job = job_store.get(job_id)
    job.metadata["modified_code"] = modified_code
    job.metadata["modified_controller_structure"] = copy.deepcopy(modified_controller_structure)


def continue_mulo_loop(
    job_id: str,
    equation: str,
    controller_structure: List[Dict[str, Any]],
) -> None:
    """Continue cascade design on the next loop using scratchpad values."""
    job = job_store.get(job_id)
    designer: MuloControllerDesigner = job.metadata["designer"]
    designer.equation = equation
    designer.set_controller_structure(controller_structure)
    job.metadata["modified_code"] = equation
    job.metadata["modified_controller_structure"] = copy.deepcopy(controller_structure)
    run_mulo_optimization(job_id)


def start_mulo_job(
    run_config: Dict[str, Any],
    controller_structure: List[Dict[str, Any]],
    system_identification: Dict[str, Any],
    trimming_result: Dict[str, Any],
    equation: str,
    user_id: int | None = None,
    project_id: int | None = None,
    file_name: str = "",
    file_type: str = "python",
) -> str:
    """Legacy one-shot start: initialize designer and immediately run GA."""
    job_id = init_mulo_designer(
        run_config,
        controller_structure,
        system_identification,
        trimming_result,
        equation,
        user_id=user_id,
        project_id=project_id,
        file_name=file_name,
        file_type=file_type,
    )
    run_mulo_optimization(job_id)
    return job_id


def get_mulo_designer_state(job_id: str) -> Dict[str, Any]:
    return _serialize_designer_state(job_id)


def get_mulo_plot_data(job_id: str) -> Dict[str, Any]:
    job = job_store.get(job_id)
    return make_serializable(job.metadata.get("plot_data", {}))


def simulate_mulo_response(
    job_id: str,
    kp: float,
    ki: float,
    kd: float,
    signal_type: str,
    amplitude: float | None = None,
) -> Dict[str, Any]:
    """Simulate step/ramp/sine response with updated PID gains."""
    job = job_store.get(job_id)
    designer: MuloControllerDesigner = job.metadata["designer"]
    modified_controller_structure = copy.deepcopy(
        job.metadata.get("modified_controller_structure", designer.controller_structure),
    )
    modified_code = job.metadata.get("modified_code", designer.equation)

    apply_pid_gains_to_controller_structure(
        modified_controller_structure,
        designer.controller_index,
        kp,
        ki,
        kd,
    )
    code = replace_last_pid_controller_gains(modified_code, kp, ki, kd)

    cont_index = active_controller_index(designer.controller_index)
    controller = modified_controller_structure[cont_index]["controllers"][0]
    input_channel_name = controller["controlled_variable_in_equation"].capitalize()
    y_label = controller["controlled_variable"]
    unit = controller.get("target", {}).get("unit", "")
    sim_amplitude = (
        float(amplitude)
        if amplitude is not None
        else float(designer.generate_target(controller))
    )

    t_eval, trajectory, ref_signal = simulate_system_response(
        code,
        designer.case_study,
        input_channel_name,
        signal_type,
        amplitude=sim_amplitude,
    )

    import re

    match = re.search(r"\d+", input_channel_name)
    state_index = int(match.group()) if match else 0

    return {
        "signal_type": signal_type,
        "time": make_serializable(t_eval),
        "actual": make_serializable(trajectory[:, state_index]),
        "reference": make_serializable(ref_signal),
        "y_label": y_label,
        "unit": unit,
        "code": code,
        "amplitude": sim_amplitude,
    }
