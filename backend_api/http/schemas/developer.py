"""Developer API key and public job schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class DeveloperApiKeyMetaOut(BaseModel):
    id: int
    user_id: int
    key_prefix: str
    key_last4: str
    masked_key: str
    name: str = ""
    created_at: datetime
    revoked_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    is_active: bool = True


class DeveloperApiKeyCreateOut(DeveloperApiKeyMetaOut):
    """Returned only on create/regenerate — includes the full secret once."""

    api_key: str


class DeveloperApiKeyCreateRequest(BaseModel):
    name: str = ""


class DeveloperJobResponse(BaseModel):
    job_id: str
    module: str
    status: str
    message: str = ""


class DeveloperJobStatusOut(BaseModel):
    job_id: str
    module: str
    status: str
    error: Optional[str] = None
    stage: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DeveloperJobResultsOut(BaseModel):
    job_id: str
    module: str
    status: str
    results: dict[str, Any] = Field(default_factory=dict)
