"""Recommender workflow routes."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend_api.db.models import User
from backend_api.http.dependencies import assert_job_access, require_action
from backend_api.http.schemas.common import JobResponse
from backend_api.http.schemas.recommender import (
    RagDecisionRequest,
    RecommenderHandoffRequest,
    RecommenderHandoffResponse,
    RecommenderStartRequest,
)
from backend_api.http.services.events import sse_response
from backend_api.http.services.job_store import job_store
from backend_api.http.services.recommender_service import (
    assess_rag,
    build_trimmer_handoff,
    get_recommender_state,
    start_recommender_job,
    submit_rag_decision,
)

router = APIRouter(prefix="/recommender", tags=["recommender"])


def _require_mulo_pipeline(user: User) -> None:
    if not user.has_action("pipeline:mulo"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:mulo")


@router.post("/start", response_model=JobResponse)
def start_recommender(
    request: RecommenderStartRequest,
    user: User = Depends(require_action("module:recommender")),
) -> JobResponse:
    _require_mulo_pipeline(user)
    job_id = start_recommender_job(
        request.file_content,
        request.file_name,
        request.model,
        request.step,
        user_id=user.id,
    )
    job = job_store.get(job_id)
    return JobResponse(job_id=job_id, module=job.module, status=job.status.value)


@router.get("/{job_id}/stream")
def stream_recommender(
    job_id: str,
    user: User = Depends(require_action("module:recommender")),
) -> StreamingResponse:
    try:
        job = job_store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    assert_job_access(job, user)
    return sse_response(job_id)


@router.get("/{job_id}/state")
def recommender_state(
    job_id: str,
    user: User = Depends(require_action("module:recommender")),
) -> dict:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        return get_recommender_state(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@router.post("/{job_id}/rag-decision", response_model=JobResponse)
def recommender_rag_decision(
    job_id: str,
    request: RagDecisionRequest,
    user: User = Depends(require_action("module:recommender")),
) -> JobResponse:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        rag_job_id = submit_rag_decision(job_id, request.flags, request.model)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    job = job_store.get(rag_job_id)
    return JobResponse(job_id=rag_job_id, module=job.module, status=job.status.value)


@router.get("/{job_id}/rag-status")
def recommender_rag_status(
    job_id: str,
    user: User = Depends(require_action("module:recommender")),
) -> dict:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        return assess_rag(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@router.post("/{job_id}/handoff", response_model=RecommenderHandoffResponse)
def recommender_handoff(
    job_id: str,
    request: RecommenderHandoffRequest,
    user: User = Depends(require_action("module:recommender")),
) -> RecommenderHandoffResponse:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        handoff = build_trimmer_handoff(job_id, request.chosen_controller)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RecommenderHandoffResponse(**handoff)
