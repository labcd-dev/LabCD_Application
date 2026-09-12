"""Public error tracking endpoints (config + frontend report)."""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import APIRouter, Depends, Request, Response, status

from backend_api.db.models import User
from backend_api.http.dependencies import get_optional_user
from backend_api.http.schemas.error_tracking import ErrorReportRequest, ErrorTrackingSettings
from backend_api.http.services import error_tracking_service

router = APIRouter(prefix="/errors", tags=["errors"])

_ip_report_timestamps: dict[str, list[float]] = defaultdict(list)
_MAX_REPORTS_PER_WINDOW = 10
_WINDOW_SECONDS = 60.0


def _is_rate_limited(ip: str) -> bool:
    now = time.time()
    cutoff = now - _WINDOW_SECONDS
    timestamps = [t for t in _ip_report_timestamps[ip] if t > cutoff]
    if len(timestamps) >= _MAX_REPORTS_PER_WINDOW:
        _ip_report_timestamps[ip] = timestamps
        return True
    timestamps.append(now)
    _ip_report_timestamps[ip] = timestamps

    if len(_ip_report_timestamps) > 1000:
        for k in list(_ip_report_timestamps.keys()):
            if not _ip_report_timestamps[k] or _ip_report_timestamps[k][-1] <= cutoff:
                _ip_report_timestamps.pop(k, None)
    return False


@router.get("/config", response_model=ErrorTrackingSettings)
def get_error_tracking_config() -> ErrorTrackingSettings:
    cfg = error_tracking_service.get_cached_config()
    return ErrorTrackingSettings(
        enabled=cfg.enabled,
        frontend=cfg.frontend,
        backend=cfg.backend,
        api=cfg.api,
    )


@router.post("/report", status_code=status.HTTP_204_NO_CONTENT)
def report_frontend_error(
    body: ErrorReportRequest,
    request: Request,
    user: User | None = Depends(get_optional_user),
) -> Response:
    if not error_tracking_service.should_track("frontend"):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    client_ip = request.client.host if request.client else "unknown"
    if _is_rate_limited(client_ip):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    error_tracking_service.record_error_best_effort(
        source="frontend",
        message=body.message,
        stack_trace=body.stack_trace,
        path=body.path,
        method=body.method,
        status_code=body.status_code,
        user_id=user.id if user else None,
        user_agent=request.headers.get("user-agent"),
        page_url=body.page_url,
        extra=body.extra,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
