"""Pydantic schemas for audit log entries."""

from typing import Any, Literal

from pydantic import BaseModel

AuditCategory = Literal["auth", "admin"]


class AuditLogOut(BaseModel):
    id: int
    action: str
    category: str
    actor_user_id: int | None = None
    actor_email: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    success: bool
    ip_address: str | None = None
    user_agent: str | None = None
    details: dict[str, Any] | None = None
    created_at: str | None = None
