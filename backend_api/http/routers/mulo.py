"""MuloDesigner workflow routes."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend_api.db.models import User
from backend_api.http.dependencies import assert_job_access, require_action
from backend_api.http.schemas.common import JobResponse
from backend_api.http.schemas.mulo import (
    MuloConfigureRequest,
    MuloContinueRequest,
    MuloDesignerStateResponse,
    MuloInitRequest,
    MuloScratchpadRequest,
    MuloSimulateRequest,
    MuloStartRequest,
)
from backend_api.http.services.events import sse_response
from backend_api.http.services.job_store import job_store
from backend_api.http.services.mulo_service import (
    configure_mulo_job,
    continue_mulo_loop,
    get_mulo_designer_state,
    get_mulo_plot_data,
    init_mulo_designer,
    run_mulo_optimization,
    simulate_mulo_response,
    start_mulo_job,
    update_mulo_scratchpad,
)

router = APIRouter(prefix="/mulo", tags=["mulo"])


def _job_response(job_id: str) -> JobResponse:
    job = job_store.get(job_id)
    return JobResponse(job_id=job_id, module=job.module, status=job.status.value)


def _mulo_user(user: User = Depends(require_action("module:mulo"))) -> User:
    if not user.has_action("pipeline:mulo"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:mulo")
    return user


def _owned_job(job_id: str, user: User):
    job = job_store.get(job_id)
    assert_job_access(job, user)
    return job


@router.post("/init", response_model=JobResponse)
def init_mulo(
    request: MuloInitRequest,
    user: User = Depends(_mulo_user),
) -> JobResponse:
    try:
        job_id = init_mulo_designer(
            request.run_config,
            request.controller_structure,
            request.system_identification,
            request.trimming_result,
            request.equation,
            user_id=user.id,
            project_id=request.project_id,
            file_name=request.file_name or "",
            file_type=request.file_type or "python",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_response(job_id)


@router.post("/start", response_model=JobResponse)
def start_mulo(
    request: MuloStartRequest,
    user: User = Depends(_mulo_user),
) -> JobResponse:
    try:
        job_id = start_mulo_job(
            request.run_config,
            request.controller_structure,
            request.system_identification,
            request.trimming_result,
            request.equation,
            user_id=user.id,
            project_id=request.project_id,
            file_name=request.file_name or "",
            file_type=request.file_type or "python",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_response(job_id)


@router.post("/{job_id}/configure", response_model=JobResponse)
def configure_mulo(
    job_id: str,
    request: MuloConfigureRequest,
    user: User = Depends(_mulo_user),
) -> JobResponse:
    try:
        _owned_job(job_id, user)
        configure_mulo_job(job_id, request.case_study, request.controller_structure)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_response(job_id)


@router.post("/{job_id}/run", response_model=JobResponse)
def run_mulo(
    job_id: str,
    user: User = Depends(_mulo_user),
) -> JobResponse:
    try:
        _owned_job(job_id, user)
        run_mulo_optimization(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return _job_response(job_id)


@router.post("/{job_id}/scratchpad", response_model=JobResponse)
def update_scratchpad(
    job_id: str,
    request: MuloScratchpadRequest,
    user: User = Depends(_mulo_user),
) -> JobResponse:
    try:
        _owned_job(job_id, user)
        update_mulo_scratchpad(
            job_id,
            request.modified_code,
            request.modified_controller_structure,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return _job_response(job_id)


@router.post("/{job_id}/continue", response_model=JobResponse)
def continue_mulo(
    job_id: str,
    request: MuloContinueRequest,
    user: User = Depends(_mulo_user),
) -> JobResponse:
    try:
        _owned_job(job_id, user)
        continue_mulo_loop(job_id, request.equation, request.controller_structure)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _job_response(job_id)


@router.get("/{job_id}/state", response_model=MuloDesignerStateResponse)
def mulo_designer_state(
    job_id: str,
    user: User = Depends(_mulo_user),
) -> MuloDesignerStateResponse:
    try:
        _owned_job(job_id, user)
        return MuloDesignerStateResponse(**get_mulo_designer_state(job_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@router.post("/{job_id}/simulate")
def mulo_simulate(
    job_id: str,
    request: MuloSimulateRequest,
    user: User = Depends(_mulo_user),
) -> dict:
    try:
        _owned_job(job_id, user)
        return simulate_mulo_response(
            job_id,
            request.kp,
            request.ki,
            request.kd,
            request.signal_type,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{job_id}/stream")
def stream_mulo(
    job_id: str,
    user: User = Depends(_mulo_user),
) -> StreamingResponse:
    try:
        _owned_job(job_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return sse_response(job_id)


@router.get("/{job_id}/plot-data")
def mulo_plot_data(
    job_id: str,
    user: User = Depends(_mulo_user),
) -> dict:
    try:
        _owned_job(job_id, user)
        return get_mulo_plot_data(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
