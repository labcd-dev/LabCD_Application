"""Middleware that records API 4xx/5xx and uncaught backend exceptions when enabled."""

from __future__ import annotations

import traceback

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from backend_api.http.services import error_tracking_service


class ErrorTrackingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        track_api = error_tracking_service.should_track("api")
        track_backend = error_tracking_service.should_track("backend")

        # Memory-only gate: skip all work when both collectors are off.
        if not track_api and not track_backend:
            return await call_next(request)

        path = request.url.path
        skip = error_tracking_service.should_skip_path(path)

        try:
            response = await call_next(request)
        except Exception as exc:
            if track_backend and not skip:
                request.state.error_tracked_as_backend = True
                error_tracking_service.record_error_best_effort(
                    source="backend",
                    message=f"{type(exc).__name__}: {exc}",
                    stack_trace="".join(
                        traceback.format_exception(type(exc), exc, exc.__traceback__)
                    ),
                    path=path,
                    method=request.method,
                    status_code=500,
                    user_agent=request.headers.get("user-agent"),
                )
            raise

        if not track_api:
            return response

        if getattr(request.state, "error_tracked_as_backend", False):
            return response

        status_code = response.status_code
        # Skip successful responses, normal client auth/validation statuses, and ignored paths
        if status_code < 400 or status_code in {401, 402, 403, 404, 422} or skip:
            return response

        error_tracking_service.record_error_best_effort(
            source="api",
            message=f"HTTP {status_code} {request.method} {path}",
            path=path,
            method=request.method,
            status_code=status_code,
            user_agent=request.headers.get("user-agent"),
        )
        return response
