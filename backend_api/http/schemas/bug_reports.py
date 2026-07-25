"""Pydantic schemas for user bug reports."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BugReportOut(BaseModel):
    id: int
    user_id: int | None
    user_email: str | None = None
    description: str
    image_url: str | None
    page_url: str | None
    status: str
    created_at: datetime
    fixed_at: datetime | None

    model_config = {"from_attributes": True}


class BugReportStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(open|fixed)$")


class BugReportSettings(BaseModel):
    enabled: bool


class BugReportSettingsUpdate(BaseModel):
    enabled: bool | None = None
