"""AgentAdaptive job API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

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


class AdaptiveJobOptions(BaseModel):
    """Knobs for a design run (mirrors Streamlit / run_full_pipeline options)."""

    enable_tuning: bool = False
    target_rms_frac: float = Field(default=0.02, gt=0, le=1.0)
    max_tuning_rounds: int = Field(default=4, ge=0, le=20)
    skip_clarify: bool = False
    model: str | None = None
    description: str = ""
    tuning_objectives: dict[str, int] | None = None
    sim_time: float | None = None
    solver_step: float | None = None
    x0: list[float] | None = None
    references: dict[str, Any] | None = None


class AdaptiveJobCreateRequest(BaseModel):
    """Start a design job from a system_spec (plant JSON + sim knobs)."""

    system_spec: dict[str, Any] | None = None
    options: AdaptiveJobOptions = Field(default_factory=AdaptiveJobOptions)
    user_id: int | None = None
    project_id: str | int | None = None

    @field_validator("project_id", mode="before")
    @classmethod
    def _coerce_project_id(cls, v: Any) -> str | None:
        if v is None or v == "":
            return None
        return str(v)


class AdaptiveJobCreateResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    message: str = ""


class AdaptiveClarifyRequest(BaseModel):
    """Submit a clarification answer, or force-finish the clarifier."""

    answer: str = ""
    force_finish: bool = False


class AdaptiveClarifyResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    clarifier_status: Literal["continue", "complete", "error", "skipped"]
    reply: str = ""
    round: int = 0


class AdaptiveJobProgressEvent(BaseModel):
    kind: str = ""
    stage: str = ""
    text: str = ""
    round: int | None = None
    ts: float | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class AdaptiveJobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    message: str = ""
    error: str | None = None
    round: int = 0
    clarify_pending: bool = False
    last_clarifier_reply: str | None = None
    progress: list[AdaptiveJobProgressEvent] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    user_id: int | None = None
    project_id: str | int | None = None

    @field_validator("project_id", mode="before")
    @classmethod
    def _coerce_project_id(cls, v: Any) -> str | None:
        if v is None or v == "":
            return None
        return str(v)
    options: AdaptiveJobOptions | None = None


class AdaptiveJobResultsResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    abstract: str | None = None
    report: str | None = None
    method: str | None = None
    final_metrics: dict[str, Any] | None = None
    tuning_log: list[dict[str, Any]] = Field(default_factory=list)
    tuning_best: dict[str, Any] | None = None
    system_spec: dict[str, Any] | None = None
    clarification_record: list[dict[str, Any]] = Field(default_factory=list)
    usage: dict[str, Any] | None = None
    series: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    error: str | None = None
    score: float | None = None
    success: bool | None = None
    design_grade: dict[str, Any] | None = None
    session_metadata: dict[str, Any] | None = None
    control_law: str | None = None
    stability_proof: str | None = None


class AdaptiveDiagnosisChatRequest(BaseModel):
    message: str
    history: list[dict[str, Any]] | None = None


class AdaptiveDiagnosisChatResponse(BaseModel):
    reply: str
    usage: dict[str, Any] | None = None


class GradeDesignRequest(BaseModel):
    """Client rating submission (1-5 stars) for a designed controller."""

    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class AdaptiveJobSummary(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    system_name: str | None = None
    created_at: datetime
    updated_at: datetime
    user_id: int | None = None
    score: float | None = None
    success: bool | None = None
    rating: int | None = None
