"""AgentMPC workflow and job routes."""

from __future__ import annotations

import asyncio
import json
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from backend_api.db.models import User
from backend_api.http.dependencies import require_action
from backend_api.http.schemas.mpc import (
    MPCDiagnosticsRequest,
    MPCDiagnosticsResponse,
    MPCDiagnosisChatRequest,
    MPCDiagnosisChatResponse,
    MPCSimulateRequest,
    MPCSimulateResponse,
    MPCJobCreateRequest,
    MPCJobCreateResponse,
    MPCJobResultsResponse,
    MPCJobStatusResponse,
    MPCJobSummary,
    GradeDesignRequest,
)
from backend_api.http.services.mpc_job_store import (
    InMemoryMPCJobStore,
    get_mpc_store,
)
from backend_api.http.services.mpc_service import (
    cancel_job,
    diagnosis_chat,
    get_export_script,
    get_job,
    get_job_report_pdf,
    get_results,
    list_jobs,
    simulate_manual,
    submit_grade,
    submit_job,
    test_dynamics as run_test_dynamics,
)

router = APIRouter(prefix="/mpc", tags=["mpc"])


def _assert_job_access(job_user_id: int | None, user: User) -> None:
    if job_user_id is not None and job_user_id != user.id and not getattr(user, "is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this job")


@router.post(
    "/jobs",
    response_model=MPCJobCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_mpc_job(
    request: MPCJobCreateRequest,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
) -> MPCJobCreateResponse:
    if request.user_id is None:
        request.user_id = user.id
    try:
        return submit_job(request, store=store)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        from backend_api.http.services.credit_service import InsufficientCreditsError

        if isinstance(exc, InsufficientCreditsError):
            raise HTTPException(status_code=402, detail=str(exc)) from exc
        raise


@router.get("/jobs", response_model=list[MPCJobSummary])
def list_mpc_jobs(
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
) -> list[MPCJobSummary]:
    user_id = None if getattr(user, "is_admin", False) else user.id
    return list_jobs(user_id=user_id, store=store)


@router.get("/jobs/{job_id}", response_model=MPCJobStatusResponse)
def get_mpc_job(
    job_id: str,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
) -> MPCJobStatusResponse:
    try:
        res = get_job(job_id, store=store)
        _assert_job_access(res.user_id, user)
        return res
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post("/jobs/{job_id}/cancel", response_model=MPCJobStatusResponse)
def cancel_mpc_job(
    job_id: str,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
) -> MPCJobStatusResponse:
    try:
        record = store.get(job_id)
        if record is None:
            raise KeyError(job_id)
        _assert_job_access(record.user_id, user)
        return cancel_job(job_id, store=store)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.get("/jobs/{job_id}/results", response_model=MPCJobResultsResponse)
def get_mpc_job_results(
    job_id: str,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
) -> MPCJobResultsResponse:
    try:
        record = store.get(job_id)
        if record is None:
            raise KeyError(job_id)
        _assert_job_access(record.user_id, user)
        return get_results(job_id, store=store)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.get("/jobs/{job_id}/events")
async def stream_mpc_job_events(
    job_id: str,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
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
                "iteration": cur.iteration,
                "max_iterations": cur.max_iterations,
                "best_mse": cur.best_mse,
                "best_params": cur.best_params,
                "mse_history": cur.mse_history,
                "params_history": cur.params_history,
                "series": cur.series,
                "baseline_series": cur.baseline_series,
            }
            yield f"event: status\ndata: {json.dumps(status_payload, default=str)}\n\n"

            if cur.status in ("completed", "failed", "cancelled"):
                yield f"event: done\ndata: {json.dumps({'status': cur.status}, default=str)}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/test-dynamics", response_model=MPCDiagnosticsResponse)
def test_mpc_dynamics(
    request: MPCDiagnosticsRequest,
    user: User = Depends(require_action("module:mpc")),
) -> MPCDiagnosticsResponse:
    """Run pre-flight diagnostics: open-loop step response, eigenvalues, controllability, Bryson seeds."""
    return run_test_dynamics(request)


@router.post("/simulate", response_model=MPCSimulateResponse)
def run_manual_mpc_simulation(
    request: MPCSimulateRequest,
    user: User = Depends(require_action("module:mpc")),
) -> MPCSimulateResponse:
    """Interactive simulation sandbox: run instant closed-loop MPC simulation."""
    return simulate_manual(request)


@router.get("/jobs/{job_id}/export-script")
def download_export_script(
    job_id: str,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
):
    """Download standalone reproducible Python script."""
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    _assert_job_access(record.user_id, user)
    try:
        script_code = get_export_script(job_id, store=store)
        filename = f"{record.system_name or 'mpc_system'}_export.py"
        return StreamingResponse(
            iter([script_code]),
            media_type="text/x-python",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/report.pdf")
def download_report_pdf(
    job_id: str,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
):
    """Download engineering PDF report."""
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    _assert_job_access(record.user_id, user)
    try:
        pdf_bytes = get_job_report_pdf(job_id, store=store)
        filename = f"{record.system_name or 'mpc_system'}_report.pdf"
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/grade")
def grade_mpc_job(
    job_id: str,
    request: GradeDesignRequest,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
):
    """Submit 1-5 star user design grade for an MPC run."""
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    _assert_job_access(record.user_id, user)
    return submit_grade(job_id, rating=request.rating, comment=request.comment, user=user, store=store)


@router.post("/jobs/{job_id}/diagnosis/chat", response_model=MPCDiagnosisChatResponse)
def mpc_diagnosis_chat(
    job_id: str,
    request: MPCDiagnosisChatRequest,
    user: User = Depends(require_action("module:mpc")),
    store: InMemoryMPCJobStore = Depends(get_mpc_store),
) -> MPCDiagnosisChatResponse:
    """Follow-up chat about stored AgentMPC diagnostics for a job."""
    record = store.get(job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    _assert_job_access(record.user_id, user)
    try:
        out = diagnosis_chat(
            job_id,
            request.message,
            history=request.history,
            store=store,
        )
        return MPCDiagnosisChatResponse(reply=out["reply"], usage=out.get("usage"))
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Diagnosis chat failed: {exc}",
        ) from exc

