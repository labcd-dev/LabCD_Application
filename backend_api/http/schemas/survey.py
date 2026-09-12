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
FeedbackPipelineType = Literal["siloDesign", "muloDesign", "adaptiveDesign", "mpcDesign"]


class SurveySettings(BaseModel):
    enabled: bool = True


class SurveySettingsUpdate(BaseModel):
    enabled: bool | None = None


class SurveyStatusResponse(BaseModel):
    enabled: bool
    needs_profile_survey: bool
    before_test_completed: bool = False
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
    job_id: str | None = None
    project_id: int | None = None
    plant_name: str | None = None
    score: float | None = None
    success: bool | None = None

    # WS04 Outro questions
    technical_usefulness: int | None = Field(default=None, ge=1, le=5)
    technical_usefulness_na: bool = False
    trust: int | None = Field(default=None, ge=1, le=5)
    trust_na: bool = False
    ease_of_use: int = Field(default=4, ge=1, le=5)
    reuse_intention: int = Field(default=4, ge=1, le=5)
    nps: int | None = Field(default=None, ge=0, le=10)
    main_problems: str = Field(default="", max_length=4000)
    is_bug: bool = False

    # Backward compatibility fields (defaulted if not provided)
    satisfaction: int = Field(default=4, ge=1, le=5)
    product_value: int = Field(default=4, ge=1, le=5)
    confidence: int = Field(default=4, ge=1, le=5)
    willingness_to_pay: int = Field(default=3, ge=1, le=5)


class BeforeTestSurveyRequest(BaseModel):
    q1_last_worked: str = Field(min_length=1, max_length=100)
    q2_time_spent: str = Field(default="", max_length=100)
    q3_knowledge_gaps: int = Field(default=3, ge=1, le=5)
    q4_difficult_parts: list[str] = Field(default_factory=list)
    q5_biggest_problem: str = Field(default="", max_length=4000)
    q6_help_sources: list[str] = Field(default_factory=list)
    q7_considered_paying: str = Field(min_length=1, max_length=100)
    q8a_amount_hired: str | None = None
    q8b_amount_paid_to_user: str | None = None
    q9_impact: list[str] = Field(default_factory=list)


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
    id: int | None = None
    user_id: int
    email: str
    pipeline_type: FeedbackPipelineType
    job_id: str | None = None
    project_id: int | None = None
    plant_name: str | None = None
    score: float | None = None
    success: bool | None = None
    technical_usefulness: int | None = None
    technical_usefulness_na: bool = False
    trust: int | None = None
    trust_na: bool = False
    satisfaction: int
    ease_of_use: int
    product_value: int
    confidence: int
    reuse_intention: int
    willingness_to_pay: int
    nps: int | None = None
    main_problems: str
    is_bug: bool = False
    created_at: datetime


class BeforeTestSurveyResponseOut(BaseModel):
    id: int
    user_id: int
    email: str
    q1_last_worked: str
    q2_time_spent: str
    q3_knowledge_gaps: int
    q4_difficult_parts: list[str]
    q5_biggest_problem: str
    q6_help_sources: list[str]
    q7_considered_paying: str
    q8a_amount_hired: str | None = None
    q8b_amount_paid_to_user: str | None = None
    q9_impact: list[str]
    created_at: datetime


class SurveyResponsesOut(BaseModel):
    profile: list[ProfileSurveyResponseOut]
    feedback: list[FeedbackSurveyResponseOut]
    before_test: list[BeforeTestSurveyResponseOut] = []
