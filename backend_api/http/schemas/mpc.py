"""AgentMPC job API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

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


class MPCJobOptions(BaseModel):
    """Knobs for an MPC tuning run (mirrors Streamlit / run_agents options)."""

    max_iterations: int = Field(default=15, ge=1, le=100)
    prediction_horizon: int = Field(default=12, ge=1, le=200)
    control_horizon: int = Field(default=4, ge=1, le=100)
    dt_mpc: float = Field(default=0.02, gt=0)
    simulation_time: float = Field(default=3.0, gt=0)
    ui_scenario_level: int = Field(default=1, ge=1, le=3)
    user_guidance: str = ""
    min_explore_iterations: int = Field(default=4, ge=0, le=50)
    exploration_intensity: int = Field(default=50, ge=1, le=100)
    use_ui_graph: bool = True
    seed_params: dict[str, Any] | None = None
    model: str | None = None
    system_name: str = "mpc_system"
    # Full trajectory scenario configuration
    trajectory_mode: str = Field(default="reg", description="Trajectory mode: reg | sin | pulse | custom")
    trajectory_amplitude: float = Field(default=0.5, ge=0.0)
    trajectory_frequency: float = Field(default=0.5, gt=0.0)
    trajectory_pulse_start: float = Field(default=0.2, ge=0.0, le=1.0)
    trajectory_pulse_end: float = Field(default=0.7, ge=0.0, le=1.0)
    noise_std: float = Field(default=0.0, ge=0.0)
    q_weights: list[float] | None = None
    r_weights: list[float] | None = None
    p_weights: list[float] | None = None
    cost_weights: dict[str, float] | None = None
    # FR02 Custom Scenario & Disturbance
    custom_drift_pct: float | None = Field(default=None, ge=0.0, le=100.0, description="Custom parameter drift percentage (0-100%)")
    disturbance_amplitude: float | None = Field(default=None, ge=0.0, description="External disturbance force/torque step magnitude")
    disturbance_start: float | None = Field(default=None, ge=0.0, le=1.0, description="Disturbance injection start time as fraction of sim time (0-1)")
    disturbance_type: str = Field(default="step", description="Disturbance type: step | pulse | none")
    # FR03 State trajectory multi-select
    target_state_indices: list[int] | None = Field(default=None, description="Indices of states that track the dynamic trajectory")
    trajectory_per_state_modes: list[str] | None = Field(default=None, description="Per-state trajectory modes (reg, sin, pulse)")


class MPCDynamicsInput(BaseModel):
    plugin_path: str | None = None
    plugin_id: str | None = None
    source: str | None = None
    artifact_id: str | int | None = None


class MPCDiagnosticsRequest(BaseModel):
    dynamics: MPCDynamicsInput | None = None
    dt: float = Field(default=0.02, gt=0)
    sim_time: float = Field(default=2.0, gt=0)
    u_step_fraction: float = Field(default=0.25, gt=0)


class MPCDiagnosticsResponse(BaseModel):
    eigenvalues: list[dict[str, float]] = Field(default_factory=list)
    is_stable: bool = True
    is_controllable: bool = True
    controllability_rank: int = 0
    n_states: int = 0
    n_inputs: int = 0
    state_names: list[str] = Field(default_factory=list)
    input_names: list[str] = Field(default_factory=list)
    suggested_dt: float = 0.02
    bryson_q: list[float] = Field(default_factory=list)
    bryson_r: list[float] = Field(default_factory=list)
    probe_trajectory: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    error: str | None = None


class MPCSimulateRequest(BaseModel):
    job_id: str | None = None
    dynamics: MPCDynamicsInput | None = None
    np: int = Field(default=12, ge=1, le=100)
    nc: int = Field(default=4, ge=1, le=50)
    dt: float = Field(default=0.02, gt=0)
    sim_time: float = Field(default=3.0, gt=0)
    q: list[float] | None = None
    r: list[float] | None = None
    p: list[float] | None = None
    trajectory_mode: str = "reg"
    trajectory_amplitude: float = 0.5
    trajectory_frequency: float = 0.5
    trajectory_pulse_start: float = 0.2
    trajectory_pulse_end: float = 0.7
    noise_std: float = 0.0
    scenario_level: int = 1


class MPCSimulateResponse(BaseModel):
    series: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    solve_time_ms: float = 0.0
    unstable: bool = False
    unstable_reason: str | None = None
    error: str | None = None


class MPCJobCreateRequest(BaseModel):
    dynamics: MPCDynamicsInput | None = None
    options: MPCJobOptions = Field(default_factory=MPCJobOptions)
    user_id: int | None = None
    project_id: str | int | None = None

    @field_validator("project_id", mode="before")
    @classmethod
    def _coerce_project_id(cls, v: Any) -> str | None:
        if v is None or v == "":
            return None
        return str(v)


class MPCJobCreateResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    message: str = ""


class MPCJobProgressEvent(BaseModel):
    kind: str = ""
    stage: str = ""
    text: str = ""
    round: int | None = None
    ts: float | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class MPCJobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    message: str = ""
    error: str | None = None
    iteration: int = 0
    max_iterations: int = 0
    progress: list[MPCJobProgressEvent] = Field(default_factory=list)
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
    options: MPCJobOptions | None = None
    system_name: str | None = None
    # Live telemetry fields for real-time streaming
    series: dict[str, Any] | None = None
    baseline_series: dict[str, Any] | None = None
    best_params: Any = None
    best_mse: float | None = None
    mse_history: list[Any] = Field(default_factory=list)
    params_history: list[Any] = Field(default_factory=list)


class MPCJobResultsResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage
    best_params: Any = None
    best_mse: float | None = None
    iteration: int = 0
    termination_reason: str | None = None
    mse_history: list[Any] = Field(default_factory=list)
    overshoot_history: list[Any] = Field(default_factory=list)
    settling_history: list[Any] = Field(default_factory=list)
    effort_history: list[Any] = Field(default_factory=list)
    params_history: list[Any] = Field(default_factory=list)
    history: list[Any] = Field(default_factory=list)
    report: str | None = None
    export_script: str | None = None
    metrics: Any = None
    # Dense simulation time series
    series: dict[str, Any] | None = None
    baseline_series: dict[str, Any] | None = None
    # Token usage & cost tracking
    usage: dict[str, Any] | None = None
    # Diagnostics results (AgentMPC diagnostics_agent payload)
    diagnostics: dict[str, Any] | None = None
    # Alias for shared Diagnosis UI (same object as diagnostics when structured)
    diagnosis: dict[str, Any] | None = None
    error: str | None = None
    score: float | None = None
    success: bool | None = None
    design_grade: dict[str, Any] | None = None
    session_metadata: dict[str, Any] | None = None

    model_config = {"arbitrary_types_allowed": True}


class MPCDiagnosisChatRequest(BaseModel):
    message: str
    history: list[dict[str, Any]] | None = None


class MPCDiagnosisChatResponse(BaseModel):
    reply: str
    usage: dict[str, Any] | None = None


class GradeDesignRequest(BaseModel):
    """Client rating submission (1-5 stars) for a designed controller."""

    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class MPCJobSummary(BaseModel):
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
