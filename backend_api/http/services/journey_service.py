"""Aggregate jobs, audit, survey, and related data into a user journey timeline."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy.orm import Session

from backend_api.common.datetime_utils import as_utc, utc_iso
from backend_api.db.models import (
    AdaptiveJobRecord,
    AnalyticsEvent,
    AuditLog,
    BugReport,
    CreditUsageSession,
    ErrorEvent,
    FeedbackSurveyResponse,
    LoginHistory,
    MPCJobRecord,
    Project,
)
from backend_api.http.services.auth_service import get_user_by_id

JourneyStatus = Literal["ok", "fail", "info"]

PIPELINE_LABELS = {
    "siloDesign": "SILO",
    "muloDesign": "MULO",
    "adaptiveDesign": "Adaptive",
    "mpcDesign": "MPC",
}

AUTH_AUDIT_ACTIONS = frozenset(
    {
        "auth.register",
        "auth.verify_email",
        "auth.lockout",
        "auth.forgot_password",
        "auth.reset_password",
        "auth.change_password",
        "auth.session.revoke",
        "auth.sso.start",
        "auth.sso.callback",
    }
)


def _ts(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return as_utc(value)


def _step(
    *,
    kind: str,
    title: str,
    timestamp: datetime,
    status: JourneyStatus = "info",
    duration_seconds: int | None = None,
    detail: str | None = None,
    error: str | None = None,
    source_id: str | None = None,
    id_suffix: str = "",
) -> dict[str, Any]:
    stamp = utc_iso(timestamp)
    sid = source_id or ""
    return {
        "id": f"{kind}:{sid}:{stamp}{id_suffix}",
        "kind": kind,
        "title": title,
        "timestamp": stamp,
        "status": status,
        "duration_seconds": duration_seconds,
        "detail": detail,
        "error": error,
        "source_id": source_id,
        "_sort": _ts(timestamp) or datetime.min.replace(tzinfo=timezone.utc),
    }


def _parse_progress_ts(raw: Any, fallback: datetime) -> datetime:
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(float(raw), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return fallback
    if isinstance(raw, str) and raw.strip():
        try:
            return as_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))
        except ValueError:
            return fallback
    return fallback


def _project_grade(project: Project) -> dict[str, Any] | None:
    res = project.results if isinstance(project.results, dict) else {}
    grade = res.get("design_grade")
    if isinstance(grade, dict):
        return grade
    session_meta = res.get("session_metadata")
    if isinstance(session_meta, dict):
        nested = session_meta.get("design_grade")
        if isinstance(nested, dict):
            return nested
    return None


def _grade_comment_texts(projects: list[Project]) -> set[str]:
    texts: set[str] = set()
    for project in projects:
        grade = _project_grade(project)
        if not grade:
            continue
        comment = str(grade.get("comment") or "").strip()
        if comment:
            texts.add(comment)
    return texts


def _is_mirrored_grade_feedback(row: FeedbackSurveyResponse, grade_texts: set[str]) -> bool:
    text = (row.main_problems or "").strip()
    if not text or text not in grade_texts:
        return False
    scales = [
        row.satisfaction,
        row.ease_of_use,
        row.product_value,
        row.confidence,
        row.reuse_intention,
        row.willingness_to_pay,
    ]
    return len(set(scales)) == 1


def get_user_journey(db: Session, user_id: int) -> dict[str, Any] | None:
    user = get_user_by_id(db, user_id)
    if user is None:
        return None

    steps: list[dict[str, Any]] = []
    comments: list[dict[str, Any]] = []

    # Registration
    if user.created_at is not None:
        steps.append(
            _step(
                kind="registered",
                title="Signed up",
                timestamp=user.created_at,
                status="ok",
                source_id=str(user.id),
            )
        )

    # Auth audit (skip register when we already have signup from User)
    audit_rows = (
        db.query(AuditLog)
        .filter(
            AuditLog.actor_user_id == user_id,
            AuditLog.action.in_(AUTH_AUDIT_ACTIONS),
        )
        .order_by(AuditLog.created_at.asc())
        .all()
    )
    register_window_start = _ts(user.created_at)
    for row in audit_rows:
        if row.action == "auth.register" and register_window_start is not None:
            ts = _ts(row.created_at)
            if ts is not None and abs((ts - register_window_start).total_seconds()) < 120:
                continue
        status: JourneyStatus = "ok" if row.success else "fail"
        title = row.action.replace("auth.", "").replace("_", " ").title()
        if row.action == "auth.verify_email":
            kind = "email_verified"
            title = "Email verified"
        elif row.action == "auth.lockout":
            kind = "login_failed"
            title = "Account lockout"
            status = "fail"
        else:
            kind = row.action.replace(".", "_")
        steps.append(
            _step(
                kind=kind,
                title=title,
                timestamp=row.created_at,
                status=status,
                detail=None if row.success else "Failed",
                source_id=str(row.id),
            )
        )

    # Logins
    login_rows = (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user_id)
        .order_by(LoginHistory.created_at.asc())
        .limit(500)
        .all()
    )
    for row in login_rows:
        if row.success:
            steps.append(
                _step(
                    kind="login",
                    title="Logged in",
                    timestamp=row.created_at,
                    status="ok",
                    detail=row.ip_address,
                    source_id=str(row.id),
                )
            )
        else:
            reason = row.failure_reason or "failed"
            steps.append(
                _step(
                    kind="login_failed",
                    title="Login failed",
                    timestamp=row.created_at,
                    status="fail",
                    detail=reason,
                    error=reason,
                    source_id=str(row.id),
                )
            )

    # Profile survey
    if user.profile_survey_completed_at is not None:
        steps.append(
            _step(
                kind="profile_survey",
                title="Completed profile survey",
                timestamp=user.profile_survey_completed_at,
                status="ok",
                source_id=str(user.id),
            )
        )

    # Analytics module events
    analytics_rows = (
        db.query(AnalyticsEvent)
        .filter(
            AnalyticsEvent.user_id == user_id,
            AnalyticsEvent.event_type == "module",
        )
        .order_by(AnalyticsEvent.created_at.asc())
        .limit(500)
        .all()
    )
    for row in analytics_rows:
        module = row.module or "module"
        steps.append(
            _step(
                kind="module",
                title=f"Started module · {module}",
                timestamp=row.created_at,
                status="info",
                detail=module,
                source_id=str(row.id),
            )
        )

    # Projects
    projects = (
        db.query(Project)
        .filter(Project.user_id == user_id)
        .order_by(Project.created_at.asc())
        .all()
    )
    for project in projects:
        pipe = PIPELINE_LABELS.get(project.pipeline_type, project.pipeline_type)
        steps.append(
            _step(
                kind="project",
                title=f"Project created · {project.title}",
                timestamp=project.created_at,
                status="info",
                detail=pipe,
                source_id=str(project.id),
                id_suffix=":created",
            )
        )
        if project.status in {"completed", "failed", "cancelled"} and project.updated_at:
            created = _ts(project.created_at)
            updated = _ts(project.updated_at)
            duration = None
            if created and updated and updated > created:
                duration = int((updated - created).total_seconds())
            status_map: dict[str, JourneyStatus] = {
                "completed": "ok",
                "failed": "fail",
                "cancelled": "fail",
            }
            grade = _project_grade(project)
            score = None
            if isinstance(project.results, dict):
                score = project.results.get("score")
            detail_parts = [pipe, project.status]
            if score is not None:
                detail_parts.append(f"score {score}")
            steps.append(
                _step(
                    kind="project",
                    title=f"Project {project.status} · {project.title}",
                    timestamp=project.updated_at,
                    status=status_map.get(project.status, "info"),
                    duration_seconds=duration,
                    detail=" · ".join(detail_parts),
                    error=None if project.status != "failed" else "Project failed",
                    source_id=str(project.id),
                    id_suffix=":terminal",
                )
            )
            if grade:
                comment = str(grade.get("comment") or "").strip()
                if comment:
                    rating = grade.get("rating")
                    grade_ts = grade.get("created_at")
                    if isinstance(grade_ts, str) and grade_ts.strip():
                        try:
                            comment_at = as_utc(
                                datetime.fromisoformat(grade_ts.replace("Z", "+00:00"))
                            )
                        except ValueError:
                            comment_at = project.updated_at
                    else:
                        comment_at = project.updated_at
                    comments.append(
                        {
                            "id": f"design_grade:{project.id}",
                            "source": "session_comment",
                            "text": comment,
                            "timestamp": utc_iso(comment_at),
                            "rating": int(rating) if rating is not None else None,
                            "meta": f"{project.title} · {pipe}",
                            "_sort": _ts(comment_at)
                            or datetime.min.replace(tzinfo=timezone.utc),
                        }
                    )

    grade_texts = _grade_comment_texts(projects)

    # Credit usage sessions
    credit_rows = (
        db.query(CreditUsageSession)
        .filter(CreditUsageSession.user_id == user_id)
        .order_by(CreditUsageSession.started_at.asc())
        .limit(500)
        .all()
    )
    for row in credit_rows:
        status: JourneyStatus = "ok" if row.status == "closed" else "info"
        if row.status in {"failed", "cancelled"}:
            status = "fail"
        steps.append(
            _step(
                kind="credit_session",
                title=f"Credit session · {row.module}",
                timestamp=row.started_at,
                status=status,
                duration_seconds=row.duration_seconds or None,
                detail=row.status,
                source_id=str(row.id),
            )
        )

    # Adaptive / MPC pipeline stages from progress
    adaptive_jobs = (
        db.query(AdaptiveJobRecord)
        .filter(AdaptiveJobRecord.user_id == user_id)
        .order_by(AdaptiveJobRecord.created_at.asc())
        .all()
    )
    for job in adaptive_jobs:
        progress = job.progress if isinstance(job.progress, list) else []
        for idx, ev in enumerate(progress):
            if not isinstance(ev, dict):
                continue
            stage = str(ev.get("stage") or "stage")
            text = str(ev.get("text") or ev.get("message") or "").strip()
            ts = _parse_progress_ts(ev.get("ts"), job.created_at or datetime.now(timezone.utc))
            steps.append(
                _step(
                    kind="pipeline_stage",
                    title=f"Adaptive · {stage}",
                    timestamp=ts,
                    status="info",
                    detail=text or None,
                    source_id=job.job_id,
                    id_suffix=f":{idx}",
                )
            )
        if job.error:
            steps.append(
                _step(
                    kind="pipeline_stage",
                    title="Adaptive · error",
                    timestamp=job.updated_at or job.created_at,
                    status="fail",
                    error=job.error,
                    source_id=job.job_id,
                    id_suffix=":error",
                )
            )

    mpc_jobs = (
        db.query(MPCJobRecord)
        .filter(MPCJobRecord.user_id == user_id)
        .order_by(MPCJobRecord.created_at.asc())
        .all()
    )
    for job in mpc_jobs:
        progress = job.progress if isinstance(job.progress, list) else []
        for idx, ev in enumerate(progress):
            if not isinstance(ev, dict):
                continue
            stage = str(ev.get("stage") or "stage")
            text = str(ev.get("text") or ev.get("message") or "").strip()
            ts = _parse_progress_ts(ev.get("ts"), job.created_at or datetime.now(timezone.utc))
            steps.append(
                _step(
                    kind="pipeline_stage",
                    title=f"MPC · {stage}",
                    timestamp=ts,
                    status="info",
                    detail=text or None,
                    source_id=job.job_id,
                    id_suffix=f":{idx}",
                )
            )
        if job.error:
            steps.append(
                _step(
                    kind="pipeline_stage",
                    title="MPC · error",
                    timestamp=job.updated_at or job.created_at,
                    status="fail",
                    error=job.error,
                    source_id=job.job_id,
                    id_suffix=":error",
                )
            )

    # Feedback surveys
    feedback_rows = (
        db.query(FeedbackSurveyResponse)
        .filter(FeedbackSurveyResponse.user_id == user_id)
        .order_by(FeedbackSurveyResponse.created_at.asc())
        .all()
    )
    for row in feedback_rows:
        pipe = PIPELINE_LABELS.get(row.pipeline_type, row.pipeline_type)
        steps.append(
            _step(
                kind="feedback",
                title=f"Feedback survey · {pipe}",
                timestamp=row.created_at,
                status="ok",
                detail=f"satisfaction {row.satisfaction}/5",
                source_id=str(row.id),
            )
        )
        text = (row.main_problems or "").strip()
        if text and not _is_mirrored_grade_feedback(row, grade_texts):
            comments.append(
                {
                    "id": f"feedback:{row.id}",
                    "source": "feedback_survey",
                    "text": text,
                    "timestamp": utc_iso(row.created_at),
                    "rating": row.satisfaction,
                    "meta": f"Feedback survey · {pipe}",
                    "_sort": _ts(row.created_at) or datetime.min.replace(tzinfo=timezone.utc),
                }
            )

    # Errors
    error_rows = (
        db.query(ErrorEvent)
        .filter(ErrorEvent.user_id == user_id)
        .order_by(ErrorEvent.created_at.asc())
        .limit(200)
        .all()
    )
    for row in error_rows:
        msg = (row.message or "").strip()
        steps.append(
            _step(
                kind="error",
                title=f"Error · {row.source}",
                timestamp=row.created_at,
                status="fail",
                detail=msg[:200] if msg else None,
                error=msg or None,
                source_id=str(row.id),
            )
        )

    # Bug reports
    bug_rows = (
        db.query(BugReport)
        .filter(BugReport.user_id == user_id)
        .order_by(BugReport.created_at.asc())
        .all()
    )
    for row in bug_rows:
        title = (row.title or "").strip() or "Bug report"
        steps.append(
            _step(
                kind="bug_report",
                title=f"Bug report · {title}",
                timestamp=row.created_at,
                status="info",
                detail=row.status,
                source_id=str(row.id),
            )
        )
        desc = (row.description or "").strip()
        if desc:
            comments.append(
                {
                    "id": f"bug:{row.id}",
                    "source": "bug_report",
                    "text": desc,
                    "timestamp": utc_iso(row.created_at),
                    "rating": None,
                    "meta": title,
                    "_sort": _ts(row.created_at) or datetime.min.replace(tzinfo=timezone.utc),
                }
            )

    steps.sort(key=lambda s: (s["_sort"], s["id"]))
    comments.sort(key=lambda c: c["_sort"], reverse=True)

    for item in steps:
        item.pop("_sort", None)
    for item in comments:
        item.pop("_sort", None)

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
        },
        "steps": steps,
        "comments": comments,
    }
