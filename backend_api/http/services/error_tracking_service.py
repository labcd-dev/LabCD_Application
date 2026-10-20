"""In-app error tracking: settings cache, recording, list, and CSV export."""

from __future__ import annotations

import csv
import io
import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from backend_api.common.datetime_utils import utc_iso

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from backend_api.db.models import AppSetting, ErrorEvent, User
from backend_api.db.session import SessionLocal
from backend_api.http.services import plan_service

logger = logging.getLogger(__name__)

ErrorSource = Literal["frontend", "backend", "api"]

SETTING_ENABLED = "error_tracking.enabled"
SETTING_FRONTEND = "error_tracking.frontend"
SETTING_BACKEND = "error_tracking.backend"
SETTING_API = "error_tracking.api"

MESSAGE_MAX = 4096
STACK_MAX = 16384
PATH_MAX = 512
UA_MAX = 512
PAGE_URL_MAX = 1024

SKIP_PATH_PREFIXES = (
    "/api/v1/errors",
    "/api/v1/health",
    "/api/v1/admin/errors",
)


@dataclass(frozen=True)
class ErrorTrackingConfig:
    enabled: bool = False
    frontend: bool = False
    backend: bool = False
    api: bool = False


_cache_lock = threading.Lock()
_config_cache: ErrorTrackingConfig | None = None


def _as_bool(raw: str | None, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _truncate(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def load_config(db: Session) -> ErrorTrackingConfig:
    return ErrorTrackingConfig(
        enabled=_as_bool(plan_service.get_setting(db, SETTING_ENABLED), False),
        frontend=_as_bool(plan_service.get_setting(db, SETTING_FRONTEND), False),
        backend=_as_bool(plan_service.get_setting(db, SETTING_BACKEND), False),
        api=_as_bool(plan_service.get_setting(db, SETTING_API), False),
    )


def get_cached_config() -> ErrorTrackingConfig:
    """Return in-memory config; loads from DB once if cold. Default is disabled."""
    global _config_cache
    with _cache_lock:
        if _config_cache is not None:
            return _config_cache
    db = SessionLocal()
    try:
        cfg = load_config(db)
    except Exception:
        logger.exception("Failed to load error tracking config; treating as disabled")
        cfg = ErrorTrackingConfig()
    finally:
        db.close()
    with _cache_lock:
        _config_cache = cfg
        return _config_cache


def set_cached_config(cfg: ErrorTrackingConfig) -> None:
    global _config_cache
    with _cache_lock:
        _config_cache = cfg


def invalidate_config_cache() -> None:
    global _config_cache
    with _cache_lock:
        _config_cache = None


def refresh_config_cache(db: Session) -> ErrorTrackingConfig:
    cfg = load_config(db)
    set_cached_config(cfg)
    return cfg


def is_enabled() -> bool:
    return get_cached_config().enabled


def should_track(source: ErrorSource) -> bool:
    cfg = get_cached_config()
    if not cfg.enabled:
        return False
    if source == "frontend":
        return cfg.frontend
    if source == "backend":
        return cfg.backend
    if source == "api":
        return cfg.api
    return False


def update_settings(
    db: Session,
    *,
    enabled: bool | None = None,
    frontend: bool | None = None,
    backend: bool | None = None,
    api: bool | None = None,
) -> ErrorTrackingConfig:
    current = load_config(db)
    next_cfg = ErrorTrackingConfig(
        enabled=current.enabled if enabled is None else enabled,
        frontend=current.frontend if frontend is None else frontend,
        backend=current.backend if backend is None else backend,
        api=current.api if api is None else api,
    )
    pairs = (
        (SETTING_ENABLED, next_cfg.enabled),
        (SETTING_FRONTEND, next_cfg.frontend),
        (SETTING_BACKEND, next_cfg.backend),
        (SETTING_API, next_cfg.api),
    )
    for key, flag in pairs:
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        value = "true" if flag else "false"
        if row is None:
            row = AppSetting(key=key, value=value)
        else:
            row.value = value
        db.add(row)
    db.commit()
    set_cached_config(next_cfg)
    return next_cfg


def should_skip_path(path: str) -> bool:
    normalized = path.split("?", 1)[0]
    return any(normalized.startswith(prefix) for prefix in SKIP_PATH_PREFIXES)


def record_error(
    db: Session,
    *,
    source: ErrorSource,
    message: str,
    stack_trace: str | None = None,
    path: str | None = None,
    method: str | None = None,
    status_code: int | None = None,
    user_id: int | None = None,
    user_agent: str | None = None,
    page_url: str | None = None,
    extra: dict[str, Any] | None = None,
) -> ErrorEvent | None:
    if not should_track(source):
        return None
    event = ErrorEvent(
        source=source,
        message=_truncate(message, MESSAGE_MAX) or "(empty)",
        stack_trace=_truncate(stack_trace, STACK_MAX),
        path=_truncate(path, PATH_MAX),
        method=(method or "")[:16] or None,
        status_code=status_code,
        user_id=user_id,
        user_agent=_truncate(user_agent, UA_MAX),
        page_url=_truncate(page_url, PAGE_URL_MAX),
        extra=extra,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def record_error_best_effort(
    *,
    source: ErrorSource,
    message: str,
    stack_trace: str | None = None,
    path: str | None = None,
    method: str | None = None,
    status_code: int | None = None,
    user_id: int | None = None,
    user_agent: str | None = None,
    page_url: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Record without raising; no-op when tracking is off (memory check only)."""
    if not should_track(source):
        return
    db = SessionLocal()
    try:
        record_error(
            db,
            source=source,
            message=message,
            stack_trace=stack_trace,
            path=path,
            method=method,
            status_code=status_code,
            user_id=user_id,
            user_agent=user_agent,
            page_url=page_url,
            extra=extra,
        )
    except Exception:
        logger.exception("Failed to persist error event")
        db.rollback()
    finally:
        db.close()


def list_errors(
    db: Session,
    *,
    user_id: int | None = None,
    source: str | None = None,
    status_code: int | None = None,
    q: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
    limit: int | None = None,
    max_limit: int = 1000,
    page: int = 1,
    page_size: int | None = None,
    sort_by: str | None = None,
    sort_dir: str | None = None,
):
    from backend_api.common.date_range import apply_sql_date_range
    from backend_api.common.pagination import paginate_query
    from backend_api.common.query_sort import apply_sql_order, resolve_sort_key

    query = db.query(ErrorEvent).options(joinedload(ErrorEvent.user))
    if user_id is not None:
        query = query.filter(ErrorEvent.user_id == user_id)
    if source:
        query = query.filter(ErrorEvent.source == source)
    if status_code is not None:
        query = query.filter(ErrorEvent.status_code == status_code)
    if q:
        like = f"%{q.strip()}%"
        query = query.outerjoin(User, User.id == ErrorEvent.user_id).filter(
            or_(
                ErrorEvent.message.ilike(like),
                ErrorEvent.path.ilike(like),
                ErrorEvent.page_url.ilike(like),
                User.email.ilike(like),
            )
        )
    query = apply_sql_date_range(
        query,
        ErrorEvent.created_at,
        date_from=date_from,
        date_to=date_to,
        tz=tz,
    )
    sort_key = resolve_sort_key(
        sort_by,
        ("created_at", "source", "status_code", "path", "message", "user_email"),
        default="created_at",
    )
    if sort_key == "user_email":
        if q is None or not q.strip():
            query = query.outerjoin(User, User.id == ErrorEvent.user_id)
        query = apply_sql_order(
            query,
            {"user_email": User.email},
            sort_by="user_email",
            sort_dir=sort_dir,
            default_key="user_email",
            default_dir="desc",
        )
    else:
        query = apply_sql_order(
            query,
            {
                "created_at": ErrorEvent.created_at,
                "source": ErrorEvent.source,
                "status_code": ErrorEvent.status_code,
                "path": ErrorEvent.path,
                "message": ErrorEvent.message,
            },
            sort_by=sort_key,
            sort_dir=sort_dir,
            default_key="created_at",
            default_dir="desc",
        )
    # Legacy ``limit`` (CSV / older callers) maps to a single-page fetch.
    if page_size is None and limit is not None:
        page_size = max(1, min(limit, max_limit))
        page = 1
    return paginate_query(
        query,
        page=page,
        page_size=page_size,
        max_size=max_limit if page_size is not None else 100,
    )


def _event_row(event: ErrorEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "created_at": utc_iso(event.created_at) if event.created_at else "",
        "source": event.source,
        "message": event.message,
        "stack_trace": event.stack_trace or "",
        "path": event.path or "",
        "method": event.method or "",
        "status_code": event.status_code if event.status_code is not None else "",
        "user_id": event.user_id if event.user_id is not None else "",
        "user_email": event.user.email if event.user is not None else "",
        "user_agent": event.user_agent or "",
        "page_url": event.page_url or "",
    }


def export_csv(
    db: Session,
    *,
    user_id: int | None = None,
    source: str | None = None,
    status_code: int | None = None,
    q: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
    limit: int = 10000,
    sort_by: str | None = None,
    sort_dir: str | None = None,
) -> str:
    events = list_errors(
        db,
        user_id=user_id,
        source=source,
        status_code=status_code,
        q=q,
        date_from=date_from,
        date_to=date_to,
        tz=tz,
        limit=limit,
        max_limit=10000,
        sort_by=sort_by,
        sort_dir=sort_dir,
    ).items
    buffer = io.StringIO()
    fieldnames = [
        "id",
        "created_at",
        "source",
        "message",
        "stack_trace",
        "path",
        "method",
        "status_code",
        "user_id",
        "user_email",
        "user_agent",
        "page_url",
    ]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for event in events:
        writer.writerow(_event_row(event))
    return buffer.getvalue()


def event_to_dict(event: ErrorEvent) -> dict[str, Any]:
    created: datetime | None = event.created_at
    return {
        "id": event.id,
        "source": event.source,
        "message": event.message,
        "stack_trace": event.stack_trace,
        "path": event.path,
        "method": event.method,
        "status_code": event.status_code,
        "user_id": event.user_id,
        "user_email": event.user.email if event.user is not None else None,
        "user_agent": event.user_agent,
        "page_url": event.page_url,
        "extra": event.extra,
        "created_at": utc_iso(created) if created else None,
    }
