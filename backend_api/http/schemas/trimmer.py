"""Trimmer API schemas."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TrimmerStartRequest(BaseModel):
    file_content: str
    file_name: str
    model: str = "gpt-oss-120b"
    trimming_params: Dict[str, Any] = Field(default_factory=dict)
    states_inputs: List[str] = Field(default_factory=list)


class TrimmerInputRequest(BaseModel):
    key: str
    prompt: str
    answer: str


class TrimmerArtifactsResponse(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)
    pdf_file: Optional[str] = None
    safe_system_name: str = ""
    output_dir: str = ""
    time_response_file: Optional[str] = None


class TrimmerTimeResponseResponse(BaseModel):
    filename: str
    message: str = ""


class TrimmerPdfResponse(BaseModel):
    filename: str
    message: str = ""
