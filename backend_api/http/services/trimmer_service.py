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
            return

        final_state = summary.get("final_state") or job.metadata.get("final_values") or {}
        if final_state:
            job.metadata["final_values"] = final_state

        job.event_queue.put({"type": "done", "summary": job.metadata["summary"]})
        _finalize_job(job_id)
        job.touch(JobStatus.COMPLETED)
    except HumanInputRequired as exc:
        job.metadata["pending_request"] = exc.request
        job.event_queue.put({"type": "human_input", "content": exc.request})
        job.touch(JobStatus.WAITING_INPUT)
    except Exception as exc:
        job.error = str(exc)
        job.event_queue.put({"type": "error", "content": str(exc)})
        job.touch(JobStatus.FAILED)


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
) -> str:
    logger = _create_logger(file_name)
    initial_state = build_trimmer_initial_state(
        trimming_params,
        file_content,
        logger,
        ui_inputs={},
        ui_mode="api",
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
        ui_mode="api",
    )
    job.metadata["initial_state"] = initial_state

    thread = threading.Thread(target=_trimmer_worker, args=(job.id,), daemon=True)
    job.thread = thread
    thread.start()


def get_trimmer_artifacts(job_id: str) -> Dict[str, Any]:
    job = job_store.get(job_id)
    return job.metadata.get("artifacts", {})
