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


def _project_score(project: Project) -> float | None:
    if not isinstance(project.results, dict):
        return None
    raw = project.results.get("score")
    if isinstance(raw, (int, float)):
        return float(raw)
    return None


def _project_duration_seconds(project: Project) -> int | None:
    created = _ts(project.created_at)
    updated = _ts(project.updated_at)
    if created and updated and updated > created:
        return int((updated - created).total_seconds())
    return None


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return int(round((ordered[mid - 1] + ordered[mid]) / 2))


def _email_domain(email: str) -> str:
    parts = email.rsplit("@", 1)
    return parts[1].lower() if len(parts) == 2 else ""


def _infer_persona(user: Any) -> dict[str, Any]:
    domain = _email_domain(user.email or "")
    signals: list[dict[str, Any]] = []
    academia = 0
    engineer = 0
    sme = 0

    if domain.endswith(".edu") or domain.endswith(".ac.ir") or "university" in domain:
        academia += 40
        signals.append(
            {"key": "Email domain", "value": f".edu / academic ({domain})", "positive": True}
        )
    elif domain.endswith(".com") or domain.endswith(".io"):
        engineer += 15
        sme += 10
        signals.append({"key": "Email domain", "value": domain or "—", "positive": False})
    else:
        signals.append({"key": "Email domain", "value": domain or "—", "positive": False})

    if user.university:
        academia += 30
        signals.append(
            {"key": "University", "value": str(user.university), "positive": True}
        )
    if user.degree:
        academia += 15
        signals.append({"key": "Degree", "value": str(user.degree), "positive": False})
    if user.major:
        major_l = str(user.major).lower()
        signals.append({"key": "Major", "value": str(user.major), "positive": False})
        if any(k in major_l for k in ("control", "electrical", "mechatronic", "aerospace")):
            engineer += 20
        if any(k in major_l for k in ("business", "mba", "management")):
            sme += 15
    if user.matlab_experience:
        signals.append(
            {
                "key": "MATLAB experience",
                "value": str(user.matlab_experience),
                "positive": False,
            }
        )
        if user.matlab_experience in {"Intermediate", "Advanced"}:
            engineer += 10
            academia += 5
    if user.control_design_experience:
        signals.append(
            {
                "key": "Control experience",
                "value": str(user.control_design_experience),
                "positive": False,
            }
        )
        if user.control_design_experience in {"Intermediate", "Advanced"}:
            engineer += 15

    scores = {
        "Academia · researcher": academia,
        "Control engineer": engineer,
        "SME": sme,
    }
    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_label, best_score = ordered[0]
    if best_score <= 0:
        best_label = "Unknown"
        best_score = 0
    total = sum(max(0, s) for s in scores.values()) or 1
    conf = int(round(100 * max(0, best_score) / total)) if best_score > 0 else 0
    alts = [
        {"label": label, "score": int(round(100 * max(0, sc) / total))}
        for label, sc in ordered[1:]
        if sc > 0
    ]
    return {
        "label": best_label,
        "score": conf,
        "signals": signals,
        "alts": alts,
    }


def _build_actions(
    *,
    user: Any,
    projects: list[Project],
    error_count: int,
    persona_label: str,
    completed: int,
    abandoned: int,
) -> list[dict[str, str]]:
    actions: list[dict[str, str]] = []
    if user.profile_survey_completed_at is None:
        actions.append(
            {
                "priority": "med",
                "title": "Prompt profile survey",
                "detail": "User has not completed the profile survey; onboarding signals are incomplete.",
            }
        )
    if error_count >= 3:
        actions.append(
            {
                "priority": "med",
                "title": "Review numerical / API errors",
                "detail": f"{error_count} errors recorded. Prioritize clearer HITL messages on first-pass failures.",
            }
        )
    statuses = [p.status for p in projects]
    if projects and statuses[0] in {"failed", "cancelled"} and completed >= 1:
        actions.append(
            {
                "priority": "high",
                "title": "First-session recovery worked",
                "detail": "Early failure followed by later success. Keep onboarding retry paths visible.",
            }
        )
    if abandoned >= 2 and completed == 0:
        actions.append(
            {
                "priority": "high",
                "title": "Activation at risk",
                "detail": "Multiple abandoned sessions with no completed design. Consider outreach or simpler first-run path.",
            }
        )
    if persona_label.startswith("Academia"):
        actions.append(
            {
                "priority": "low",
                "title": "No aggressive upsell",
                "detail": "Academic signals dominate. Prefer research plan fit over SME sales motion.",
            }
        )
    if not actions:
        actions.append(
            {
                "priority": "low",
                "title": "No urgent interventions",
                "detail": "Usage looks stable; continue monitoring timeline and feedback.",
            }
        )
    return actions


def _build_dossier(
    *,
    user: Any,
    projects: list[Project],
    credit_rows: list[CreditUsageSession],
    error_rows: list[ErrorEvent],
    bug_rows: list[BugReport],
    login_rows: list[LoginHistory],
) -> dict[str, Any]:
    completed = [p for p in projects if p.status == "completed"]
    abandoned = [p for p in projects if p.status in {"failed", "cancelled"}]
    terminal = completed + abandoned
    scores = [s for s in (_project_score(p) for p in completed) if s is not None]

    tokens_total = sum(
        int(r.prompt_tokens or 0) + int(r.completion_tokens or 0) for r in credit_rows
    )
    credits_charged = float(sum((r.credits_charged or 0) for r in credit_rows))
    time_seconds = sum(int(r.duration_seconds or 0) for r in credit_rows)
    session_durations = [
        int(r.duration_seconds) for r in credit_rows if (r.duration_seconds or 0) > 0
    ]
    project_durations = [
        d for d in (_project_duration_seconds(p) for p in terminal) if d is not None
    ]
    median_session = _median(session_durations or project_durations)

    error_by_source: dict[str, int] = {}
    for row in error_rows:
        key = row.source or "other"
        error_by_source[key] = error_by_source.get(key, 0) + 1
    error_count = len(error_rows)
    api_errors = error_by_source.get("api", 0) + error_by_source.get("backend", 0)
    other_errors = error_count - api_errors

    success_rate = None
    if terminal:
        success_rate = round(100.0 * len(completed) / len(terminal), 1)

    avg_score = round(sum(scores) / len(scores), 1) if scores else None
    best_score = max(scores) if scores else None
    worst_score = min(scores) if scores else None

    ratings: list[int] = []
    for project in projects:
        grade = _project_grade(project)
        if not grade:
            continue
        rating = grade.get("rating")
        if isinstance(rating, (int, float)):
            ratings.append(int(rating))
    avg_rating = round(sum(ratings) / len(ratings), 1) if ratings else None

    # Pipeline mix
    mix_counts: dict[str, int] = {}
    for project in projects:
        mix_counts[project.pipeline_type] = mix_counts.get(project.pipeline_type, 0) + 1
    mix_total = sum(mix_counts.values()) or 1
    pipeline_order = ("siloDesign", "muloDesign", "adaptiveDesign", "mpcDesign")
    pipeline_mix = []
    for ptype in pipeline_order:
        count = mix_counts.get(ptype, 0)
        pipeline_mix.append(
            {
                "name": PIPELINE_LABELS.get(ptype, ptype),
                "pipeline_type": ptype,
                "count": count,
                "pct": round(100.0 * count / mix_total, 1) if mix_counts else 0.0,
            }
        )
    for ptype, count in mix_counts.items():
        if ptype not in pipeline_order:
            pipeline_mix.append(
                {
                    "name": PIPELINE_LABELS.get(ptype, ptype),
                    "pipeline_type": ptype,
                    "count": count,
                    "pct": round(100.0 * count / mix_total, 1),
                }
            )

    # Tokens per project via job_id match on credit sessions
    tokens_by_job: dict[str, int] = {}
    for row in credit_rows:
        if not row.job_id:
            continue
        tokens_by_job[row.job_id] = tokens_by_job.get(row.job_id, 0) + int(
            row.prompt_tokens or 0
        ) + int(row.completion_tokens or 0)

    recent_sorted = sorted(
        projects,
        key=lambda p: _ts(p.updated_at) or _ts(p.created_at) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    recent_sessions = []
    for project in recent_sorted[:5]:
        duration = _project_duration_seconds(project)
        tokens = tokens_by_job.get(project.job_id or "", None)
        recent_sessions.append(
            {
                "id": project.id,
                "title": project.title,
                "pipeline": PIPELINE_LABELS.get(project.pipeline_type, project.pipeline_type),
                "pipeline_type": project.pipeline_type,
                "status": project.status,
                "score": _project_score(project),
                "duration_seconds": duration,
                "tokens": tokens,
                "updated_at": utc_iso(project.updated_at or project.created_at),
            }
        )

    last_active_candidates: list[datetime] = []
    for row in login_rows:
        ts = _ts(row.created_at)
        if ts:
            last_active_candidates.append(ts)
    for project in projects:
        ts = _ts(project.updated_at) or _ts(project.created_at)
        if ts:
            last_active_candidates.append(ts)
    last_active = max(last_active_candidates) if last_active_candidates else None

    if not projects:
        health = "new"
        health_detail = "No design sessions yet"
    elif completed and error_count <= max(3, len(projects)):
        health = "good"
        health_detail = f"Activation complete · {len(completed)} successful design(s)"
    elif completed:
        health = "good"
        health_detail = f"{len(completed)} success · {error_count} errors"
    else:
        health = "at_risk"
        health_detail = f"{len(abandoned)} abandoned/failed · 0 completed"

    tags: list[str] = []
    if user.profile_survey_completed_at is not None:
        tags.append("survey complete")
    if completed:
        tags.append("activated")
    if ratings:
        tags.append("rated designs")
    if not user.email_verified:
        tags.append("unverified email")
    if not user.is_active:
        tags.append("inactive")

    persona = _infer_persona(user)
    profile = None
    if user.profile_survey_completed_at is not None:
        profile = {
            "university": user.university,
            "degree": user.degree,
            "major": user.major,
            "matlab_experience": user.matlab_experience,
            "control_design_experience": user.control_design_experience,
            "completed_at": utc_iso(user.profile_survey_completed_at),
        }

    plan_name = None
    plan = getattr(user, "plan", None)
    if plan is not None:
        plan_name = getattr(plan, "name", None)

    avg_credits_per_success = None
    if completed and credits_charged > 0:
        avg_credits_per_success = round(credits_charged / len(completed), 2)

    actions = _build_actions(
        user=user,
        projects=projects,
        error_count=error_count,
        persona_label=persona["label"],
        completed=len(completed),
        abandoned=len(abandoned),
    )

    return {
        "joined_at": utc_iso(user.created_at) if user.created_at else None,
        "last_active_at": utc_iso(last_active) if last_active else None,
        "plan_name": plan_name,
        "health": health,
        "health_detail": health_detail,
        "tags": tags,
        "kpis": {
            "sessions": len(projects),
            "sessions_completed": len(completed),
            "sessions_abandoned": len(abandoned),
            "success_rate": success_rate,
            "avg_score": avg_score,
            "best_score": best_score,
            "worst_score": worst_score,
            "tokens_total": tokens_total,
            "credits_charged": round(credits_charged, 2),
            "error_count": error_count,
            "error_by_source": error_by_source,
            "time_seconds": time_seconds,
            "median_session_seconds": median_session,
        },
        "persona": persona,
        "profile": profile,
        "pipeline_mix": pipeline_mix,
        "recent_sessions": recent_sessions,
        "usage": {
            "tokens_total": tokens_total,
            "credits_charged": round(credits_charged, 2),
            "avg_credits_per_success": avg_credits_per_success,
            "api_errors": api_errors,
            "other_errors": other_errors,
            "avg_rating": avg_rating,
            "rating_count": len(ratings),
        },
        "flags": {
            "email_verified": bool(user.email_verified),
            "is_active": bool(user.is_active),
            "bug_report_count": len(bug_rows),
            "profile_survey_complete": user.profile_survey_completed_at is not None,
        },
        "actions": actions,
        "latest_project_id": recent_sorted[0].id if recent_sorted else None,
    }


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

    dossier = _build_dossier(
        user=user,
        projects=projects,
        credit_rows=credit_rows,
        error_rows=error_rows,
        bug_rows=bug_rows,
        login_rows=login_rows,
    )

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
        },
        "steps": steps,
        "comments": comments,
        "dossier": dossier,
    }
