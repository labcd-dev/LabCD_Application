"""Pydantic schemas for admin user-journey aggregation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

JourneyStepStatus = Literal["ok", "fail", "info"]


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


class UserJourneyOut(BaseModel):
    user: JourneyUserOut
    steps: list[JourneyStepOut] = Field(default_factory=list)
    comments: list[JourneyCommentOut] = Field(default_factory=list)
