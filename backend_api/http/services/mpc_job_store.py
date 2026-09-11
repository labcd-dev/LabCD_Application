"""In-memory job store for AgentMPC runs."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Literal
from uuid import uuid4

JobStatus = Literal[
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
]

JobStage = Literal[
    "queued",
    "scenarist",
    "actor",
    "evaluator",
    "terminator",
    "critic",
    "juror",
    "done",
    "error",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid4().hex[:12]


@dataclass
class JobRecord:
    job_id: str
    status: JobStatus = "queued"
    stage: JobStage = "queued"
    message: str = ""
    error: str | None = None
    dynamics_ref: dict[str, Any] | None = None
    options: dict[str, Any] = field(default_factory=dict)
    user_id: int | None = None
    project_id: str | None = None
    system_name: str | None = None
    # Progress + cancel
    progress: list[dict[str, Any]] = field(default_factory=list)
    cancel_requested: bool = False
    iteration: int = 0
    max_iterations: int = 0
    # Results
    best_params: dict[str, Any] | None = None
    best_mse: float | None = None
    termination_reason: str | None = None
    mse_history: list[float] = field(default_factory=list)
    overshoot_history: list[float] = field(default_factory=list)
    settling_history: list[float] = field(default_factory=list)
    effort_history: list[float] = field(default_factory=list)
    params_history: list[dict[str, Any]] = field(default_factory=list)
    history: list = field(default_factory=list)
    report: str | None = None
    export_script: str | None = None
    metrics: dict[str, Any] | None = None
    # Dense simulation series, token accounting & diagnostics
    series: dict[str, Any] | None = None
    baseline_series: dict[str, Any] | None = None
    # Token usage & cost tracking
    usage: dict[str, Any] | None = None
    # Diagnostics results
    diagnostics: dict[str, Any] | None = None
    score: float | None = None
    success: bool | None = None
    design_grade: dict[str, Any] | None = None
    session_metadata: dict[str, Any] | None = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)


class InMemoryMPCJobStore:
    """Thread-safe in-memory job registry for AgentMPC with PostgreSQL persistence."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._jobs: dict[str, JobRecord] = {}

    def _sync_to_db(self, record: JobRecord) -> None:
        try:
            from backend_api.db.session import SessionLocal
            from backend_api.db.models import MPCJobRecord as DBMPCJob

            with SessionLocal() as db:
                row = db.query(DBMPCJob).filter(DBMPCJob.job_id == record.job_id).first()
                res_payload = {
                    "best_params": record.best_params,
                    "best_mse": record.best_mse,
                    "iteration": record.iteration,
                    "termination_reason": record.termination_reason,
                    "mse_history": record.mse_history,
                    "overshoot_history": record.overshoot_history,
                    "settling_history": record.settling_history,
                    "effort_history": record.effort_history,
                    "params_history": record.params_history,
                    "history": record.history,
                    "report": record.report,
                    "export_script": record.export_script,
                    "metrics": record.metrics,
                    "series": record.series,
                    "baseline_series": record.baseline_series,
                    "usage": record.usage,
                    "diagnostics": record.diagnostics,
                    "score": record.score,
                    "success": record.success,
                    "design_grade": record.design_grade,
                    "session_metadata": record.session_metadata,
                }
                if row is None:
                    row = DBMPCJob(
                        job_id=record.job_id,
                        user_id=record.user_id,
                        project_id=record.project_id,
                        status=record.status,
                        stage=record.stage,
                        message=record.message,
                        error=record.error,
                        iteration=record.iteration,
                        max_iterations=record.max_iterations,
                        system_name=record.system_name,
                        options=record.options,
                        dynamics=record.dynamics_ref,
                        progress=record.progress,
                        results=res_payload,
                        cancel_requested=record.cancel_requested,
                    )
                    db.add(row)
                else:
                    row.status = record.status
                    row.stage = record.stage
                    row.message = record.message
                    row.error = record.error
                    row.iteration = record.iteration
                    row.max_iterations = record.max_iterations
                    row.system_name = record.system_name
                    row.progress = record.progress
                    row.results = res_payload
                    row.cancel_requested = record.cancel_requested
                db.commit()
        except Exception:
            pass

    def _load_from_db(self, job_id: str) -> JobRecord | None:
        try:
            from backend_api.db.session import SessionLocal
            from backend_api.db.models import MPCJobRecord as DBMPCJob

            with SessionLocal() as db:
                row = db.query(DBMPCJob).filter(DBMPCJob.job_id == job_id).first()
                if row is None:
                    return None
                res = row.results or {}
                rec = JobRecord(
                    job_id=row.job_id,
                    status=row.status,  # type: ignore[arg-type]
                    stage=row.stage,  # type: ignore[arg-type]
                    message=row.message,
                    error=row.error,
                    dynamics_ref=row.dynamics,
                    options=row.options or {},
                    user_id=row.user_id,
                    project_id=row.project_id,
                    system_name=row.system_name,
                    progress=row.progress or [],
                    cancel_requested=row.cancel_requested,
                    iteration=row.iteration,
                    max_iterations=row.max_iterations,
                    best_params=res.get("best_params"),
                    best_mse=res.get("best_mse"),
                    termination_reason=res.get("termination_reason"),
                    mse_history=res.get("mse_history") or [],
                    overshoot_history=res.get("overshoot_history") or [],
                    settling_history=res.get("settling_history") or [],
                    effort_history=res.get("effort_history") or [],
                    params_history=res.get("params_history") or [],
                    history=res.get("history") or [],
                    report=res.get("report"),
                    export_script=res.get("export_script"),
                    metrics=res.get("metrics"),
                    series=res.get("series"),
                    baseline_series=res.get("baseline_series"),
                    usage=res.get("usage"),
                    diagnostics=res.get("diagnostics"),
                    score=res.get("score"),
                    success=res.get("success"),
                    design_grade=res.get("design_grade"),
                    session_metadata=res.get("session_metadata"),
                    created_at=row.created_at or _now(),
                    updated_at=row.updated_at or _now(),
                )
                self._jobs[job_id] = rec
                return rec
        except Exception:
            return None

    def create(
        self,
        *,
        dynamics_ref: dict[str, Any] | None,
        options: dict[str, Any],
        user_id: int | None = None,
        project_id: str | None = None,
        system_name: str | None = None,
    ) -> JobRecord:
        with self._lock:
            job_id = _new_id()
            while job_id in self._jobs:
                job_id = _new_id()
            if project_id is not None:
                project_id = str(project_id)
            record = JobRecord(
                job_id=job_id,
                dynamics_ref=deepcopy(dynamics_ref) if dynamics_ref else None,
                options=dict(options or {}),
                user_id=user_id,
                project_id=project_id,
                system_name=system_name,
                max_iterations=int(options.get("max_iterations") or 0),
            )
            self._jobs[job_id] = record
            self._sync_to_db(record)
            return deepcopy(record)

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                record = self._load_from_db(job_id)
            return deepcopy(record) if record is not None else None

    def list_jobs(self, user_id: int | None = None) -> list[JobRecord]:
        with self._lock:
            records = list(self._jobs.values())
        if user_id is not None:
            records = [r for r in records if r.user_id == user_id]
        records.sort(key=lambda r: r.updated_at, reverse=True)
        return [deepcopy(r) for r in records]

    def update(self, job_id: str, **fields: Any) -> JobRecord | None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                record = self._load_from_db(job_id)
            if record is None:
                return None
            for key, value in fields.items():
                if not hasattr(record, key):
                    raise AttributeError(f"JobRecord has no field {key!r}")
                if key == "project_id" and value is not None:
                    value = str(value)
                setattr(record, key, value)
            record.updated_at = _now()
            self._sync_to_db(record)
            return deepcopy(record)

    def append_progress(self, job_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                record = self._load_from_db(job_id)
            if record is None:
                return
            record.progress.append(dict(event))
            record.updated_at = _now()
            self._sync_to_db(record)

    def request_cancel(self, job_id: str) -> JobRecord | None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                record = self._load_from_db(job_id)
            if record is None:
                return None
            record.cancel_requested = True
            record.updated_at = _now()
            self._sync_to_db(record)
            return deepcopy(record)

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                record = self._load_from_db(job_id)
            return bool(record and record.cancel_requested)


default_mpc_job_store = InMemoryMPCJobStore()


def get_mpc_store() -> InMemoryMPCJobStore:
    return default_mpc_job_store
