"""Celery application instance and configuration for distributed task execution."""

from __future__ import annotations

import logging
import os

from celery import Celery

from backend_api.http.config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND

log = logging.getLogger(__name__)

celery = Celery(
    "labcd",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    result_expires=86400 * 7,  # 7 days
    worker_prefetch_multiplier=1,  # Fair task distribution for heavy compute tasks
    task_acks_late=True,  # Re-queue task if worker crashes
    broker_connection_retry_on_startup=True,
    task_default_queue="default",
    task_routes={
        "backend_api.tasks.mpc_tasks.*": {"queue": "compute"},
        "backend_api.tasks.adaptive_tasks.*": {"queue": "compute"},
        "backend_api.tasks.workflow_tasks.*": {"queue": "default"},
    },
)

# Auto-discover tasks in backend_api.tasks
celery.autodiscover_tasks(["backend_api.tasks"])
