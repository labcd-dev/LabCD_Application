"""Survey module settings, profile/feedback submissions, and tutorial dismiss prefs."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import FeedbackSurveyResponse, TutorialVideo, User
from backend_api.http.schemas.survey import (
    FeedbackPipelineType,
    FeedbackSurveyRequest,
    ProfileSurveyRequest,
    SurveySettings,
)
from backend_api.http.services import plan_service, tutorials_service

SETTING_ENABLED = "survey.enabled"

FEEDBACK_PIPELINES: tuple[FeedbackPipelineType, ...] = ("siloDesign", "muloDesign")


def is_survey_enabled(db: Session) -> bool:
    raw = plan_service.get_setting(db, SETTING_ENABLED)
    if raw is None:
        return True
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def get_settings(db: Session) -> SurveySettings:
    return SurveySettings(enabled=is_survey_enabled(db))


def update_settings(db: Session, *, enabled: bool | None) -> SurveySettings:
    if enabled is not None:
        plan_service.set_setting(db, SETTING_ENABLED, "true" if enabled else "false")
    return get_settings(db)


def needs_profile_survey(db: Session, user: User) -> bool:
    if user.role is not None and user.role.is_system:
        return False
    if not is_survey_enabled(db):
        return False
    return user.profile_survey_completed_at is None


def feedback_pipelines_completed(user: User) -> set[str]:
    return {row.pipeline_type for row in (user.feedback_surveys or [])}


def feedback_completed_silo(user: User) -> bool:
    return "siloDesign" in feedback_pipelines_completed(user)


def feedback_completed_mulo(user: User) -> bool:
    return "muloDesign" in feedback_pipelines_completed(user)


def feedback_completed(user: User) -> bool:
    """True when both SILO and MULO feedback surveys are submitted."""
    completed = feedback_pipelines_completed(user)
    return all(pipeline in completed for pipeline in FEEDBACK_PIPELINES)


def feedback_completed_for(user: User, pipeline_type: str) -> bool:
    return pipeline_type in feedback_pipelines_completed(user)


def list_videos(db: Session) -> list[TutorialVideo]:
    """Proxy for onboarding status; videos are owned by tutorials_service."""
    return tutorials_service.list_videos(db)


def should_show_tutorial(user: User, videos: list[TutorialVideo]) -> bool:
    if user.tutorial_dont_show_again:
        return False
    return len(videos) > 0


def submit_profile(db: Session, user: User, request: ProfileSurveyRequest) -> User:
    now = datetime.now(timezone.utc)
    user.university = request.university.strip()
    user.degree = request.degree.strip()
    user.major = request.major.strip()
    user.matlab_experience = request.matlab_experience
    user.control_design_experience = request.control_design_experience
    user.profile_survey_completed_at = now
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def submit_feedback(db: Session, user: User, request: FeedbackSurveyRequest) -> FeedbackSurveyResponse:
    now = datetime.now(timezone.utc)
    row = FeedbackSurveyResponse(
        user_id=user.id,
        pipeline_type=request.pipeline_type,
        satisfaction=request.satisfaction,
        ease_of_use=request.ease_of_use,
        product_value=request.product_value,
        confidence=request.confidence,
        reuse_intention=request.reuse_intention,
        willingness_to_pay=request.willingness_to_pay,
        main_problems=(request.main_problems or "").strip(),
        created_at=now,
    )
    user.feedback_survey_completed_at = now
    db.add(row)
    db.add(user)
    db.commit()
    db.refresh(row)
    db.refresh(user)
    return row


def dismiss_tutorial(db: Session, user: User, action: str) -> User:
    if action == "dont_show_again":
        user.tutorial_dont_show_again = True
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def list_profile_responses(db: Session) -> list[User]:
    return (
        db.query(User)
        .filter(User.profile_survey_completed_at.isnot(None))
        .order_by(User.profile_survey_completed_at.desc())
        .all()
    )


def list_feedback_responses(db: Session) -> list[tuple[FeedbackSurveyResponse, User]]:
    rows = (
        db.query(FeedbackSurveyResponse, User)
        .join(User, User.id == FeedbackSurveyResponse.user_id)
        .order_by(FeedbackSurveyResponse.created_at.desc())
        .all()
    )
    return list(rows)
