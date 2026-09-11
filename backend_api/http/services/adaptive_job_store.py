"""In-memory job store for AgentAdaptive runs."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Literal
from uuid import uuid4

JobStatus = Literal[
    "queued",
    "clarifying",
    "designing",
    "building",
    "tuning",
    "reporting",
    "completed",
    "failed",
    "cancelled",
]

JobStage = Literal[
    "queued",
    "clarify",
    "design",
    "build",
    "tune",
    "report",
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
    system_spec: dict[str, Any] | None = None
    options: dict[str, Any] = field(default_factory=dict)
    user_id: int | None = None
    project_id: str | None = None
    # Clarifier conversation state
    clarify_messages: list[dict[str, str]] = field(default_factory=list)
    clarify_chat_log: list[dict[str, str]] = field(default_factory=list)
    clarify_round: int = 0
    last_clarifier_reply: str | None = None
    clarification_record: list[dict[str, Any]] = field(default_factory=list)
    clarifier_usage: dict[str, Any] = field(default_factory=dict)
    # Progress + cancel
    progress: list[dict[str, Any]] = field(default_factory=list)
    cancel_requested: bool = False
    # Results
    abstract: str | None = None
    report: str | None = None
    method: str | None = None
    final_metrics: dict[str, Any] | None = None
    tuning_log: list[dict[str, Any]] = field(default_factory=list)
    tuning_best: dict[str, Any] | None = None
    usage: dict[str, Any] | None = None
    series: dict[str, Any] | None = None
    score: float | None = None
    success: bool | None = None
    design_grade: dict[str, Any] | None = None
    session_metadata: dict[str, Any] | None = None
    export_script: str | None = None
    diagnosis: dict[str, Any] | None = None
    control_law: str | None = None
    stability_proof: str | None = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)


class InMemoryAdaptiveJobStore:
    """Thread-safe in-memory job registry for AgentAdaptive with PostgreSQL persistence."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._jobs: dict[str, JobRecord] = {}

    def _sync_to_db(self, record: JobRecord) -> None:
        try:
            from backend_api.db.session import SessionLocal
            from backend_api.db.models import AdaptiveJobRecord as DBAdaptiveJob

            with SessionLocal() as db:
                row = db.query(DBAdaptiveJob).filter(DBAdaptiveJob.job_id == record.job_id).first()
                res_payload = {
                    "abstract": record.abstract,
                    "report": record.report,
                    "method": record.method,
                    "final_metrics": record.final_metrics,
                    "tuning_log": record.tuning_log,
                    "tuning_best": record.tuning_best,
                    "series": record.series,
                    "usage": record.usage,
                    "score": record.score,
                    "success": record.success,
                    "design_grade": record.design_grade,
                    "session_metadata": record.session_metadata,
                    "export_script": record.export_script,
                    "diagnosis": record.diagnosis,
                    "control_law": record.control_law,
                    "stability_proof": record.stability_proof,
                }
                if row is None:
                    row = DBAdaptiveJob(
                        job_id=record.job_id,
                        user_id=record.user_id,
                        project_id=record.project_id,
                        status=record.status,
                        stage=record.stage,
                        message=record.message,
                        error=record.error,
                        clarify_round=record.clarify_round,
                        last_clarifier_reply=record.last_clarifier_reply,
                        options=record.options,
                        system_spec=record.system_spec,
                        clarification_record=record.clarification_record,
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
                    row.clarify_round = record.clarify_round
                    row.last_clarifier_reply = record.last_clarifier_reply
                    row.progress = record.progress
                    row.results = res_payload
                    row.cancel_requested = record.cancel_requested
                db.commit()
        except Exception:
            pass

    def _load_from_db(self, job_id: str) -> JobRecord | None:
        try:
            from backend_api.db.session import SessionLocal
            from backend_api.db.models import AdaptiveJobRecord as DBAdaptiveJob

            with SessionLocal() as db:
                row = db.query(DBAdaptiveJob).filter(DBAdaptiveJob.job_id == job_id).first()
                if row is None:
                    return None
                res = row.results or {}
                rec = JobRecord(
                    job_id=row.job_id,
                    status=row.status,  # type: ignore[arg-type]
                    stage=row.stage,  # type: ignore[arg-type]
                    message=row.message,
                    error=row.error,
                    system_spec=row.system_spec,
                    options=row.options or {},
                    user_id=row.user_id,
                    project_id=row.project_id,
                    clarify_round=row.clarify_round,
                    last_clarifier_reply=row.last_clarifier_reply,
                    clarification_record=row.clarification_record or [],
                    progress=row.progress or [],
                    cancel_requested=row.cancel_requested,
                    abstract=res.get("abstract"),
                    report=res.get("report"),
                    method=res.get("method"),
                    final_metrics=res.get("final_metrics"),
                    tuning_log=res.get("tuning_log") or [],
                    tuning_best=res.get("tuning_best"),
                    usage=res.get("usage"),
                    series=res.get("series"),
                    score=res.get("score"),
                    success=res.get("success"),
                    design_grade=res.get("design_grade"),
                    session_metadata=res.get("session_metadata"),
                    export_script=res.get("export_script"),
                    diagnosis=res.get("diagnosis"),
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
        system_spec: dict[str, Any] | None,
        options: dict[str, Any],
        user_id: int | None = None,
        project_id: str | None = None,
    ) -> JobRecord:
        with self._lock:
            job_id = _new_id()
            while job_id in self._jobs:
                job_id = _new_id()
            record = JobRecord(
                job_id=job_id,
                system_spec=deepcopy(system_spec) if system_spec else None,
                options=dict(options or {}),
                user_id=user_id,
                project_id=project_id,
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


default_adaptive_job_store = InMemoryAdaptiveJobStore()


def get_adaptive_store() -> InMemoryAdaptiveJobStore:
    return default_adaptive_job_store
