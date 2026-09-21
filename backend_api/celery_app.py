"""Celery application instance and configuration for distributed task execution."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Ensure project root (/app) is unconditionally at the head of sys.path
_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from celery import Celery

from backend_api.http.config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND

log = logging.getLogger(__name__)

CELERY_TASK_MODULES = [
    "backend_api.tasks.mpc_tasks",
    "backend_api.tasks.adaptive_tasks",
    "backend_api.tasks.workflow_tasks",
]

celery = Celery(
    "labcd",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=CELERY_TASK_MODULES,
)
app = celery

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
    task_default_queue="celery",
    task_time_limit=600,  # 10 minutes hard limit
    task_soft_time_limit=540,  # 9 minutes soft limit
    include=CELERY_TASK_MODULES,
)

# Explicitly import task modules so @celery.task registers them into the worker registry

# Ensure workers pick up admin-updated API keys from the shared .env bind-mount
# without requiring a process restart (see api_key_service.refresh_managed_keys_from_env_file).
from celery.signals import task_prerun  # noqa: E402


@task_prerun.connect
def _reload_api_keys_before_task(**_kwargs) -> None:
    try:
        from backend_api.http.services.api_key_service import refresh_managed_keys_from_env_file

        refresh_managed_keys_from_env_file(force=False)
    except Exception:
        # Never block task execution on a refresh failure; keys may still be set via env_file.
        pass


import backend_api.tasks.adaptive_tasks  # noqa: F401, E402
import backend_api.tasks.mpc_tasks  # noqa: F401, E402
import backend_api.tasks.workflow_tasks  # noqa: F401, E402

