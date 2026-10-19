"""Thin wrappers that start module jobs for the developer API."""

from __future__ import annotations

from typing import Any

from backend_api.db.models import User
from backend_api.http.schemas.adaptive import AdaptiveJobCreateRequest, AdaptiveJobOptions
from backend_api.http.schemas.mpc import MPCJobCreateRequest
from backend_api.http.schemas.mulo import MuloStartRequest
from backend_api.http.schemas.silo import SiloStartRequest
from backend_api.http.services import adaptive_service, mpc_service
from backend_api.http.services.adaptive_job_store import get_adaptive_store
from backend_api.http.services.job_store import JobStatus, job_store
from backend_api.http.services.mpc_job_store import get_mpc_store
from backend_api.http.services.mulo_service import start_mulo_job
from backend_api.http.services.silo_service import start_silo_job


COMPLETED_STATUSES = frozenset({"completed", "failed", "cancelled"})


def start_silo(request: SiloStartRequest, user: User) -> dict[str, Any]:
    job_id = start_silo_job(
        request.config,
        request.control_objective or "",
        user_id=user.id,
        project_id=request.project_id,
        created_via="api",
    )
    job = job_store.get(job_id)
    return {
        "job_id": job_id,
        "module": "silo",
        "status": job.status.value,
        "message": "SILO job started",
    }


def start_mulo(request: MuloStartRequest, user: User) -> dict[str, Any]:
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
        created_via="api",
    )
    job = job_store.get(job_id)
    return {
        "job_id": job_id,
        "module": "mulo",
        "status": job.status.value,
        "message": "MULO job started",
    }


def start_adaptive(request: AdaptiveJobCreateRequest, user: User) -> dict[str, Any]:
    options = request.options.model_copy(deep=True) if request.options else AdaptiveJobOptions()
    options.skip_clarify = True
    payload = AdaptiveJobCreateRequest(
        system_spec=request.system_spec,
        options=options,
        user_id=user.id,
        project_id=request.project_id,
    )
    created = adaptive_service.submit_job(
        payload, store=get_adaptive_store(), created_via="api"
    )
    return {
        "job_id": created.job_id,
        "module": "adaptive",
        "status": created.status,
        "message": created.message or "Adaptive job started",
    }


def start_mpc(request: MPCJobCreateRequest, user: User) -> dict[str, Any]:
    payload = MPCJobCreateRequest(
        dynamics=request.dynamics,
        options=request.options,
        user_id=user.id,
        project_id=request.project_id,
    )
    created = mpc_service.submit_job(payload, store=get_mpc_store(), created_via="api")
    return {
        "job_id": created.job_id,
        "module": "mpc",
        "status": created.status,
        "message": created.message or "MPC job started",
    }


def _assert_owner(job_user_id: int | None, user: User) -> None:
    if job_user_id is not None and job_user_id != user.id and not getattr(user, "is_admin", False):
        raise PermissionError("Access denied to this job")


def get_job_status(job_id: str, user: User) -> dict[str, Any]:
    adaptive_store = get_adaptive_store()
    adaptive_rec = adaptive_store.get(job_id)
    if adaptive_rec is not None:
        _assert_owner(adaptive_rec.user_id, user)
        status = adaptive_service.get_job(job_id, store=adaptive_store)
        return {
            "job_id": status.job_id,
            "module": "adaptive",
            "status": status.status,
            "stage": status.stage,
            "error": status.error,
            "metadata": {},
        }

    mpc_store = get_mpc_store()
    mpc_rec = mpc_store.get(job_id)
    if mpc_rec is not None:
        _assert_owner(mpc_rec.user_id, user)
        status = mpc_service.get_job(job_id, store=mpc_store)
        return {
            "job_id": status.job_id,
            "module": "mpc",
            "status": status.status,
            "stage": status.stage,
            "error": status.error,
            "metadata": {},
        }

    try:
        job = job_store.get(job_id)
    except KeyError as exc:
        raise KeyError(job_id) from exc
    _assert_owner(job.user_id, user)
    return {
        "job_id": job.id,
        "module": job.module,
        "status": job.status.value,
        "stage": None,
        "error": job.error,
        "metadata": job_store.public_metadata(job),
    }


def get_job_results(job_id: str, user: User) -> dict[str, Any]:
    adaptive_store = get_adaptive_store()
    adaptive_rec = adaptive_store.get(job_id)
    if adaptive_rec is not None:
        _assert_owner(adaptive_rec.user_id, user)
        if adaptive_rec.status not in COMPLETED_STATUSES:
            raise RuntimeError("Job is still running")
        results = adaptive_service.get_results(job_id, store=adaptive_store)
        return {
            "job_id": job_id,
            "module": "adaptive",
            "status": adaptive_rec.status,
            "results": results.model_dump(),
        }

    mpc_store = get_mpc_store()
    mpc_rec = mpc_store.get(job_id)
    if mpc_rec is not None:
        _assert_owner(mpc_rec.user_id, user)
        if mpc_rec.status not in COMPLETED_STATUSES:
            raise RuntimeError("Job is still running")
        results = mpc_service.get_results(job_id, store=mpc_store)
        return {
            "job_id": job_id,
            "module": "mpc",
            "status": mpc_rec.status,
            "results": results.model_dump(),
        }

    try:
        job = job_store.get(job_id)
    except KeyError as exc:
        raise KeyError(job_id) from exc
    _assert_owner(job.user_id, user)
    if job.status not in (
        JobStatus.COMPLETED,
        JobStatus.FAILED,
        JobStatus.CANCELLED,
    ):
        raise RuntimeError("Job is still running")

    artifacts: dict[str, Any] = {}
    if job.module == "silo":
        artifacts = {"monitor_state": job.metadata.get("monitor_state", {})}
    elif job.module == "mulo":
        artifacts = {
            "plot_data": job.metadata.get("plot_data", {}),
            "final_state": job.metadata.get("final_state"),
        }
    else:
        artifacts = dict(job.metadata.get("artifacts") or {})

    return {
        "job_id": job_id,
        "module": job.module,
        "status": job.status.value,
        "results": artifacts,
    }
