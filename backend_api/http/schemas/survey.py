"""Pydantic schemas for surveys and tutorial onboarding status."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend_api.http.schemas.tutorials import TutorialVideoOut

ExperienceLevel = Literal["None", "Beginner", "Intermediate", "Advanced"]
DegreeLevel = Literal["Bachelor's", "Master's", "PhD", "Other"]
MajorField = Literal[
    "Electrical Engineering",
    "Mechanical Engineering",
    "Chemical Engineering",
    "Aerospace Engineering",
    "Computer Science",
    "Control Engineering",
    "Mechatronics",
    "Other",
]
TutorialDismissAction = Literal["remind_later", "dont_show_again"]
FeedbackPipelineType = Literal["siloDesign", "muloDesign"]


class SurveySettings(BaseModel):
    enabled: bool = True


class SurveySettingsUpdate(BaseModel):
    enabled: bool | None = None


class SurveyStatusResponse(BaseModel):
    enabled: bool
    needs_profile_survey: bool
    feedback_completed: bool
    feedback_completed_silo: bool = False
    feedback_completed_mulo: bool = False
    show_tutorial: bool
    videos: list[TutorialVideoOut]


class ProfileSurveyRequest(BaseModel):
    university: str = Field(min_length=1, max_length=200)
    degree: DegreeLevel
    major: MajorField
    matlab_experience: ExperienceLevel
    control_design_experience: ExperienceLevel


class FeedbackSurveyRequest(BaseModel):
    pipeline_type: FeedbackPipelineType
    satisfaction: int = Field(ge=1, le=5)
    ease_of_use: int = Field(ge=1, le=5)
    product_value: int = Field(ge=1, le=5)
    confidence: int = Field(ge=1, le=5)
    reuse_intention: int = Field(ge=1, le=5)
    willingness_to_pay: int = Field(ge=1, le=5)
    main_problems: str = Field(default="", max_length=4000)


class TutorialDismissRequest(BaseModel):
    action: TutorialDismissAction


class ProfileSurveyResponseOut(BaseModel):
    user_id: int
    email: str
    university: str | None
    degree: str | None
    major: str | None
    matlab_experience: str | None
    control_design_experience: str | None
    completed_at: datetime | None


class FeedbackSurveyResponseOut(BaseModel):
    user_id: int
    email: str
    pipeline_type: FeedbackPipelineType
    satisfaction: int
    ease_of_use: int
    product_value: int
    confidence: int
    reuse_intention: int
    willingness_to_pay: int
    main_problems: str
    created_at: datetime


class SurveyResponsesOut(BaseModel):
    profile: list[ProfileSurveyResponseOut]
    feedback: list[FeedbackSurveyResponseOut]
