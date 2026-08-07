"""SiloDesigner HTTP service adapter."""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional

import numpy as np

from backend_api.SiloDesigner.app import (
    DesignCancelledError,
    DesignMonitor,
    get_serializable_monitor_state,
    run_design_with_monitoring,
)
from backend_api.SiloDesigner.config import build_design_config, get_default_param_ranges
from backend_api.SiloDesigner.src.controllers import initialize_state
from backend_api.common.serialization import make_serializable
from backend_api.http.services.job_store import JobStatus, job_store
from backend_api.http.services.project_service import link_or_create_for_job, sync_project_from_job

MONITOR_PUBLISH_INTERVAL_SECONDS = 3.0

_INIT_EXCLUDED_KEYS = frozenset({"enable_ga", "ga_config", "file_name", "monitor"})
_DEFAULT_SCENARIO = {
    "initial_condition_range": (-1.0, 1.0),
    "randomness_level": 0.0,
    "disturbance_level": 0.0,
}


def _file_type_label(file_type: str | None) -> str:
    raw = (file_type or "").lower()
    if "matlab" in raw or raw.endswith(".m") or raw == "matlab":
        return "matlab"
    return "python"


def _file_name_from_config(config: Dict[str, Any]) -> str:
    for key in ("file_name", "system_name", "custom_dynamics_path"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().split("/")[-1].split("\\")[-1]
    return "dynamics.py"


def _monitor_publisher(job_id: str, monitor: DesignMonitor, stop_event: threading.Event) -> None:
    """Push monitor snapshots to the SSE queue while the design job is running."""
    last_published_revision = -1
    last_progress_count = 0
    last_llm_count = 0

    while not stop_event.wait(MONITOR_PUBLISH_INTERVAL_SECONDS):
        try:
            job = job_store.get(job_id)
            if job.status in {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}:
                break

            progress_history = monitor.progress_history
            progress_changed = len(progress_history) != last_progress_count
            revision_changed = monitor.revision != last_published_revision
            llm_responses = monitor.llm_responses
            llm_changed = len(llm_responses) != last_llm_count

            if progress_changed:
                new_entries = progress_history[last_progress_count:]
                for entry in new_entries:
                    timestamp = entry.get("timestamp", "")
                    message = entry.get("message", "")
                    job.event_queue.put(
                        {
                            "type": "stream",
                            "content": {
                                "agent_tag": "SiloDesigner",
                                "log_history": f"[{timestamp}] {message}",
                            },
                        }
                    )

                latest_message = (
                    progress_history[-1].get("message", "Running single-loop design...")
                    if progress_history
                    else "Running single-loop design..."
                )
                job.event_queue.put(
                    {
                        "type": "stream",
                        "content": {
                            "text": latest_message,
                            "progress": min(len(progress_history) * 5, 95) / 100.0,
                        },
                    }
                )
                last_progress_count = len(progress_history)

            if llm_changed:
                for entry in llm_responses[last_llm_count:]:
                    job.event_queue.put(
                        {
                            "type": "stream",
                            "content": {
                                "agent_tag": entry.get("agent", "LLM Agent"),
                                "log_history": entry.get("response", ""),
                            },
                        }
                    )
                last_llm_count = len(llm_responses)

            if revision_changed:
                state = get_serializable_monitor_state(monitor)
                job.event_queue.put({"type": "monitor", "content": state})
                last_published_revision = monitor.revision
        except KeyError:
            break


def _silo_worker(job_id: str) -> None:
    job = job_store.get(job_id)
    config = job.metadata["config"]
    monitor = job.metadata["monitor"]
    stop_event = threading.Event()
    publisher = threading.Thread(
        target=_monitor_publisher,
        args=(job_id, monitor, stop_event),
        daemon=True,
    )
    publisher.start()

    try:
        job.touch(JobStatus.RUNNING)
        run_design_with_monitoring(config, monitor)
        job.metadata["monitor_state"] = get_serializable_monitor_state(monitor)
        job.event_queue.put({"type": "monitor", "content": job.metadata["monitor_state"]})
        job.touch(JobStatus.COMPLETED)
        sync_project_from_job(
            project_id=job.metadata.get("project_id"),
            job_id=job_id,
            status="completed",
            results=_silo_project_results(job),
        )
    except DesignCancelledError:
        job.metadata["monitor_state"] = get_serializable_monitor_state(monitor)
        job.event_queue.put({"type": "monitor", "content": job.metadata["monitor_state"]})
        job.error = "Design cancelled by user"
        job.touch(JobStatus.CANCELLED)
        sync_project_from_job(
            project_id=job.metadata.get("project_id"),
            job_id=job_id,
            status="cancelled",
            results=_silo_project_results(job),
            error=job.error,
        )
    except Exception as exc:
        job.error = str(exc)
        job.event_queue.put({"type": "error", "content": str(exc)})
        job.touch(JobStatus.FAILED)
        sync_project_from_job(
            project_id=job.metadata.get("project_id"),
            job_id=job_id,
            status="failed",
            error=str(exc),
        )
    finally:
        stop_event.set()
        publisher.join(timeout=1.0)


def start_silo_job(
    config: Dict[str, Any],
    control_objective: str = "",
    user_id: int | None = None,
    project_id: int | None = None,
) -> str:
    runtime_config = build_design_config(
        config,
        control_objective=control_objective,
        file_content=config.get("file_content"),
        custom_dynamics_path=config.get("custom_dynamics_path"),
        file_type=config.get("file_type", "Python (.py)"),
    )
    # Uploaded dynamics are always Python after conversion; never persist as matlab for silo runs.
    if runtime_config.get("file_content"):
        runtime_config["file_type"] = "Python (.py)"
    file_name = config.get("file_name")
    if isinstance(file_name, str) and file_name.strip():
        runtime_config["file_name"] = file_name.strip()
    monitor = DesignMonitor()
    job = job_store.create(
        "silo",
        metadata={
            "config": runtime_config,
            "monitor": monitor,
        },
        user_id=user_id,
    )
    from backend_api.http.services.analytics_service import record_module_use

    record_module_use(user_id, "silo")
    linked_project_id = link_or_create_for_job(
        user_id=user_id,
        project_id=project_id,
        pipeline_type="siloDesign",
        job_id=job.id,
        file_name=_file_name_from_config(config),
        file_type="python" if runtime_config.get("file_content") else _file_type_label(str(config.get("file_type", "python"))),
        file_content=str(config.get("file_content") or ""),
        control_objective=control_objective or None,
        title=control_objective or None,
    )
    if linked_project_id is not None:
        job.metadata["project_id"] = linked_project_id
    thread = threading.Thread(target=_silo_worker, args=(job.id,), daemon=True)
    job.thread = thread
    thread.start()
    return job.id


def get_silo_monitor_state(job_id: str) -> Dict[str, Any]:
    job = job_store.get(job_id)
    monitor = job.metadata["monitor"]
    return make_serializable(get_serializable_monitor_state(monitor))


def _silo_project_results(job) -> Dict[str, Any]:
    """Persist monitor snapshot plus design config for later manual re-simulation."""
    return {
        "monitor_state": make_serializable(job.metadata.get("monitor_state")),
        "design_config": make_serializable(job.metadata.get("config")),
    }


def _numeric_gains(params: Any) -> Dict[str, float]:
    if not isinstance(params, dict):
        return {}
    gains: Dict[str, float] = {}
    for key, value in params.items():
        if key == "reasoning":
            continue
        try:
            gains[str(key)] = float(value)
        except (TypeError, ValueError):
            continue
    return gains


def _controller_type_from_state(state: Dict[str, Any]) -> str:
    explicit = state.get("controller_type")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    controllers = state.get("controllers_list") or []
    index = state.get("current_controller_index", 0)
    if isinstance(controllers, list) and isinstance(index, int):
        if 0 <= index < len(controllers) and isinstance(controllers[index], str):
            return controllers[index]
    return "PID"


def _resolve_param_bounds(
    system: Any,
    controller_type: str,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, list[float]]:
    """Match Streamlit Time Response slider range priority."""
    if system is not None and hasattr(system, "get_control_param_schema"):
        try:
            schema = system.get_control_param_schema(controller_type)
            if isinstance(schema, dict) and schema:
                return {
                    str(key): [float(info["min"]), float(info["max"])]
                    for key, info in schema.items()
                    if isinstance(info, dict) and "min" in info and "max" in info
                }
        except Exception:
            pass

    config_ranges = (config or {}).get("param_ranges")
    if isinstance(config_ranges, dict):
        typed = config_ranges.get(controller_type)
        if isinstance(typed, dict) and typed:
            bounds: Dict[str, list[float]] = {}
            for key, value in typed.items():
                if isinstance(value, (list, tuple)) and len(value) >= 2:
                    bounds[str(key)] = [float(value[0]), float(value[1])]
            if bounds:
                return bounds

    defaults = get_default_param_ranges(controller_type, system)
    if defaults:
        return {str(k): [float(v[0]), float(v[1])] for k, v in defaults.items()}
    return {}


def _build_runtime_state(config: Dict[str, Any]) -> Dict[str, Any]:
    filtered = {k: v for k, v in config.items() if k not in _INIT_EXCLUDED_KEYS}
    init_kwargs = {
        **filtered,
        "dt": filtered.get("dt", 0.01),
        "max_time": filtered.get("max_time", 5.0),
        "target": filtered.get("target", 0.0),
        "num_inputs": filtered.get("num_inputs", 1),
        "input_channel": filtered.get("input_channel", 0),
        "output_channel": filtered.get("output_channel", 0),
        "trim_values": filtered.get("trim_values"),
        "num_states": filtered.get("num_states"),
        "matlab_func_name": filtered.get("matlab_func_name"),
        "min_ctrl": filtered.get("min_ctrl", -10.0),
        "max_ctrl": filtered.get("max_ctrl", 10.0),
        "monitor": None,
    }
    return initialize_state(**init_kwargs)


def _resolve_simulator(
    config: Dict[str, Any],
    monitor: DesignMonitor | None,
) -> tuple[Any, Any, Dict[str, Any]]:
    """Prefer live monitor simulator; otherwise rebuild from design config."""
    live_state: Dict[str, Any] = {}
    if monitor is not None and isinstance(monitor.current_state, dict):
        live_state = monitor.current_state
        simulator = live_state.get("simulator")
        system = live_state.get("system")
        if simulator is not None:
            if getattr(simulator, "system", None) is None and system is not None:
                simulator.system = system
            if getattr(simulator, "system", None) is not None:
                return simulator, simulator.system, live_state

    rebuilt = _build_runtime_state(config)
    return rebuilt["simulator"], rebuilt["system"], {**live_state, **rebuilt}


def _fixed_initial_state(system: Any) -> np.ndarray:
    initial_state = np.zeros(system.num_states)
    ic_min, ic_max = system.initial_condition_range
    initial_state[system.output_channel] = (float(ic_min) + float(ic_max)) / 2.0
    return initial_state


def _serialize_sim_result(result: Dict[str, Any]) -> Dict[str, Any]:
    if not result.get("success"):
        raise ValueError(result.get("error") or "Simulation failed")
    return {
        "metrics": make_serializable(result.get("metrics", {})),
        "trajectory": make_serializable(result.get("trajectory")),
        "control_signals": make_serializable(result.get("control_signals")),
        "errors": make_serializable(result.get("errors")),
    }


def _run_manual_simulation(
    *,
    config: Dict[str, Any],
    monitor: DesignMonitor | None,
    monitor_state: Optional[Dict[str, Any]],
    gains: Dict[str, float],
    scenario: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    simulator, system, live_state = _resolve_simulator(config, monitor)

    serialized_current = {}
    if isinstance(monitor_state, dict):
        serialized_current = monitor_state.get("current_state") or {}
        if not isinstance(serialized_current, dict):
            serialized_current = {}

    controller_type = _controller_type_from_state(live_state) or _controller_type_from_state(
        serialized_current
    )
    optimal_gains = _numeric_gains(live_state.get("current_params"))
    if not optimal_gains:
        optimal_gains = _numeric_gains(serialized_current.get("current_params"))
    if not optimal_gains:
        raise ValueError("No optimal controller gains available yet")

    manual_gains = _numeric_gains(gains) if gains else dict(optimal_gains)
    if not manual_gains:
        manual_gains = dict(optimal_gains)

    selected_scenario = scenario if isinstance(scenario, dict) and scenario else _DEFAULT_SCENARIO
    simulator.set_scenario(selected_scenario)
    system = simulator.system
    if system is None:
        raise ValueError("Simulator system is not initialized")

    initial_state = _fixed_initial_state(system)
    optimal_result = simulator.evaluate_parameters(optimal_gains, initial_state=initial_state)
    optimal_payload = _serialize_sim_result(optimal_result)

    manual_payload = None
    if manual_gains != optimal_gains:
        manual_result = simulator.evaluate_parameters(manual_gains, initial_state=initial_state)
        manual_payload = _serialize_sim_result(manual_result)

    dt = float(getattr(system, "dt", config.get("dt", 0.01)) or 0.01)
    max_time = float(getattr(system, "max_time", config.get("max_time", 5.0)) or 5.0)
    target = float(getattr(system, "target", config.get("target", 0.0)) or 0.0)
    traj_len = len(optimal_payload.get("trajectory") or [])
    expected_steps = int(max_time / dt) + 1
    time_points = (np.arange(0, max_time + dt, dt)[:expected_steps])[:traj_len].tolist()

    param_bounds = _resolve_param_bounds(system, controller_type, config)
    for key in set(optimal_gains) | set(manual_gains):
        param_bounds.setdefault(key, [0.0, 100.0])

    return {
        "controller_type": controller_type,
        "optimal_gains": optimal_gains,
        "manual_gains": manual_gains,
        "param_bounds": param_bounds,
        "target": target,
        "dt": dt,
        "max_time": max_time,
        "time": time_points,
        "optimal": optimal_payload,
        "manual": manual_payload,
    }


def simulate_silo_response(
    job_id: str,
    gains: Dict[str, float],
    scenario: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Re-simulate closed-loop response with manual gains (Streamlit parity)."""
    job = job_store.get(job_id)
    config = job.metadata.get("config")
    if not isinstance(config, dict):
        raise ValueError("Design configuration is missing for this job")
    monitor = job.metadata.get("monitor")
    monitor_state = job.metadata.get("monitor_state")
    if monitor_state is None and isinstance(monitor, DesignMonitor):
        monitor_state = get_serializable_monitor_state(monitor)
    return _run_manual_simulation(
        config=config,
        monitor=monitor if isinstance(monitor, DesignMonitor) else None,
        monitor_state=monitor_state if isinstance(monitor_state, dict) else None,
        gains=gains,
        scenario=scenario,
    )


def simulate_silo_project_response(
    *,
    design_config: Dict[str, Any] | None,
    monitor_state: Optional[Dict[str, Any]],
    file_content: str = "",
    gains: Dict[str, float],
    scenario: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Re-simulate from persisted project design_config + monitor snapshot."""
    config: Dict[str, Any] = dict(design_config) if isinstance(design_config, dict) else {}
    serialized_current: Dict[str, Any] = {}
    if isinstance(monitor_state, dict):
        raw_current = monitor_state.get("current_state")
        if isinstance(raw_current, dict):
            serialized_current = raw_current

    if not config:
        if not file_content and not serialized_current:
            raise ValueError(
                "Saved design configuration is missing; re-run the design to enable gain simulation"
            )
        config = {
            "system_name": "custom" if file_content else "ball_beam",
            "dt": serialized_current.get("dt", 0.01),
            "max_time": serialized_current.get("max_time", 5.0),
            "target": serialized_current.get("target", 0.0),
            "num_inputs": serialized_current.get("num_inputs", 1),
            "input_channel": serialized_current.get("input_channel", 0),
            "output_channel": serialized_current.get("output_channel", 0),
            "min_ctrl": serialized_current.get("min_ctrl", -10.0),
            "max_ctrl": serialized_current.get("max_ctrl", 10.0),
            "controllers": serialized_current.get("controllers_list")
            or ["PID", "FSF"],
        }

    if file_content and not config.get("file_content"):
        config["file_content"] = file_content
        config["system_name"] = config.get("system_name") or "custom"
        if config.get("file_content"):
            config["file_type"] = "Python (.py)"
    return _run_manual_simulation(
        config=config,
        monitor=None,
        monitor_state=monitor_state,
        gains=gains,
        scenario=scenario,
    )
