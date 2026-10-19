"""Developer platform: API-key job endpoints + JWT key metadata."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import (
    assert_model_allowed,
    get_current_user,
    get_user_from_api_key,
    require_api_key_action,
)
from backend_api.http.schemas.adaptive import AdaptiveJobCreateRequest
from backend_api.http.schemas.developer import (
    DeveloperApiKeyMetaOut,
    DeveloperJobResponse,
    DeveloperJobResultsOut,
    DeveloperJobStatusOut,
)
from backend_api.http.schemas.mpc import MPCJobCreateRequest
from backend_api.http.schemas.mulo import MuloStartRequest
from backend_api.http.schemas.silo import SiloStartRequest
from backend_api.http.services import developer_api_key_service, developer_api_service, project_service
from backend_api.http.services.credit_service import InsufficientCreditsError

router = APIRouter(tags=["developer"])


def _credits_http(exc: Exception) -> HTTPException | None:
    if isinstance(exc, InsufficientCreditsError):
        return HTTPException(status_code=402, detail=str(exc))
    return None


@router.get("/developer/me", response_model=DeveloperApiKeyMetaOut | None)
def get_my_developer_key(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeveloperApiKeyMetaOut | None:
    meta = developer_api_key_service.get_key_metadata(db, user.id)
    if meta is None:
        return None
    return DeveloperApiKeyMetaOut(**meta)


@router.post("/dev/silo", response_model=DeveloperJobResponse, status_code=status.HTTP_201_CREATED)
def dev_start_silo(
    request: SiloStartRequest,
    user: User = Depends(require_api_key_action("module:silo")),
    db: Session = Depends(get_db),
) -> DeveloperJobResponse:
    if not user.has_action("pipeline:silo"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:silo")
    assert_model_allowed(user, request.config.get("llm_model") if request.config else None)
    try:
        project_service.assert_project_llm_model(
            db, request.project_id, (request.config or {}).get("llm_model")
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        result = developer_api_service.start_silo(request, user)
    except Exception as exc:
        http_exc = _credits_http(exc)
        if http_exc:
            raise http_exc from exc
        raise
    return DeveloperJobResponse(**result)


@router.post("/dev/mulo", response_model=DeveloperJobResponse, status_code=status.HTTP_201_CREATED)
def dev_start_mulo(
    request: MuloStartRequest,
    user: User = Depends(require_api_key_action("module:mulo")),
    db: Session = Depends(get_db),
) -> DeveloperJobResponse:
    if not user.has_action("pipeline:mulo"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:mulo")
    model = (request.run_config or {}).get("llm_model")
    assert_model_allowed(user, model)
    try:
        project_service.assert_project_llm_model(db, request.project_id, model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        result = developer_api_service.start_mulo(request, user)
    except Exception as exc:
        http_exc = _credits_http(exc)
        if http_exc:
            raise http_exc from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DeveloperJobResponse(**result)


@router.post(
    "/dev/adaptive",
    response_model=DeveloperJobResponse,
    status_code=status.HTTP_201_CREATED,
)
def dev_start_adaptive(
    request: AdaptiveJobCreateRequest,
    user: User = Depends(require_api_key_action("module:adaptive")),
) -> DeveloperJobResponse:
    if not user.has_action("pipeline:adaptive"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:adaptive")
    model = request.options.model if request.options else None
    assert_model_allowed(user, model)
    try:
        result = developer_api_service.start_adaptive(request, user)
    except Exception as exc:
        http_exc = _credits_http(exc)
        if http_exc:
            raise http_exc from exc
        raise
    return DeveloperJobResponse(**result)


@router.post("/dev/mpc", response_model=DeveloperJobResponse, status_code=status.HTTP_201_CREATED)
def dev_start_mpc(
    request: MPCJobCreateRequest,
    user: User = Depends(require_api_key_action("module:mpc")),
) -> DeveloperJobResponse:
    if not user.has_action("pipeline:mpc"):
        raise HTTPException(status_code=403, detail="Missing required action: pipeline:mpc")
    model = request.options.model if request.options else None
    assert_model_allowed(user, model)
    try:
        result = developer_api_service.start_mpc(request, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        http_exc = _credits_http(exc)
        if http_exc:
            raise http_exc from exc
        raise
    return DeveloperJobResponse(**result)


@router.get("/dev/jobs/{job_id}", response_model=DeveloperJobStatusOut)
def dev_job_status(
    job_id: str,
    user: User = Depends(get_user_from_api_key),
) -> DeveloperJobStatusOut:
    try:
        result = developer_api_service.get_job_status(job_id, user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return DeveloperJobStatusOut(**result)


@router.get("/dev/jobs/{job_id}/results", response_model=DeveloperJobResultsOut)
def dev_job_results(
    job_id: str,
    user: User = Depends(get_user_from_api_key),
) -> DeveloperJobResultsOut:
    try:
        result = developer_api_service.get_job_results(job_id, user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return DeveloperJobResultsOut(**result)
