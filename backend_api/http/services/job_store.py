"""In-memory job tracking for long-running workflows."""

from __future__ import annotations

import queue
import threading
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional

from backend_api.common.datetime_utils import utc_iso, utcnow
from backend_api.common.serialization import make_serializable

INTERNAL_METADATA_KEYS = frozenset(
    {
        "monitor",
        "config",
        "graph",
        "initial_state",
        "graph_config",
        "designer",
    }
)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING_INPUT = "waiting_input"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Job:
    id: str
    module: str
    status: JobStatus = JobStatus.PENDING
    created_at: str = field(default_factory=lambda: utc_iso(utcnow()))
    updated_at: str = field(default_factory=lambda: utc_iso(utcnow()))
    event_queue: queue.Queue = field(default_factory=queue.Queue)
    metadata: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    cancel_requested: bool = False
    user_id: Optional[int] = None
    thread: Optional[threading.Thread] = field(default=None, repr=False)

    def touch(self, status: Optional[JobStatus] = None) -> None:
        if status is not None:
            self.status = status
        self.updated_at = utc_iso(utcnow())
        try:
            from backend_api.http.services.redis_client import is_redis_available, redis_set_json

            if is_redis_available():
                safe_meta = make_serializable(
                    {k: v for k, v in self.metadata.items() if k not in INTERNAL_METADATA_KEYS}
                )
                payload = {
                    "id": self.id,
                    "module": self.module,
                    "status": self.status.value,
                    "created_at": self.created_at,
                    "updated_at": self.updated_at,
                    "metadata": safe_meta,
                    "error": self.error,
                    "cancel_requested": self.cancel_requested,
                    "user_id": self.user_id,
                }
                redis_set_json(f"labcd:job:{self.id}", payload, ex=86400 * 7)
        except Exception:
            pass


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def _sync_to_redis(self, job: Job) -> None:
        job.touch()

    def _load_from_redis(self, job_id: str) -> Optional[Job]:
        try:
            from backend_api.http.services.redis_client import is_redis_available, redis_get_json

            if is_redis_available():
                data = redis_get_json(f"labcd:job:{job_id}")
                if data and isinstance(data, dict):
                    job = Job(
                        id=data["id"],
                        module=data["module"],
                        status=JobStatus(data.get("status", "pending")),
                        created_at=data.get("created_at") or utc_iso(utcnow()),
                        updated_at=data.get("updated_at") or utc_iso(utcnow()),
                        metadata=data.get("metadata") or {},
                        error=data.get("error"),
                        cancel_requested=bool(data.get("cancel_requested")),
                        user_id=data.get("user_id"),
                    )
                    self._jobs[job_id] = job
                    return job
        except Exception:
            pass
        return None

    def create(
        self,
        module: str,
        metadata: Optional[Dict[str, Any]] = None,
        user_id: Optional[int] = None,
    ) -> Job:
        job_id = str(uuid.uuid4())
        job = Job(id=job_id, module=module, metadata=metadata or {}, user_id=user_id)
        with self._lock:
            self._jobs[job_id] = job
            self._sync_to_redis(job)
        return job

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                job = self._load_from_redis(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def update_metadata(self, job_id: str, updates: Dict[str, Any]) -> Job:
        job = self.get(job_id)
        job.metadata.update(updates)
        job.touch()
        return job

    def public_metadata(self, job: Job) -> Dict[str, Any]:
        """Return API-safe metadata without internal runtime objects."""
        return make_serializable(
            {key: value for key, value in job.metadata.items() if key not in INTERNAL_METADATA_KEYS}
        )

    def request_cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status in {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}:
            raise ValueError(f"Job {job_id} cannot be cancelled (status: {job.status.value})")

        try:
            from backend_api.http.services.redis_client import is_redis_available, get_redis_client, redis_publish

            if is_redis_available():
                client = get_redis_client()
                if client:
                    client.set(f"labcd:job:{job_id}:cancel", "1", ex=86400 * 7)
                redis_publish(f"labcd:job:{job_id}:events", {"event": "status", "data": {"status": "cancelled"}})
        except Exception:
            pass

        job.cancel_requested = True
        if job.module == "silo":
            monitor = job.metadata.get("monitor")
            if monitor is not None:
                monitor.is_running = False
                monitor.add_progress("Cancelling design, stopping jobs and simulations...")
            job.event_queue.put(
                {
                    "type": "stream",
                    "content": {
                        "text": "Cancelling design, stopping jobs and simulations...",
                    },
                }
            )
        # Project History should leave "running" as soon as the user cancels.
        project_id = job.metadata.get("project_id")
        if project_id is not None:
            try:
                from backend_api.http.services.project_service import sync_project_cancelled

                sync_project_cancelled(project_id, job_id, error="Cancelled by user")
            except Exception:
                pass
        job.touch()
        return job

    def is_cancel_requested(self, job_id: str) -> bool:
        try:
            from backend_api.http.services.redis_client import is_redis_available, get_redis_client

            if is_redis_available():
                client = get_redis_client()
                if client and client.get(f"labcd:job:{job_id}:cancel") == "1":
                    return True
        except Exception:
            pass

        try:
            job = self.get(job_id)
            return bool(job and job.cancel_requested)
        except Exception:
            return False


job_store = JobStore()
