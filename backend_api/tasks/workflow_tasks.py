"""Generic workflow tasks for Silo, Mulo, Trimmer, and report generation."""

from __future__ import annotations

import logging
from typing import Any

from backend_api.celery_app import celery

log = logging.getLogger(__name__)


@celery.task(
    name="backend_api.tasks.workflow_tasks.run_silo_design_task",
    bind=True,
    max_retries=1,
)
def run_silo_design_task(self, job_id: str) -> dict[str, Any]:
    """Execute Silo structural design workflow in a Celery worker process."""
    log.info("Starting Silo design task for job %s (Celery task ID: %s)", job_id, self.request.id)
    try:
        from backend_api.http.services.silo_service import _silo_worker

        _silo_worker(job_id)
        return {"job_id": job_id, "status": "completed"}
    except Exception as exc:
        log.exception("Silo design task failed for job %s: %s", job_id, exc)
        raise
