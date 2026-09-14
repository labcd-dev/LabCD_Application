"""Celery tasks for AgentAdaptive workflow jobs."""

from __future__ import annotations

import logging
from typing import Any

from backend_api.celery_app import celery

log = logging.getLogger(__name__)


@celery.task(
    name="backend_api.tasks.adaptive_tasks.run_adaptive_pipeline_task",
    bind=True,
    max_retries=1,
)
def run_adaptive_pipeline_task(self, job_id: str) -> dict[str, Any]:
    """Execute AgentAdaptive design and tuning pipeline in a Celery worker process."""
    log.info("Starting Adaptive pipeline task for job %s (Celery task ID: %s)", job_id, self.request.id)
    try:
        from backend_api.http.services.adaptive_job_store import default_adaptive_job_store
        from backend_api.http.services.adaptive_service import _run_pipeline_thread

        _run_pipeline_thread(job_id, default_adaptive_job_store)
        return {"job_id": job_id, "status": "completed"}
    except Exception as exc:
        log.exception("Adaptive pipeline task failed for job %s: %s", job_id, exc)
        raise
