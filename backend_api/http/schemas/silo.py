"""SiloDesigner API schemas."""

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class SiloStartRequest(BaseModel):
    config: Dict[str, Any]
    control_objective: Optional[str] = None
    project_id: Optional[int] = None


class SiloObjectiveRequest(BaseModel):
    objective: str


class SiloSimulateRequest(BaseModel):
    """Manual gain re-simulation request (Streamlit Time Response parity)."""

    gains: Dict[str, float] = Field(default_factory=dict)
    scenario: Optional[Dict[str, Any]] = None
