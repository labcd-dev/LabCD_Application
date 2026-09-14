"""Celery tasks for AgentMPC tuning jobs."""

from __future__ import annotations

import logging
from typing import Any

from backend_api.celery_app import celery

log = logging.getLogger(__name__)


@celery.task(
    name="backend_api.tasks.mpc_tasks.run_mpc_tuning_task",
    bind=True,
    max_retries=1,
)
def run_mpc_tuning_task(self, job_id: str) -> dict[str, Any]:
    """Execute MPC tuning graph in a Celery worker process."""
    log.info("Starting MPC tuning task for job %s (Celery task ID: %s)", job_id, self.request.id)
    try:
        from backend_api.http.services.mpc_job_store import default_mpc_job_store
        from backend_api.http.services.mpc_service import _run_tuning_thread

        _run_tuning_thread(job_id, default_mpc_job_store)
        return {"job_id": job_id, "status": "completed"}
    except Exception as exc:
        log.exception("MPC tuning task failed for job %s: %s", job_id, exc)
        raise
