"""SiloDesigner workflow routes."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend_api.db.models import User
from backend_api.http.dependencies import assert_job_access, require_action
from backend_api.http.schemas.common import JobResponse
from backend_api.http.schemas.silo import SiloStartRequest
from backend_api.http.services.events import sse_response
from backend_api.http.services.job_store import job_store
from backend_api.http.services.silo_service import get_silo_monitor_state, start_silo_job

router = APIRouter(prefix="/silo", tags=["silo"])


@router.post("/start", response_model=JobResponse)
def start_silo(
    request: SiloStartRequest,
    user: User = Depends(require_action("module:silo")),
) -> JobResponse:
    if not user.has_action("pipeline:silo"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:silo")
    job_id = start_silo_job(
        request.config,
        request.control_objective or "",
        user_id=user.id,
        project_id=request.project_id,
    )
    job = job_store.get(job_id)
    return JobResponse(job_id=job_id, module=job.module, status=job.status.value)


@router.get("/{job_id}/stream")
def stream_silo(
    job_id: str,
    user: User = Depends(require_action("module:silo")),
) -> StreamingResponse:
    try:
        job = job_store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    assert_job_access(job, user)
    return sse_response(job_id)


@router.get("/{job_id}/monitor")
def silo_monitor(
    job_id: str,
    user: User = Depends(require_action("module:silo")),
) -> dict:
    try:
        job = job_store.get(job_id)
        assert_job_access(job, user)
        return get_silo_monitor_state(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
