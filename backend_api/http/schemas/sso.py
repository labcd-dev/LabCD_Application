"""Pydantic schemas for SSO providers (public + admin)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SsoProviderKey = Literal["google", "github"]


class SsoProviderPublicOut(BaseModel):
    id: int
    provider: SsoProviderKey
    display_name: str


class SsoProviderAdminOut(BaseModel):
    id: int
    provider: SsoProviderKey
    display_name: str
    client_id: str
    client_secret_configured: bool
    client_secret_masked: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class SsoProviderCreate(BaseModel):
    provider: SsoProviderKey
    display_name: str = Field(min_length=1, max_length=100)
    client_id: str = Field(min_length=1, max_length=512)
    client_secret: str = Field(min_length=1, max_length=512)
    enabled: bool = False


class SsoProviderUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    client_id: str | None = Field(default=None, min_length=1, max_length=512)
    client_secret: str | None = Field(default=None, min_length=1, max_length=512)
    enabled: bool | None = None
