"""Admin aggregation of user account, survey, project, and error data."""

from __future__ import annotations

from sqlalchemy.orm import Session

from backend_api.db.models import FeedbackSurveyResponse, LoginHistory, User
from backend_api.http.services import error_tracking_service, project_service, session_service
from backend_api.http.services.auth_service import get_user_by_id, is_last_active_admin
from backend_api.http.services.profile_service import user_out

LOGIN_HISTORY_LIMIT = 200


def get_user_detail(db: Session, user_id: int) -> dict | None:
    user = get_user_by_id(db, user_id)
    if user is None:
        return None

    feedback_rows = (
        db.query(FeedbackSurveyResponse)
        .filter(FeedbackSurveyResponse.user_id == user_id)
        .order_by(FeedbackSurveyResponse.created_at.asc())
        .all()
    )
    projects = project_service.list_all_projects(db, user_id=user_id)
    errors = error_tracking_service.list_errors(db, user_id=user_id, limit=200)
    login_rows = (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user_id)
        .order_by(LoginHistory.created_at.desc())
        .limit(LOGIN_HISTORY_LIMIT)
        .all()
    )

    profile_survey = None
    if user.profile_survey_completed_at is not None:
        profile_survey = {
            "university": user.university,
            "degree": user.degree,
            "major": user.major,
            "matlab_experience": user.matlab_experience,
            "control_design_experience": user.control_design_experience,
            "completed_at": user.profile_survey_completed_at,
        }

    feedback_surveys = [
        {
            "pipeline_type": row.pipeline_type,
            "satisfaction": row.satisfaction,
            "ease_of_use": row.ease_of_use,
            "product_value": row.product_value,
            "confidence": row.confidence,
            "reuse_intention": row.reuse_intention,
            "willingness_to_pay": row.willingness_to_pay,
            "main_problems": row.main_problems,
            "created_at": row.created_at,
        }
        for row in feedback_rows
    ]

    return {
        "user": user_out(user),
        "allowed_models": user.model_ids(),
        "profile_survey": profile_survey,
        "feedback_surveys": feedback_surveys,
        "projects": [
            project_service.project_to_summary(project, include_owner=False)
            for project in projects
        ],
        "errors": [
            error_tracking_service.event_to_dict(event) for event in errors
        ],
        "login_history": [
            {
                "id": row.id,
                "email": row.email,
                "success": row.success,
                "ip_address": row.ip_address,
                "user_agent": row.user_agent,
                "failure_reason": row.failure_reason,
                "created_at": row.created_at,
            }
            for row in login_rows
        ],
        "sessions": [
            {
                "id": row.id,
                "ip_address": row.ip_address,
                "user_agent": row.user_agent,
                "created_at": row.created_at,
                "last_seen_at": row.last_seen_at,
                "is_current": False,
            }
            for row in session_service.list_user_sessions(db, user_id)
        ],
    }


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()


def guard_admin_account_change(
    db: Session,
    *,
    actor: User,
    target: User,
    deactivating: bool = False,
    demoting: bool = False,
    deleting: bool = False,
) -> None:
    """Raise ValueError when an admin account change is not allowed."""
    if target.id == actor.id and (deactivating or deleting):
        raise ValueError("You cannot suspend or delete your own account")

    removing_admin_access = deleting or deactivating or demoting
    if removing_admin_access and is_last_active_admin(db, target):
        raise ValueError("Cannot remove the last active admin")
