"""Trimmer HTTP service adapter."""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict

from backend_api.Trimmer.build_graph import build_workflow_graph, run_trimmer_workflow
from backend_api.Trimmer.services.human_input import HumanInputRequired, normalize_human_answer
from backend_api.Trimmer.workflow_helpers import build_trimmer_initial_state, finalize_trimmer_run
from backend_api.common.serialization import make_serializable
from backend_api.http.config import RESULTS_DIR
from backend_api.http.services.job_store import JobStatus, job_store
from backend_api.http.services.project_service import link_or_create_for_job, sync_project_from_job


def _trimmer_project_results(artifacts: Dict[str, Any]) -> Dict[str, Any]:
    """Build the persisted project.results payload from trimmer artifacts."""
    config = artifacts.get("config") or {}
    safe_config = {
        key: value for key, value in config.items() if key not in {"system_f", "system_f_code"}
    }
    payload: Dict[str, Any] = {
        "trimmer": {
            "result": artifacts.get("result") or {},
            "config": safe_config,
        },
        "safe_system_name": artifacts.get("safe_system_name") or "",
    }
    if artifacts.get("pdf_file"):
        payload["pdf_file"] = artifacts["pdf_file"]
    if artifacts.get("time_response_file"):
        payload["time_response_file"] = artifacts["time_response_file"]
    return make_serializable(payload)


def _create_logger(job_id: str) -> logging.Logger:
    log_dir = RESULTS_DIR.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(f"trimmer.{job_id}")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.FileHandler(log_dir / f"session_langraph_{job_id}.log")
        handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
        logger.addHandler(handler)
    return logger


class _JobEventQueue:
    """Queue adapter that serializes stream payloads for SSE clients."""

    def __init__(self, job: Any) -> None:
        self._job = job

    def put(self, item: Dict[str, Any]) -> None:
        payload = dict(item)
        if payload.get("type") == "stream":
            mode = payload.get("mode")
            # Keep raw values for finalize; serialize only the SSE payload.
            if mode == "values" and isinstance(payload.get("content"), dict):
                self._job.metadata["final_values"] = payload["content"]
            payload["content"] = make_serializable(payload.get("content"))
        elif "content" in payload:
            payload["content"] = make_serializable(payload["content"])
        if "summary" in payload:
            payload["summary"] = make_serializable(payload["summary"])
        self._job.event_queue.put(payload)


def _trimmer_worker(job_id: str) -> None:
    job = job_store.get(job_id)
    graph = job.metadata["graph"]
    initial_state = job.metadata["initial_state"]
    event_queue = _JobEventQueue(job)

    try:
        job.touch(JobStatus.RUNNING)
        # Match the previous production stream call (no checkpointer config).
        summary = run_trimmer_workflow(graph, initial_state, event_queue, config=None)
        job.metadata["summary"] = make_serializable(
            {key: value for key, value in summary.items() if key != "final_state"},
        )

        if summary.get("flag") == "human_input":
            job.metadata["pending_request"] = summary.get("pending_request")
            job.event_queue.put(
                {
                    "type": "human_input",
                    "content": summary.get("pending_request"),
                    "summary": job.metadata["summary"],
                },
            )
            job.touch(JobStatus.WAITING_INPUT)
            return

        if summary.get("error"):
            job.error = summary["error"]
            job.event_queue.put(
                {
                    "type": "error",
                    "content": summary["error"],
                    "summary": job.metadata["summary"],
                },
            )
            job.touch(JobStatus.FAILED)
            sync_project_from_job(
                project_id=job.metadata.get("project_id"),
                job_id=job_id,
                status="failed",
                error=summary["error"],
            )
            return

        final_state = summary.get("final_state") or job.metadata.get("final_values") or {}
        if final_state:
            job.metadata["final_values"] = final_state

        # Finalize artifacts before signaling done so clients that fetch
        # /artifacts on SSE "done" never race an empty payload.
        _finalize_job(job_id)
        job.touch(JobStatus.COMPLETED)
        artifacts = job.metadata.get("artifacts") or {}
        sync_project_from_job(
            project_id=job.metadata.get("project_id"),
            job_id=job_id,
            status="completed",
            results=_trimmer_project_results(artifacts),
        )
        job.event_queue.put({"type": "done", "summary": job.metadata["summary"]})
    except HumanInputRequired as exc:
        job.metadata["pending_request"] = exc.request
        job.event_queue.put({"type": "human_input", "content": exc.request})
        job.touch(JobStatus.WAITING_INPUT)
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


def _finalize_job(job_id: str) -> None:
    job = job_store.get(job_id)
    final_values = job.metadata.get("final_values", {})
    if not final_values:
        job.metadata["artifacts"] = {
            "result": {},
            "config": {},
            "pdf_file": None,
            "safe_system_name": job.metadata.get("file_name", ""),
            "output_dir": str(RESULTS_DIR),
        }
        return
    artifacts = finalize_trimmer_run(final_values, job.metadata["file_name"], str(RESULTS_DIR))
    job.metadata["artifacts"] = make_serializable(artifacts)


def start_trimmer_job(
    file_content: str,
    file_name: str,
    model: str,
    trimming_params: Dict[str, Any],
    user_id: int | None = None,
    project_id: int | None = None,
) -> str:
    logger = _create_logger(file_name)
    initial_state = build_trimmer_initial_state(
        trimming_params,
        file_content,
        logger,
        ui_inputs={},
        # React API uses the same ui_inputs / HumanInputRequired path as Streamlit.
        ui_mode="streamlit",
    )
    job = job_store.create(
        "trimmer",
        metadata={
            "file_name": file_name,
            "file_content": file_content,
            "model": model,
            "trimming_params": trimming_params,
            "graph": build_workflow_graph(model),
            "initial_state": initial_state,
            "ui_inputs": {},
            "logs": [],
        },
        user_id=user_id,
    )
    linked_project_id = link_or_create_for_job(
        user_id=user_id,
        project_id=project_id,
        pipeline_type="muloDesign",
        job_id=job.id,
        file_name=file_name or "",
        file_type="python",
        file_content=file_content or "",
        title=file_name or None,
    )
    if linked_project_id is not None:
        job.metadata["project_id"] = linked_project_id
    thread = threading.Thread(target=_trimmer_worker, args=(job.id,), daemon=True)
    job.thread = thread
    thread.start()
    return job.id


def submit_trimmer_input(job_id: str, key: str, prompt: str, answer: str) -> None:
    job = job_store.get(job_id)
    ui_inputs = job.metadata.setdefault("ui_inputs", {})
    ui_inputs[key] = normalize_human_answer(prompt, answer)
    job.metadata["pending_request"] = None

    initial_state = build_trimmer_initial_state(
        job.metadata["trimming_params"],
        job.metadata["file_content"],
        _create_logger(job_id),
        ui_inputs=ui_inputs,
        # React API uses the same ui_inputs / HumanInputRequired path as Streamlit.
        ui_mode="streamlit",
    )
    job.metadata["initial_state"] = initial_state

    thread = threading.Thread(target=_trimmer_worker, args=(job.id,), daemon=True)
    job.thread = thread
    thread.start()


def get_trimmer_artifacts(job_id: str) -> Dict[str, Any]:
    job = job_store.get(job_id)
    artifacts = job.metadata.get("artifacts") or {}
    result = artifacts.get("result") if isinstance(artifacts, dict) else None
    if not result and job.metadata.get("final_values"):
        _finalize_job(job_id)
        artifacts = job.metadata.get("artifacts") or {}
    return artifacts


def _compile_system_f(system_f_code: str):
    """Compile system_f from stored source code."""
    if not system_f_code or "def system_f" not in system_f_code:
        return None
    namespace: Dict[str, Any] = {"np": __import__("numpy")}
    exec(system_f_code, namespace)
    system_f = namespace.get("system_f")
    return system_f if callable(system_f) else None


def _resolve_system_f(job: Any, config: Dict[str, Any]):
    """Prefer live callable from final_values; fall back to recompiling system_f_code."""
    final_values = job.metadata.get("final_values") or {}
    live_config = final_values.get("config") if isinstance(final_values, dict) else {}
    if isinstance(live_config, dict):
        live_fn = live_config.get("system_f")
        if callable(live_fn):
            return live_fn

    system_f_code = config.get("system_f_code") or ""
    if isinstance(live_config, dict) and not system_f_code:
        system_f_code = live_config.get("system_f_code") or ""
    return _compile_system_f(system_f_code)


def generate_trimmer_time_response(job_id: str) -> Dict[str, Any]:
    """Generate a time-response plot for a completed trimmer job."""
    import os

    import matplotlib

    matplotlib.use("Agg")
    import numpy as np

    from backend_api.Trimmer.functionalNodes.create_controller_graph import Plotter

    job = job_store.get(job_id)
    artifacts = get_trimmer_artifacts(job_id)
    result = artifacts.get("result") or {}
    config = artifacts.get("config") or {}
    equilibrium = result.get("equilibrium") or {}

    x_e_raw = equilibrium.get("x_e")
    u_e_raw = equilibrium.get("u_e")
    if x_e_raw is None or u_e_raw is None:
        raise ValueError("Equilibrium results are missing. Re-run Trimmer before generating a time response.")

    system_f = _resolve_system_f(job, config)
    if system_f is None:
        raise ValueError("System dynamics are unavailable. Re-run Trimmer before generating a time response.")

    params = config.get("params") or {}
    state_vars = config.get("state_vars") or []
    if not state_vars:
        final_values = job.metadata.get("final_values") or {}
        live_config = final_values.get("config") if isinstance(final_values, dict) else {}
        if isinstance(live_config, dict):
            state_vars = live_config.get("state_vars") or []
            if not params:
                params = live_config.get("params") or {}

    x_e = np.asarray(x_e_raw, dtype=float).reshape(-1)
    u_e = np.asarray(u_e_raw, dtype=float).reshape(-1)
    if not state_vars:
        state_vars = [f"x[{i}]" for i in range(len(x_e))]

    file_name = artifacts.get("safe_system_name") or job.metadata.get("file_name") or "trimmer"
    plot_filename = f"{file_name}_response_langraph.png"
    output_dir = artifacts.get("output_dir") or str(RESULTS_DIR)
    os.makedirs(output_dir, exist_ok=True)
    plot_path = os.path.join(output_dir, plot_filename)

    plotter = Plotter(system_f, params, x_e, u_e)
    x0 = x_e + 0.01 * np.random.randn(len(x_e))
    plotter.plot_time_response(np.linspace(0, 50, 1000), x0, state_vars, save_path=plot_path)

    artifacts = dict(artifacts)
    artifacts["time_response_file"] = plot_filename
    job.metadata["artifacts"] = artifacts

    return {
        "filename": plot_filename,
        "message": "Time response plot generated.",
    }


def generate_trimmer_pdf(job_id: str) -> Dict[str, Any]:
    """Generate an academic PDF report for a completed trimmer job."""
    import os

    from backend_api.Trimmer.pdf_generator import generate_pdf_report

    job = job_store.get(job_id)
    artifacts = get_trimmer_artifacts(job_id)
    result = artifacts.get("result") or {}
    config = artifacts.get("config") or {}
    equilibrium = result.get("equilibrium") or {}

    if equilibrium.get("x_e") is None:
        raise ValueError("Equilibrium results are missing. Re-run Trimmer before generating a PDF.")

    output_dir = artifacts.get("output_dir") or str(RESULTS_DIR)
    os.makedirs(output_dir, exist_ok=True)

    file_name = artifacts.get("safe_system_name") or job.metadata.get("file_name") or "trimmer"
    pdf_filename = f"{file_name}_report.pdf"
    pdf_path = os.path.join(output_dir, pdf_filename)

    response_graph = None
    time_response_file = artifacts.get("time_response_file")
    if time_response_file:
        candidate = os.path.join(output_dir, time_response_file)
        if os.path.exists(candidate):
            response_graph = candidate

    serializable_result = make_serializable(result)
    serializable_config = make_serializable(
        {key: value for key, value in config.items() if key != "system_f"},
    )
    if "system_name" not in serializable_config:
        serializable_config["system_name"] = (
            (result.get("system") or {}).get("name") or file_name
        )

    generate_pdf_report(
        serializable_result,
        serializable_config,
        {},
        response_graph,
        pdf_path,
        {},
    )

    artifacts = dict(artifacts)
    artifacts["pdf_file"] = pdf_filename
    job.metadata["artifacts"] = artifacts

    # Keep project completed; refresh results so the PDF is downloadable from the view page.
    sync_project_from_job(
        project_id=job.metadata.get("project_id"),
        job_id=job_id,
        status="completed",
        results=_trimmer_project_results(artifacts),
    )

    return {
        "filename": pdf_filename,
        "message": "PDF report generated.",
    }
