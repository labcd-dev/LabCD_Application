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


def _trimmer_project_results(
    artifacts: Dict[str, Any],
    *,
    trimmer_summary: Dict[str, Any] | None = None,
    recommender_summary: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
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
    if trimmer_summary:
        payload["trimmer_summary"] = make_serializable(trimmer_summary)
    if recommender_summary:
        payload["recommender_summary"] = make_serializable(recommender_summary)
    return make_serializable(payload)


def _resolve_recommender_summary(job: Any) -> Dict[str, Any] | None:
    cached = job.metadata.get("recommender_summary")
    if isinstance(cached, dict):
        return cached

    recommender_job_id = job.metadata.get("recommender_job_id")
    if not recommender_job_id:
        return None
    try:
        recommender_job = job_store.get(recommender_job_id)
    except KeyError:
        return None
    summary = recommender_job.metadata.get("summary")
    return summary if isinstance(summary, dict) else None


def _snapshot_recommender_summary(recommender_job_id: str | None) -> Dict[str, Any] | None:
    if not recommender_job_id:
        return None
    try:
        recommender_job = job_store.get(recommender_job_id)
    except KeyError:
        return None
    summary = recommender_job.metadata.get("summary")
    return make_serializable(summary) if isinstance(summary, dict) else None


def _project_results_with_summaries(
    job: Any,
    artifacts: Dict[str, Any],
    *,
    error: str | None = None,
) -> Dict[str, Any]:
    trimmer_summary = job.metadata.get("summary")
    if not isinstance(trimmer_summary, dict):
        trimmer_summary = None
    payload = _trimmer_project_results(
        artifacts,
        trimmer_summary=trimmer_summary,
        recommender_summary=_resolve_recommender_summary(job),
    )
    if error:
        payload["error"] = error
    return payload


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
                results=_project_results_with_summaries(
                    job,
                    job.metadata.get("artifacts") or {},
                    error=summary["error"],
                ),
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
            results=_project_results_with_summaries(job, artifacts),
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
            results=_project_results_with_summaries(
                job,
                job.metadata.get("artifacts") or {},
                error=str(exc),
            ),
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
    recommender_job_id: str | None = None,
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
    metadata: Dict[str, Any] = {
        "file_name": file_name,
        "file_content": file_content,
        "model": model,
        "trimming_params": trimming_params,
        "graph": build_workflow_graph(model),
        "initial_state": initial_state,
        "ui_inputs": {},
        "logs": [],
    }
    if recommender_job_id:
        metadata["recommender_job_id"] = recommender_job_id
        recommender_summary = _snapshot_recommender_summary(recommender_job_id)
        if recommender_summary is not None:
            metadata["recommender_summary"] = recommender_summary
    job = job_store.create(
        "trimmer",
        metadata=metadata,
        user_id=user_id,
    )
    from backend_api.http.services.analytics_service import record_module_use

    record_module_use(user_id, "trimmer")
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


def _discover_controller_graphs(file_name: str, results_dir) -> Dict[str, str]:
    """Find controller architecture PNGs saved by the Recommender graph node."""
    from pathlib import Path

    graphs: Dict[str, str] = {}
    results_path = Path(results_dir)
    if not results_path.is_dir():
        return graphs

    prefix = f"{file_name}_controller_graph_"
    for path in results_path.iterdir():
        if not path.is_file():
            continue
        if not path.name.startswith(prefix) or path.suffix.lower() != ".png":
            continue
        process = path.stem[len(prefix) :]
        graphs[f"{process}_controller"] = str(path)
    return graphs


def _resolve_pdf_recommender_context(
    job: Any,
    file_name: str,
    output_dir: str,
    recommender_job_id: str | None = None,
) -> Dict[str, Any]:
    """Load controller graphs / JSON / system ID from Recommender (Streamlit parity)."""
    import json

    controller_graph: Dict[str, str] = {}
    controller_json: Dict[str, Any] | None = None
    system_identification: Any = None

    resolved_id = recommender_job_id or job.metadata.get("recommender_job_id")
    if resolved_id:
        try:
            from backend_api.http.services.recommender_service import get_recommender_state

            state = get_recommender_state(resolved_id)
            raw_graphs = state.get("controller_graph") or {}
            if isinstance(raw_graphs, dict):
                controller_graph = {
                    str(title): str(path)
                    for title, path in raw_graphs.items()
                    if path
                }
            raw_json = state.get("controller_json")
            if isinstance(raw_json, dict):
                controller_json = raw_json
            system_identification = state.get("system_identification")
            if isinstance(system_identification, str):
                try:
                    system_identification = json.loads(system_identification)
                except json.JSONDecodeError:
                    pass
        except Exception as exc:
            logging.getLogger(__name__).warning(
                "Could not load recommender state for PDF (%s): %s",
                resolved_id,
                exc,
            )

    if not controller_graph:
        # Prefer the original upload name used by Recommender when saving PNGs.
        for candidate_name in (
            job.metadata.get("file_name"),
            file_name,
        ):
            if not candidate_name:
                continue
            controller_graph = _discover_controller_graphs(str(candidate_name), output_dir)
            if controller_graph:
                break
            if str(RESULTS_DIR) != output_dir:
                controller_graph = _discover_controller_graphs(str(candidate_name), RESULTS_DIR)
                if controller_graph:
                    break

    return {
        "controller_graph": controller_graph,
        "controller_json": controller_json,
        "system_identification": system_identification,
    }


def generate_trimmer_pdf(
    job_id: str,
    recommender_job_id: str | None = None,
) -> Dict[str, Any]:
    """Generate an academic PDF report for a completed trimmer job."""
    import os

    from backend_api.Trimmer.agenticNodes.agents import Agents
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

    # Match Streamlit: include Recommender architecture schematics + LLM narratives
    # so sections 7 (Cascaded Control Architecture) and 8 (Concluding Remarks) appear.
    rec_ctx = _resolve_pdf_recommender_context(
        job,
        file_name,
        output_dir,
        recommender_job_id=recommender_job_id,
    )
    if recommender_job_id:
        job.metadata["recommender_job_id"] = recommender_job_id

    narratives: Dict[str, Any] = {}
    try:
        narratives_agent = Agents(model_name=job.metadata.get("model") or "gpt-oss-120b")
        narratives = narratives_agent.generate_narratives(
            serializable_result,
            serializable_config,
            rec_ctx.get("system_identification"),
            rec_ctx.get("controller_json"),
        ) or {}
    except Exception as exc:
        logging.getLogger(__name__).warning("PDF narrative generation failed: %s", exc)

    generate_pdf_report(
        serializable_result,
        serializable_config,
        rec_ctx.get("controller_graph") or {},
        response_graph,
        pdf_path,
        narratives,
    )

    artifacts = dict(artifacts)
    artifacts["pdf_file"] = pdf_filename
    job.metadata["artifacts"] = artifacts

    # Keep project completed; refresh results so the PDF is downloadable from the view page.
    sync_project_from_job(
        project_id=job.metadata.get("project_id"),
        job_id=job_id,
        status="completed",
        results=_project_results_with_summaries(job, artifacts),
    )

    return {
        "filename": pdf_filename,
        "message": "PDF report generated.",
    }
