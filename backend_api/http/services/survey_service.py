"""Survey module settings, profile/feedback submissions, and tutorial videos."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from backend_api.db.models import FeedbackSurveyResponse, TutorialVideo, User
from backend_api.http.config import API_PREFIX, UPLOADS_DIR
from backend_api.http.schemas.survey import (
    FeedbackPipelineType,
    FeedbackSurveyRequest,
    ProfileSurveyRequest,
    SurveySettings,
)
from backend_api.http.services import plan_service

SETTING_ENABLED = "survey.enabled"

TUTORIALS_DIR = UPLOADS_DIR / "tutorials"
ALLOWED_VIDEO_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
MAX_VIDEO_BYTES = 100 * 1024 * 1024

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
    if user.is_admin:
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
    return (
        db.query(TutorialVideo)
        .order_by(TutorialVideo.sort_order.asc(), TutorialVideo.id.asc())
        .all()
    )


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
    pipeline_type = request.pipeline_type
    existing = (
        db.query(FeedbackSurveyResponse)
        .filter(
            FeedbackSurveyResponse.user_id == user.id,
            FeedbackSurveyResponse.pipeline_type == pipeline_type,
        )
        .first()
    )
    if existing is not None:
        label = "Single Loop" if pipeline_type == "siloDesign" else "Multi Loop"
        raise ValueError(f"{label} feedback survey already submitted")

    now = datetime.now(timezone.utc)
    row = FeedbackSurveyResponse(
        user_id=user.id,
        pipeline_type=pipeline_type,
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


def get_video(db: Session, video_id: int) -> TutorialVideo | None:
    return db.query(TutorialVideo).filter(TutorialVideo.id == video_id).first()


def _remove_video_file(file_url: str | None) -> None:
    if not file_url:
        return
    prefix = f"{API_PREFIX}/uploads/tutorials/"
    if not file_url.startswith(prefix):
        return
    filename = file_url.removeprefix(prefix)
    path = TUTORIALS_DIR / filename
    if path.is_file():
        path.unlink()


async def create_video(db: Session, *, title: str, file: UploadFile) -> TutorialVideo:
    content_type = (file.content_type or "").lower()
    extension = ALLOWED_VIDEO_TYPES.get(content_type)
    if extension is None:
        # Fallback by filename when browsers send octet-stream.
        name = (file.filename or "").lower()
        for ext in (".mp4", ".webm", ".mov"):
            if name.endswith(ext):
                extension = ext
                break
    if extension is None:
        raise ValueError("Video must be MP4, WebM, or MOV")

    data = await file.read()
    if not data:
        raise ValueError("Video file is empty")
    if len(data) > MAX_VIDEO_BYTES:
        raise ValueError("Video must be 100 MB or smaller")

    TUTORIALS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"tutorial_{uuid.uuid4().hex[:12]}{extension}"
    path: Path = TUTORIALS_DIR / filename
    path.write_bytes(data)

    max_order = db.query(TutorialVideo).count()
    row = TutorialVideo(
        title=title.strip(),
        file_url=f"{API_PREFIX}/uploads/tutorials/{filename}",
        sort_order=max_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_video(
    db: Session,
    video: TutorialVideo,
    *,
    title: str | None = None,
    sort_order: int | None = None,
) -> TutorialVideo:
    if title is not None:
        video.title = title.strip()
    if sort_order is not None:
        video.sort_order = sort_order
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


def delete_video(db: Session, video: TutorialVideo) -> None:
    _remove_video_file(video.file_url)
    db.delete(video)
    db.commit()
