"""Survey module settings, profile/feedback submissions, and tutorial dismiss prefs."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import BeforeTestSurveyResponse, FeedbackSurveyResponse, TutorialVideo, User
from backend_api.http.schemas.survey import (
    BeforeTestSurveyRequest,
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
    sat = request.satisfaction if request.satisfaction is not None else (request.technical_usefulness or 5)
    conf = request.confidence if request.confidence is not None else (request.trust or 4)

    # Check if a row already exists for this job_id or was recently created by submit_grade
    row = None
    if request.job_id:
        row = (
            db.query(FeedbackSurveyResponse)
            .filter(
                FeedbackSurveyResponse.user_id == user.id,
                FeedbackSurveyResponse.job_id == request.job_id,
            )
            .order_by(FeedbackSurveyResponse.created_at.desc())
            .first()
        )
    if not row:
        from datetime import timedelta
        recent_cutoff = now - timedelta(seconds=120)
        row = (
            db.query(FeedbackSurveyResponse)
            .filter(
                FeedbackSurveyResponse.user_id == user.id,
                FeedbackSurveyResponse.pipeline_type == request.pipeline_type,
                FeedbackSurveyResponse.created_at >= recent_cutoff,
                FeedbackSurveyResponse.job_id.is_(None),
            )
            .order_by(FeedbackSurveyResponse.created_at.desc())
            .first()
        )

    if row:
        row.pipeline_type = request.pipeline_type
        row.job_id = request.job_id or row.job_id
        row.project_id = request.project_id or row.project_id
        row.plant_name = request.plant_name or row.plant_name
        row.score = request.score if request.score is not None else row.score
        row.success = request.success if request.success is not None else row.success
        row.technical_usefulness = request.technical_usefulness
        row.technical_usefulness_na = request.technical_usefulness_na
        row.trust = request.trust
        row.trust_na = request.trust_na
        row.satisfaction = sat
        row.ease_of_use = request.ease_of_use
        row.product_value = request.product_value
        row.confidence = conf
        row.reuse_intention = request.reuse_intention
        row.willingness_to_pay = request.willingness_to_pay
        row.nps = request.nps
        row.main_problems = (request.main_problems or row.main_problems or "").strip()
        row.is_bug = request.is_bug
    else:
        row = FeedbackSurveyResponse(
            user_id=user.id,
            pipeline_type=request.pipeline_type,
            job_id=request.job_id,
            project_id=request.project_id,
            plant_name=request.plant_name,
            score=request.score,
            success=request.success,
            technical_usefulness=request.technical_usefulness,
            technical_usefulness_na=request.technical_usefulness_na,
            trust=request.trust,
            trust_na=request.trust_na,
            satisfaction=sat,
            ease_of_use=request.ease_of_use,
            product_value=request.product_value,
            confidence=conf,
            reuse_intention=request.reuse_intention,
            willingness_to_pay=request.willingness_to_pay,
            nps=request.nps,
            main_problems=(request.main_problems or "").strip(),
            is_bug=request.is_bug,
            created_at=now,
        )
        db.add(row)

    user.feedback_survey_completed_at = now
    db.add(user)
    db.commit()
    db.refresh(row)
    db.refresh(user)

    # Sync design grade to project if project_id or job_id matches
    target_project_id = request.project_id
    if not target_project_id and request.job_id:
        from backend_api.db.models import Project
        proj = db.query(Project).filter(Project.job_id == request.job_id).first()
        if proj:
            target_project_id = proj.id

    if target_project_id:
        try:
            from backend_api.http.services.project_service import update_project_results_grade
            rating_val = request.technical_usefulness or request.trust or sat
            grade_payload = {
                "rating": rating_val,
                "comment": (request.main_problems or "").strip() or None,
                "nps": request.nps,
                "created_at": now.isoformat(),
            }
            update_project_results_grade(target_project_id, grade_payload, db=db)
        except Exception as e:
            pass

    return row


def submit_before_test(db: Session, user: User, request: BeforeTestSurveyRequest) -> BeforeTestSurveyResponse:
    now = datetime.now(timezone.utc)
    row = BeforeTestSurveyResponse(
        user_id=user.id,
        q1_last_worked=request.q1_last_worked.strip(),
        q2_time_spent=request.q2_time_spent.strip(),
        q3_knowledge_gaps=request.q3_knowledge_gaps,
        q4_difficult_parts=request.q4_difficult_parts,
        q5_biggest_problem=(request.q5_biggest_problem or "").strip(),
        q6_help_sources=request.q6_help_sources,
        q7_considered_paying=request.q7_considered_paying.strip(),
        q8a_amount_hired=request.q8a_amount_hired.strip() if request.q8a_amount_hired else None,
        q8b_amount_paid_to_user=request.q8b_amount_paid_to_user.strip() if request.q8b_amount_paid_to_user else None,
        q9_impact=request.q9_impact,
        created_at=now,
    )
    user.profile_survey_completed_at = now
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


def list_before_test_responses(db: Session) -> list[tuple[BeforeTestSurveyResponse, User]]:
    rows = (
        db.query(BeforeTestSurveyResponse, User)
        .join(User, User.id == BeforeTestSurveyResponse.user_id)
        .order_by(BeforeTestSurveyResponse.created_at.desc())
        .all()
    )
    return list(rows)


def list_feedback_responses(db: Session) -> list[tuple[FeedbackSurveyResponse, User]]:
    rows = (
        db.query(FeedbackSurveyResponse, User)
        .join(User, User.id == FeedbackSurveyResponse.user_id)
        .order_by(FeedbackSurveyResponse.created_at.desc())
        .all()
    )
    return list(rows)


def record_design_grade_feedback(
    db: Session,
    *,
    user_id: int | None,
    pipeline_type: str,
    rating: int,
    comment: str | None = None,
) -> FeedbackSurveyResponse | None:
    """Record 1-5 star design grade into FeedbackSurveyResponse for admin survey aggregation."""
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    now = datetime.now(timezone.utc)
    clamped_rating = max(1, min(5, int(rating)))
    row = FeedbackSurveyResponse(
        user_id=user.id,
        pipeline_type=pipeline_type,
        satisfaction=clamped_rating,
        ease_of_use=clamped_rating,
        product_value=clamped_rating,
        confidence=clamped_rating,
        reuse_intention=clamped_rating,
        willingness_to_pay=clamped_rating,
        main_problems=(comment or "").strip(),
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
