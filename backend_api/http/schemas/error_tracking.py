"""Pydantic schemas for error tracking."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ErrorSource = Literal["frontend", "backend", "api"]


class ErrorTrackingSettings(BaseModel):
    enabled: bool = False
    frontend: bool = False
    backend: bool = False
    api: bool = False


class ErrorTrackingSettingsUpdate(BaseModel):
    enabled: bool | None = None
    frontend: bool | None = None
    backend: bool | None = None
    api: bool | None = None


class ErrorReportRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4096)
    stack_trace: str | None = Field(default=None, max_length=16384)
    path: str | None = Field(default=None, max_length=512)
    method: str | None = Field(default=None, max_length=16)
    status_code: int | None = None
    page_url: str | None = Field(default=None, max_length=1024)
    extra: dict[str, Any] | None = None


class ErrorEventOut(BaseModel):
    id: int
    source: str
    message: str
    stack_trace: str | None = None
    path: str | None = None
    method: str | None = None
    status_code: int | None = None
    user_id: int | None = None
    user_email: str | None = None
    user_agent: str | None = None
    page_url: str | None = None
    extra: dict[str, Any] | None = None
    created_at: str | None = None
