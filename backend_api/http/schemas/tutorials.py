"""Pydantic schemas for the tutorials learning module."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TutorialVideoOut(BaseModel):
    id: int
    title: str
    file_url: str
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class TutorialVideoUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    sort_order: int | None = None


class TutorialDocumentSummaryOut(BaseModel):
    id: int
    title: str
    slug: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TutorialDocumentOut(BaseModel):
    id: int
    title: str
    slug: str
    body_markdown: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TutorialDocumentCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    slug: str | None = Field(default=None, max_length=320)
    body_markdown: str = ""
    sort_order: int | None = None


class TutorialDocumentUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    slug: str | None = Field(default=None, max_length=320)
    body_markdown: str | None = None
    sort_order: int | None = None


class ControlDesignTemplateOut(BaseModel):
    id: int
    title: str
    description: str
    file_url: str
    original_filename: str
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ControlDesignTemplateUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    sort_order: int | None = None
