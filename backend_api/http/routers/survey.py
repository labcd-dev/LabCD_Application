"""User and admin routes for surveys and tutorial videos."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user, require_admin
from backend_api.http.schemas.auth import UserOut
from backend_api.http.schemas.survey import (
    FeedbackSurveyRequest,
    FeedbackSurveyResponseOut,
    ProfileSurveyRequest,
    ProfileSurveyResponseOut,
    SurveyResponsesOut,
    SurveySettings,
    SurveySettingsUpdate,
    SurveyStatusResponse,
    TutorialDismissRequest,
    TutorialVideoOut,
    TutorialVideoUpdateRequest,
)
from backend_api.http.services import survey_service
from backend_api.http.services.admin_csv_service import (
    export_feedback_survey_csv,
    export_profile_survey_csv,
)
from backend_api.http.services.profile_service import user_out

router = APIRouter(tags=["survey"])


def _feedback_status_fields(user: User) -> dict:
    return {
        "feedback_completed": survey_service.feedback_completed(user),
        "feedback_completed_silo": survey_service.feedback_completed_silo(user),
        "feedback_completed_mulo": survey_service.feedback_completed_mulo(user),
    }


@router.get("/survey/status", response_model=SurveyStatusResponse)
def get_survey_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SurveyStatusResponse:
    enabled = survey_service.is_survey_enabled(db)
    videos = survey_service.list_videos(db)
    return SurveyStatusResponse(
        enabled=enabled,
        needs_profile_survey=survey_service.needs_profile_survey(db, user),
        show_tutorial=survey_service.should_show_tutorial(user, videos),
        videos=[TutorialVideoOut.model_validate(v) for v in videos],
        **_feedback_status_fields(user),
    )


@router.post("/survey/profile", response_model=UserOut)
def submit_profile_survey(
    request: ProfileSurveyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    updated = survey_service.submit_profile(db, user, request)
    return user_out(updated)


@router.post("/survey/feedback", response_model=FeedbackSurveyResponseOut)
def submit_feedback_survey(
    request: FeedbackSurveyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackSurveyResponseOut:
    try:
        row = survey_service.submit_feedback(db, user, request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return FeedbackSurveyResponseOut(
        user_id=user.id,
        email=user.email,
        pipeline_type=row.pipeline_type,  # type: ignore[arg-type]
        satisfaction=row.satisfaction,
        ease_of_use=row.ease_of_use,
        product_value=row.product_value,
        confidence=row.confidence,
        reuse_intention=row.reuse_intention,
        willingness_to_pay=row.willingness_to_pay,
        main_problems=row.main_problems,
        created_at=row.created_at,
    )


@router.post("/survey/tutorial/dismiss", response_model=SurveyStatusResponse)
def dismiss_tutorial(
    request: TutorialDismissRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SurveyStatusResponse:
    survey_service.dismiss_tutorial(db, user, request.action)
    db.refresh(user)
    videos = survey_service.list_videos(db)
    return SurveyStatusResponse(
        enabled=survey_service.is_survey_enabled(db),
        needs_profile_survey=survey_service.needs_profile_survey(db, user),
        show_tutorial=survey_service.should_show_tutorial(user, videos),
        videos=[TutorialVideoOut.model_validate(v) for v in videos],
        **_feedback_status_fields(user),
    )


@router.get("/admin/survey/settings", response_model=SurveySettings)
def get_survey_settings(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SurveySettings:
    return survey_service.get_settings(db)


@router.patch("/admin/survey/settings", response_model=SurveySettings)
def update_survey_settings(
    request: SurveySettingsUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SurveySettings:
    return survey_service.update_settings(db, enabled=request.enabled)


@router.get("/admin/survey/responses", response_model=SurveyResponsesOut)
def list_survey_responses(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SurveyResponsesOut:
    profile_users = survey_service.list_profile_responses(db)
    feedback_rows = survey_service.list_feedback_responses(db)
    return SurveyResponsesOut(
        profile=[
            ProfileSurveyResponseOut(
                user_id=u.id,
                email=u.email,
                university=u.university,
                degree=u.degree,
                major=u.major,
                matlab_experience=u.matlab_experience,
                control_design_experience=u.control_design_experience,
                completed_at=u.profile_survey_completed_at,
            )
            for u in profile_users
        ],
        feedback=[
            FeedbackSurveyResponseOut(
                user_id=u.id,
                email=u.email,
                pipeline_type=row.pipeline_type,  # type: ignore[arg-type]
                satisfaction=row.satisfaction,
                ease_of_use=row.ease_of_use,
                product_value=row.product_value,
                confidence=row.confidence,
                reuse_intention=row.reuse_intention,
                willingness_to_pay=row.willingness_to_pay,
                main_problems=row.main_problems,
                created_at=row.created_at,
            )
            for row, u in feedback_rows
        ],
    )


@router.get("/admin/survey/responses/profile/export.csv")
def export_profile_survey_csv_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    content = export_profile_survey_csv(db)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="profile_survey_responses.csv"'},
    )


@router.get("/admin/survey/responses/feedback/export.csv")
def export_feedback_survey_csv_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    content = export_feedback_survey_csv(db)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="feedback_survey_responses.csv"'},
    )


@router.get("/admin/tutorial-videos", response_model=list[TutorialVideoOut])
def list_tutorial_videos(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[TutorialVideoOut]:
    return [TutorialVideoOut.model_validate(v) for v in survey_service.list_videos(db)]


@router.post("/admin/tutorial-videos", response_model=TutorialVideoOut, status_code=status.HTTP_201_CREATED)
async def upload_tutorial_video(
    title: str = Form(..., min_length=1, max_length=200),
    file: UploadFile = File(...),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TutorialVideoOut:
    try:
        row = await survey_service.create_video(db, title=title, file=file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TutorialVideoOut.model_validate(row)


@router.patch("/admin/tutorial-videos/{video_id}", response_model=TutorialVideoOut)
def update_tutorial_video(
    video_id: int,
    request: TutorialVideoUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TutorialVideoOut:
    video = survey_service.get_video(db, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    updated = survey_service.update_video(
        db,
        video,
        title=request.title,
        sort_order=request.sort_order,
    )
    return TutorialVideoOut.model_validate(updated)


@router.delete("/admin/tutorial-videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tutorial_video(
    video_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    video = survey_service.get_video(db, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    survey_service.delete_video(db, video)
