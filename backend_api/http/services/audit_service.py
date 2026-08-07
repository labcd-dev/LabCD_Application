"""Append-only audit log for auth events and admin mutations."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend_api.common.csv_utils import rows_to_csv
from backend_api.db.models import AuditLog, User
from backend_api.http.services.auth_service import client_ip_from_request

logger = logging.getLogger(__name__)

ACTION_MAX = 80
CATEGORY_MAX = 20
EMAIL_MAX = 255
RESOURCE_TYPE_MAX = 40
RESOURCE_ID_MAX = 64
IP_MAX = 64
UA_MAX = 512


def _truncate(value: str | None, max_len: int) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    return text[:max_len]


def _resource_id_str(resource_id: int | str | None) -> str | None:
    if resource_id is None:
        return None
    return _truncate(str(resource_id), RESOURCE_ID_MAX)


def record(
    db: Session,
    *,
    action: str,
    category: str,
    actor: User | None = None,
    actor_user_id: int | None = None,
    actor_email: str | None = None,
    resource_type: str | None = None,
    resource_id: int | str | None = None,
    success: bool = True,
    ip_address: str | None = None,
    user_agent: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog | None:
    """Persist an audit row. Best-effort: never raises to callers."""
    try:
        uid = actor.id if actor is not None else actor_user_id
        email = actor.email if actor is not None else actor_email
        entry = AuditLog(
            action=_truncate(action, ACTION_MAX) or "unknown",
            category=_truncate(category, CATEGORY_MAX) or "admin",
            actor_user_id=uid,
            actor_email=_truncate(email, EMAIL_MAX),
            resource_type=_truncate(resource_type, RESOURCE_TYPE_MAX),
            resource_id=_resource_id_str(resource_id),
            success=bool(success),
            ip_address=_truncate(ip_address, IP_MAX),
            user_agent=_truncate(user_agent, UA_MAX),
            details=details,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry
    except Exception:
        logger.exception("Failed to persist audit log entry action=%s", action)
        try:
            db.rollback()
        except Exception:
            pass
        return None


def record_from_request(
    db: Session,
    request: Request | None,
    *,
    action: str,
    category: str,
    actor: User | None = None,
    actor_email: str | None = None,
    resource_type: str | None = None,
    resource_id: int | str | None = None,
    success: bool = True,
    details: dict[str, Any] | None = None,
) -> AuditLog | None:
    ip = client_ip_from_request(request) if request is not None else None
    ua = request.headers.get("user-agent") if request is not None else None
    return record(
        db,
        action=action,
        category=category,
        actor=actor,
        actor_email=actor_email,
        resource_type=resource_type,
        resource_id=resource_id,
        success=success,
        ip_address=ip,
        user_agent=ua,
        details=details,
    )


def list_audits(
    db: Session,
    *,
    category: str | None = None,
    action: str | None = None,
    actor_user_id: int | None = None,
    success: bool | None = None,
    q: str | None = None,
    limit: int = 200,
) -> list[AuditLog]:
    query = db.query(AuditLog)
    if category:
        query = query.filter(AuditLog.category == category.strip())
    if action:
        query = query.filter(AuditLog.action == action.strip())
    if actor_user_id is not None:
        query = query.filter(AuditLog.actor_user_id == actor_user_id)
    if success is not None:
        query = query.filter(AuditLog.success.is_(success))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                AuditLog.action.ilike(like),
                AuditLog.actor_email.ilike(like),
                AuditLog.resource_type.ilike(like),
                AuditLog.resource_id.ilike(like),
                AuditLog.ip_address.ilike(like),
            )
        )
    return (
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(max(1, min(limit, 1000)))
        .all()
    )


def entry_to_dict(entry: AuditLog) -> dict[str, Any]:
    created: datetime | None = entry.created_at
    return {
        "id": entry.id,
        "action": entry.action,
        "category": entry.category,
        "actor_user_id": entry.actor_user_id,
        "actor_email": entry.actor_email,
        "resource_type": entry.resource_type,
        "resource_id": entry.resource_id,
        "success": entry.success,
        "ip_address": entry.ip_address,
        "user_agent": entry.user_agent,
        "details": entry.details,
        "created_at": created.isoformat() if created else None,
    }


def _csv_row(entry: AuditLog) -> dict[str, Any]:
    details = ""
    if entry.details is not None:
        try:
            details = json.dumps(entry.details, ensure_ascii=False)
        except (TypeError, ValueError):
            details = str(entry.details)
    return {
        "id": entry.id,
        "created_at": entry.created_at.isoformat() if entry.created_at else "",
        "category": entry.category,
        "action": entry.action,
        "actor_user_id": entry.actor_user_id if entry.actor_user_id is not None else "",
        "actor_email": entry.actor_email or "",
        "resource_type": entry.resource_type or "",
        "resource_id": entry.resource_id or "",
        "success": entry.success,
        "ip_address": entry.ip_address or "",
        "user_agent": entry.user_agent or "",
        "details": details,
    }


def export_csv(
    db: Session,
    *,
    category: str | None = None,
    action: str | None = None,
    actor_user_id: int | None = None,
    success: bool | None = None,
    q: str | None = None,
    limit: int = 5000,
) -> str:
    entries = list_audits(
        db,
        category=category,
        action=action,
        actor_user_id=actor_user_id,
        success=success,
        q=q,
        limit=min(limit, 10000),
    )
    fieldnames = [
        "id",
        "created_at",
        "category",
        "action",
        "actor_user_id",
        "actor_email",
        "resource_type",
        "resource_id",
        "success",
        "ip_address",
        "user_agent",
        "details",
    ]
    return rows_to_csv((_csv_row(e) for e in entries), fieldnames)
