"""Admin aggregation of user account, survey, project, and error data."""

from __future__ import annotations

from sqlalchemy.orm import Session

from backend_api.db.models import FeedbackSurveyResponse, User
from backend_api.http.services import error_tracking_service, project_service
from backend_api.http.services.auth_service import get_user_by_id
from backend_api.http.services.profile_service import user_out


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
    }
