"""Shared API schemas."""

from typing import Any, Dict, Generic, List, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int


class JobResponse(BaseModel):
    job_id: str
    module: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    module: str
    status: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class UploadResponse(BaseModel):
    file_name: str
    file_type: str
    file_content: str


class MediaUploadResponse(BaseModel):
    url: str


class ModelsResponse(BaseModel):
    llm_models: List[str]
    rag_models: List[str]


class ArtifactResponse(BaseModel):
    job_id: str
    artifacts: Dict[str, Any] = Field(default_factory=dict)
