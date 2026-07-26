"""MuloDesigner API schemas."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class MuloInitRequest(BaseModel):
    run_config: Dict[str, Any]
    controller_structure: List[Dict[str, Any]]
    system_identification: Dict[str, Any]
    trimming_result: Dict[str, Any]
    equation: str
    project_id: Optional[int] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None


class MuloStartRequest(BaseModel):
    run_config: Dict[str, Any]
    controller_structure: List[Dict[str, Any]]
    system_identification: Dict[str, Any]
    trimming_result: Dict[str, Any]
    equation: str
    project_id: Optional[int] = None
    file_name: Optional[str] = None
    file_type: Optional[str] = None


class MuloConfigureRequest(BaseModel):
    case_study: Dict[str, Any]
    controller_structure: List[Dict[str, Any]]


class MuloContinueRequest(BaseModel):
    equation: str
    controller_structure: List[Dict[str, Any]]


class MuloScratchpadRequest(BaseModel):
    modified_code: str
    modified_controller_structure: List[Dict[str, Any]]


class MuloSimulateRequest(BaseModel):
    kp: float
    ki: float
    kd: float
    signal_type: str = Field(default="Step", pattern="^(Step|Ramp|Sine)$")
    amplitude: Optional[float] = None


class MuloDesignerStateResponse(BaseModel):
    job_id: str
    controller_index: int
    controller_designed: bool
    total_loops: int
    loop_name: str
    is_complete: bool
    equation: str
    controller_structure: List[Dict[str, Any]]
    case_study: Dict[str, Any]
    run_config: Dict[str, Any]
    final_state: Dict[str, Any]
    modified_code: str
    modified_controller_structure: List[Dict[str, Any]]
    pid_gains: Dict[str, float]
    pid_gain_bounds: Dict[str, float]
