"""Create and manage user-submitted bug reports."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import UploadFile
from sqlalchemy.orm import Session, joinedload

from backend_api.db.models import BugReport, User
from backend_api.http.config import API_PREFIX, UPLOADS_DIR
from backend_api.http.schemas.bug_reports import BugReportSettings
from backend_api.http.services import plan_service

SETTING_ENABLED = "bug_reports.enabled"

BUG_REPORTS_DIR = UPLOADS_DIR / "bug-reports"
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def is_enabled(db: Session) -> bool:
    raw = plan_service.get_setting(db, SETTING_ENABLED)
    if raw is None:
        return True
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def get_settings(db: Session) -> BugReportSettings:
    return BugReportSettings(enabled=is_enabled(db))


def update_settings(db: Session, *, enabled: bool | None) -> BugReportSettings:
    if enabled is not None:
        plan_service.set_setting(db, SETTING_ENABLED, "true" if enabled else "false")
    return get_settings(db)


async def save_bug_image(file: UploadFile) -> str:
    content_type = (file.content_type or "").lower()
    extension = ALLOWED_IMAGE_TYPES.get(content_type)
    if extension is None:
        raise ValueError("Image must be JPEG, PNG, WebP, or GIF")

    data = await file.read()
    if not data:
        raise ValueError("Image file is empty")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be 5 MB or smaller")

    BUG_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"bug-{uuid.uuid4().hex[:12]}{extension}"
    path = BUG_REPORTS_DIR / filename
    path.write_bytes(data)
    return f"{API_PREFIX}/uploads/bug-reports/{filename}"


def create_report(
    db: Session,
    user: User,
    *,
    description: str,
    page_url: str | None = None,
    image_url: str | None = None,
    user_agent: str | None = None,
) -> BugReport:
    text = description.strip()
    title = text.split("\n", 1)[0].strip()[:200] or "Bug report"
    now = datetime.now(timezone.utc)
    row = BugReport(
        user_id=user.id,
        title=title,
        description=text,
        page_url=(page_url or "").strip() or None,
        image_url=image_url,
        user_agent=(user_agent or "").strip() or None,
        status="open",
        admin_notes="",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_reports(db: Session, *, status: str | None = None) -> list[BugReport]:
    query = db.query(BugReport).options(joinedload(BugReport.user))
    if status and status != "all":
        query = query.filter(BugReport.status == status)
    return query.order_by(BugReport.created_at.desc()).all()


def get_report(db: Session, report_id: int) -> BugReport | None:
    return (
        db.query(BugReport)
        .options(joinedload(BugReport.user))
        .filter(BugReport.id == report_id)
        .first()
    )


def update_status(db: Session, report: BugReport, status: str) -> BugReport:
    now = datetime.now(timezone.utc)
    report.status = status
    report.updated_at = now
    if status == "fixed":
        report.fixed_at = now
    else:
        report.fixed_at = None
    db.commit()
    db.refresh(report)
    return report


def to_out(report: BugReport) -> dict:
    return {
        "id": report.id,
        "user_id": report.user_id,
        "user_email": report.user.email if report.user is not None else None,
        "description": report.description,
        "image_url": report.image_url,
        "page_url": report.page_url,
        "status": report.status,
        "created_at": report.created_at,
        "fixed_at": report.fixed_at,
    }


def export_csv(db: Session, *, status: str | None = None) -> str:
    rows = list_reports(db, status=status)
    buffer = io.StringIO()
    fieldnames = [
        "id",
        "created_at",
        "fixed_at",
        "status",
        "user_id",
        "user_email",
        "title",
        "description",
        "page_url",
        "image_url",
        "user_agent",
    ]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for report in rows:
        writer.writerow(
            {
                "id": report.id,
                "created_at": report.created_at.isoformat() if report.created_at else "",
                "fixed_at": report.fixed_at.isoformat() if report.fixed_at else "",
                "status": report.status,
                "user_id": report.user_id,
                "user_email": report.user.email if report.user is not None else "",
                "title": report.title,
                "description": report.description,
                "page_url": report.page_url or "",
                "image_url": report.image_url or "",
                "user_agent": report.user_agent or "",
            }
        )
    return buffer.getvalue()
