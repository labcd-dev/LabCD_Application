"""Pydantic schemas for admin user-journey aggregation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

JourneyStepStatus = Literal["ok", "fail", "info"]
JourneyHealth = Literal["good", "at_risk", "new"]
JourneyActionPriority = Literal["high", "med", "low"]


class JourneyUserOut(BaseModel):
    id: int
    email: str
    display_name: str | None = None


class JourneyStepOut(BaseModel):
    id: str
    kind: str
    title: str
    timestamp: str
    status: JourneyStepStatus = "info"
    duration_seconds: int | None = None
    detail: str | None = None
    error: str | None = None
    source_id: str | None = None


class JourneyCommentOut(BaseModel):
    id: str
    source: str
    text: str
    timestamp: str
    rating: int | None = None
    meta: str | None = None


class JourneySignalOut(BaseModel):
    key: str
    value: str
    positive: bool = False


class JourneyPersonaAltOut(BaseModel):
    label: str
    score: int


class JourneyPersonaOut(BaseModel):
    label: str
    score: int
    signals: list[JourneySignalOut] = Field(default_factory=list)
    alts: list[JourneyPersonaAltOut] = Field(default_factory=list)


class JourneyProfileOut(BaseModel):
    university: str | None = None
    degree: str | None = None
    major: str | None = None
    matlab_experience: str | None = None
    control_design_experience: str | None = None
    completed_at: str | None = None


class JourneyKpisOut(BaseModel):
    sessions: int = 0
    sessions_completed: int = 0
    sessions_abandoned: int = 0
    success_rate: float | None = None
    avg_score: float | None = None
    best_score: float | None = None
    worst_score: float | None = None
    tokens_total: int = 0
    credits_charged: float = 0.0
    error_count: int = 0
    error_by_source: dict[str, int] = Field(default_factory=dict)
    time_seconds: int = 0
    median_session_seconds: int | None = None


class JourneyPipelineMixOut(BaseModel):
    name: str
    pipeline_type: str
    count: int
    pct: float


class JourneySessionOut(BaseModel):
    id: int
    title: str
    pipeline: str
    pipeline_type: str
    status: str
    score: float | None = None
    duration_seconds: int | None = None
    tokens: int | None = None
    updated_at: str


class JourneyUsageOut(BaseModel):
    tokens_total: int = 0
    credits_charged: float = 0.0
    avg_credits_per_success: float | None = None
    api_errors: int = 0
    other_errors: int = 0
    avg_rating: float | None = None
    rating_count: int = 0


class JourneyFlagsOut(BaseModel):
    email_verified: bool = False
    is_active: bool = True
    bug_report_count: int = 0
    profile_survey_complete: bool = False


class JourneyActionOut(BaseModel):
    priority: JourneyActionPriority
    title: str
    detail: str


class JourneyDossierOut(BaseModel):
    joined_at: str | None = None
    last_active_at: str | None = None
    plan_name: str | None = None
    health: JourneyHealth = "new"
    health_detail: str = ""
    tags: list[str] = Field(default_factory=list)
    kpis: JourneyKpisOut = Field(default_factory=JourneyKpisOut)
    persona: JourneyPersonaOut | None = None
    profile: JourneyProfileOut | None = None
    pipeline_mix: list[JourneyPipelineMixOut] = Field(default_factory=list)
    recent_sessions: list[JourneySessionOut] = Field(default_factory=list)
    usage: JourneyUsageOut = Field(default_factory=JourneyUsageOut)
    flags: JourneyFlagsOut = Field(default_factory=JourneyFlagsOut)
    actions: list[JourneyActionOut] = Field(default_factory=list)
    latest_project_id: int | None = None


class UserJourneyOut(BaseModel):
    user: JourneyUserOut
    steps: list[JourneyStepOut] = Field(default_factory=list)
    comments: list[JourneyCommentOut] = Field(default_factory=list)
    dossier: JourneyDossierOut = Field(default_factory=JourneyDossierOut)
