"""AgentAdaptive workflow and job routes."""

from __future__ import annotations

import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from backend_api.db.models import User
from backend_api.http.dependencies import require_action
from backend_api.http.schemas.adaptive import (
    AdaptiveClarifyRequest,
    AdaptiveClarifyResponse,
    AdaptiveJobCreateRequest,
    AdaptiveJobCreateResponse,
    AdaptiveJobResultsResponse,
    AdaptiveJobStatusResponse,
    AdaptiveJobSummary,
)
from backend_api.http.services.adaptive_job_store import (
    InMemoryAdaptiveJobStore,
    get_adaptive_store,
)
from backend_api.http.services.adaptive_service import (
    cancel_job,
    clarify_job,
    get_job,
    get_results,
    list_jobs,
    submit_job,
)

router = APIRouter(prefix="/adaptive", tags=["adaptive"])


def _assert_job_access(job_user_id: int | None, user: User) -> None:
    if job_user_id is not None and job_user_id != user.id and not getattr(user, "is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this job")


@router.post(
    "/jobs",
    response_model=AdaptiveJobCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_adaptive_job(
    request: AdaptiveJobCreateRequest,
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> AdaptiveJobCreateResponse:
    if request.user_id is None:
        request.user_id = user.id
    return submit_job(request, store=store)


@router.get("/jobs", response_model=list[AdaptiveJobSummary])
def list_adaptive_jobs(
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> list[AdaptiveJobSummary]:
    user_id = None if getattr(user, "is_admin", False) else user.id
    return list_jobs(user_id=user_id, store=store)


@router.get("/jobs/{job_id}", response_model=AdaptiveJobStatusResponse)
def get_adaptive_job(
    job_id: str,
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> AdaptiveJobStatusResponse:
    try:
        res = get_job(job_id, store=store)
        _assert_job_access(res.user_id, user)
        return res
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post("/jobs/{job_id}/clarify", response_model=AdaptiveClarifyResponse)
def clarify_adaptive_job(
    job_id: str,
    request: AdaptiveClarifyRequest,
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> AdaptiveClarifyResponse:
    try:
        record = store.get(job_id)
        if record is None:
            raise KeyError(job_id)
        _assert_job_access(record.user_id, user)
        return clarify_job(job_id, request, store=store)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post("/jobs/{job_id}/cancel", response_model=AdaptiveJobStatusResponse)
def cancel_adaptive_job(
    job_id: str,
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> AdaptiveJobStatusResponse:
    try:
        record = store.get(job_id)
        if record is None:
            raise KeyError(job_id)
        _assert_job_access(record.user_id, user)
        return cancel_job(job_id, store=store)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.get("/jobs/{job_id}/results", response_model=AdaptiveJobResultsResponse)
def get_adaptive_job_results(
    job_id: str,
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> AdaptiveJobResultsResponse:
    try:
        record = store.get(job_id)
        if record is None:
            raise KeyError(job_id)
        _assert_job_access(record.user_id, user)
        return get_results(job_id, store=store)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.get("/jobs/{job_id}/events")
async def stream_adaptive_job_events(
    job_id: str,
    user: User = Depends(require_action("module:adaptive")),
    store: InMemoryAdaptiveJobStore = Depends(get_adaptive_store),
) -> StreamingResponse:
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    _assert_job_access(record.user_id, user)

    async def event_generator():
        last_index = 0
        while True:
            cur = store.get(job_id)
            if cur is None:
                break
            progress = cur.progress or []
            if len(progress) > last_index:
                for ev in progress[last_index:]:
                    yield f"event: progress\ndata: {json.dumps(ev, default=str)}\n\n"
                last_index = len(progress)

            status_payload = {
                "status": cur.status,
                "stage": cur.stage,
                "message": cur.message,
                "round": cur.clarify_round,
                "clarify_pending": cur.status == "clarifying",
            }
            yield f"event: status\ndata: {json.dumps(status_payload, default=str)}\n\n"

            if cur.status in ("completed", "failed", "cancelled"):
                yield f"event: done\ndata: {json.dumps({'status': cur.status}, default=str)}\n\n"
                break
            await asyncio.sleep(0.6)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

