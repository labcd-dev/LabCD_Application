"""Trimmer workflow routes."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend_api.db.models import User
from backend_api.http.dependencies import assert_job_access, require_action
from backend_api.http.schemas.common import JobResponse
from backend_api.http.schemas.trimmer import TrimmerInputRequest, TrimmerStartRequest
from backend_api.http.services.events import sse_response
from backend_api.http.services.job_store import job_store
from backend_api.http.services.trimmer_service import (
    get_trimmer_artifacts,
    start_trimmer_job,
    submit_trimmer_input,
)

router = APIRouter(prefix="/trimmer", tags=["trimmer"])


@router.post("/start", response_model=JobResponse)
def start_trimmer(
    request: TrimmerStartRequest,
    user: User = Depends(require_action("module:trimmer")),
) -> JobResponse:
    if not user.has_action("pipeline:mulo"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:mulo")
    job_id = start_trimmer_job(
        request.file_content,
        request.file_name,
        request.model,
        request.trimming_params,
        user_id=user.id,
    )
    job = job_store.get(job_id)
    return JobResponse(job_id=job_id, module=job.module, status=job.status.value)


@router.get("/{job_id}/stream")
def stream_trimmer(
    job_id: str,
    user: User = Depends(require_action("module:trimmer")),
) -> StreamingResponse:
    try:
        job = job_store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    assert_job_access(job, user)
    return sse_response(job_id)


@router.post("/{job_id}/input", response_model=JobResponse)
def trimmer_input(
    job_id: str,
    request: TrimmerInputRequest,
    user: User = Depends(require_action("module:trimmer")),
) -> JobResponse:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        submit_trimmer_input(job_id, request.key, request.prompt, request.answer)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    job = job_store.get(job_id)
    return JobResponse(job_id=job_id, module=job.module, status=job.status.value)


@router.get("/{job_id}/artifacts")
def trimmer_artifacts(
    job_id: str,
    user: User = Depends(require_action("module:trimmer")),
) -> dict:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        return get_trimmer_artifacts(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
