"""Project history API schemas."""

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class ProjectCreateRequest(BaseModel):
    title: Optional[str] = None
    pipeline_type: str = Field(pattern="^(siloDesign|muloDesign)$")
    file_name: str = ""
    file_type: str = "python"
    file_content: str = ""
    llm_model: str = "gpt-4o"
    control_objective: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    control_objective: Optional[str] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    file_content: Optional[str] = None
    job_id: Optional[str] = None
    results: Optional[dict[str, Any]] = None


class ProjectSiloSimulateRequest(BaseModel):
    """Manual gain re-simulation for a saved single-loop project."""

    gains: Dict[str, float] = Field(default_factory=dict)
    scenario: Optional[Dict[str, Any]] = None


class ProjectGradeRequest(BaseModel):
    """Client rating submission (1-5 stars) for a project."""

    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class ProjectSummary(BaseModel):
    id: int
    user_id: int
    owner_email: Optional[str] = None
    title: str
    pipeline_type: str
    status: str
    file_name: str
    file_type: str
    file_url: Optional[str] = None
    llm_model: str
    has_results: bool
    job_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    score: Optional[float] = None
    success: Optional[bool] = None
    rating: Optional[int] = None
    design_grade: Optional[dict[str, Any]] = None
    session_metadata: Optional[dict[str, Any]] = None


class ProjectDetail(ProjectSummary):
    file_content: str
    control_objective: Optional[str] = None
    results: Optional[dict[str, Any]] = None
