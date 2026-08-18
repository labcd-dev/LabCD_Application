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


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

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
        return job

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
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
        job.touch()
        return job


job_store = JobStore()
