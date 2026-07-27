"""SiloDesigner HTTP service adapter."""

from __future__ import annotations

import threading
from typing import Any, Dict

from backend_api.SiloDesigner.app import (
    DesignCancelledError,
    DesignMonitor,
    get_serializable_monitor_state,
    run_design_with_monitoring,
)
from backend_api.SiloDesigner.config import build_design_config
from backend_api.common.serialization import make_serializable
from backend_api.http.services.job_store import JobStatus, job_store
from backend_api.http.services.project_service import link_or_create_for_job, sync_project_from_job

MONITOR_PUBLISH_INTERVAL_SECONDS = 3.0


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
            results={"monitor_state": make_serializable(job.metadata["monitor_state"])},
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
            results={"monitor_state": make_serializable(job.metadata["monitor_state"])},
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
