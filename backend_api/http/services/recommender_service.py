"""Recommender HTTP service adapter."""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional

from backend_api.Recommender.build_graph import build_graph, run_recommender_workflow
from backend_api.Recommender.pipeline_handoff import prepare_trimmer_handoff
from backend_api.Recommender.rag.completion import assess_rag_completion
from backend_api.common.serialization import make_serializable
from backend_api.http.services.job_store import JobStatus, job_store


class _JobEventQueue:
    """Queue adapter that serializes stream payloads for SSE clients."""

    def __init__(self, job: Any) -> None:
        self._job = job

    def put(self, item: Dict[str, Any]) -> None:
        payload = dict(item)
        if "content" in payload:
            payload["content"] = make_serializable(payload["content"])
        if "summary" in payload:
            payload["summary"] = make_serializable(payload["summary"])
        self._job.event_queue.put(payload)


def _recommender_worker(job_id: str, step: str, graph_input: Optional[Dict[str, Any]]) -> None:
    job = job_store.get(job_id)
    graph = job.metadata["graph"]
    config = job.metadata["graph_config"]
    event_queue = _JobEventQueue(job)

    try:
        job.touch(JobStatus.RUNNING)
        summary = run_recommender_workflow(graph, config, graph_input, event_queue)
        job.metadata["summary"] = make_serializable(summary)

        if summary.get("success"):
            job.event_queue.put({"type": "done", "step": step, "summary": make_serializable(summary)})
            job.touch(JobStatus.COMPLETED)
        else:
            error = summary.get("error") or summary.get("flag") or "Recommender failed"
            job.error = error
            job.event_queue.put(
                {"type": "error", "content": error, "summary": make_serializable(summary)},
            )
            job.touch(JobStatus.FAILED)
    except Exception as exc:
        job.error = str(exc)
        job.event_queue.put({"type": "error", "content": str(exc)})
        job.touch(JobStatus.FAILED)


def _start_worker(job: Any, step: str, graph_input: Optional[Dict[str, Any]]) -> None:
    thread = threading.Thread(
        target=_recommender_worker,
        args=(job.id, step, graph_input),
        daemon=True,
    )
    job.thread = thread
    thread.start()


def start_recommender_job(
    file_content: str,
    file_name: str,
    model: str,
    step: str = "initial_run",
    user_id: int | None = None,
    user_prompt: str = "",
) -> str:
    job = job_store.create(
        "recommender",
        metadata={
            "file_name": file_name,
            "file_content": file_content,
            "model": model,
            "step": step,
            "user_prompt": user_prompt or "",
            "graph": build_graph(model),
            "graph_config": {"configurable": {"thread_id": ""}},
            "logs": [{"agent_tag": "Equation", "log_history": file_content}],
        },
        user_id=user_id,
    )
    from backend_api.http.services.analytics_service import record_module_use

    record_module_use(user_id, "recommender")
    job.metadata["graph_config"] = {"configurable": {"thread_id": job.id}}

    graph_input = (
        {
            "equation": file_content,
            "file_name": file_name,
            "messages": [],
            "user_prompt": user_prompt or "",
        }
        if step == "initial_run"
        else None
    )
    _start_worker(job, step, graph_input)
    return job.id


def submit_rag_decision(job_id: str, flags: list[str], model: str) -> str:
    job = job_store.get(job_id)
    graph = job.metadata["graph"]
    config = job.metadata["graph_config"]
    graph.update_state(
        config,
        {"RAG_decision": {"Flag": flags, "Model": model}},
        as_node="human_review",
    )

    rag_job = job_store.create(
        "recommender",
        metadata={
            "file_name": job.metadata["file_name"],
            "file_content": job.metadata["file_content"],
            "model": job.metadata["model"],
            "user_prompt": job.metadata.get("user_prompt", ""),
            "step": "rag_run",
            "graph": graph,
            "graph_config": config,
            "parent_job_id": job_id,
            "logs": job.metadata.get("logs", []),
        },
        user_id=job.user_id,
    )
    _start_worker(rag_job, "rag_run", None)
    return rag_job.id


def get_recommender_state(job_id: str) -> Dict[str, Any]:
    job = job_store.get(job_id)
    graph = job.metadata["graph"]
    config = job.metadata["graph_config"]
    return make_serializable(graph.get_state(config).values)


def build_trimmer_handoff(job_id: str, chosen_controller: Optional[str] = None) -> Dict[str, Any]:
    state_snapshot = get_recommender_state(job_id)
    return prepare_trimmer_handoff(state_snapshot, chosen_controller)


def assess_rag(job_id: str) -> Dict[str, Optional[str]]:
    from backend_api.http.config import RESULTS_DIR

    job = job_store.get(job_id)
    state = get_recommender_state(job_id)
    controller_graph = state.get("controller_graph")
    controller_json = state.get("controller_json")
    return assess_rag_completion(
        job.metadata["file_name"],
        results_dir=RESULTS_DIR,
        controller_graph=controller_graph if isinstance(controller_graph, dict) else None,
        controller_json=controller_json if isinstance(controller_json, dict) else None,
    )
