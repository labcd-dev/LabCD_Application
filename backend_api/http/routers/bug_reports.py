"""User and admin routes for bug reports."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user, require_admin
from backend_api.http.schemas.bug_reports import (
    BugReportOut,
    BugReportSettings,
    BugReportSettingsUpdate,
    BugReportStatusUpdate,
)
from backend_api.http.services import bug_report_service

router = APIRouter(tags=["bug-reports"])


@router.get("/bug-reports/status", response_model=BugReportSettings)
def get_bug_report_status(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BugReportSettings:
    return bug_report_service.get_settings(db)


@router.post("/bug-reports", response_model=BugReportOut, status_code=status.HTTP_201_CREATED)
async def create_bug_report(
    request: Request,
    description: str = Form(..., min_length=1, max_length=8000),
    page_url: str | None = Form(None, max_length=1024),
    image: UploadFile | None = File(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BugReportOut:
    if not bug_report_service.is_enabled(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bug reporting is currently disabled",
        )

    text = description.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Description is required")

    image_url: str | None = None
    if image is not None and image.filename:
        try:
            image_url = await bug_report_service.save_bug_image(image)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    row = bug_report_service.create_report(
        db,
        user,
        description=text,
        page_url=page_url,
        image_url=image_url,
        user_agent=request.headers.get("user-agent"),
    )
    payload = bug_report_service.to_out(row)
    payload["user_email"] = user.email
    return BugReportOut.model_validate(payload)


@router.get("/admin/bug-reports/settings", response_model=BugReportSettings)
def admin_get_bug_report_settings(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> BugReportSettings:
    return bug_report_service.get_settings(db)


@router.patch("/admin/bug-reports/settings", response_model=BugReportSettings)
def admin_update_bug_report_settings(
    body: BugReportSettingsUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> BugReportSettings:
    return bug_report_service.update_settings(db, enabled=body.enabled)


@router.get("/admin/bug-reports/export.csv")
def admin_export_bug_reports_csv(
    report_status: str | None = Query(None, alias="status", pattern="^(open|fixed|all)$"),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    content = bug_report_service.export_csv(db, status=report_status)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="bug_reports.csv"'},
    )


@router.get("/admin/bug-reports", response_model=list[BugReportOut])
def admin_list_bug_reports(
    report_status: str | None = Query(None, alias="status", pattern="^(open|fixed|all)$"),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[BugReportOut]:
    rows = bug_report_service.list_reports(db, status=report_status)
    return [BugReportOut.model_validate(bug_report_service.to_out(r)) for r in rows]


@router.get("/admin/bug-reports/{report_id}", response_model=BugReportOut)
def admin_get_bug_report(
    report_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> BugReportOut:
    row = bug_report_service.get_report(db, report_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bug report not found")
    return BugReportOut.model_validate(bug_report_service.to_out(row))


@router.patch("/admin/bug-reports/{report_id}", response_model=BugReportOut)
def admin_update_bug_report(
    report_id: int,
    body: BugReportStatusUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> BugReportOut:
    row = bug_report_service.get_report(db, report_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bug report not found")
    updated = bug_report_service.update_status(db, row, body.status)
    return BugReportOut.model_validate(bug_report_service.to_out(updated))
