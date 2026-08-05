"""Pydantic schemas for auth, plans, and user administration."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

ThemeMode = Literal["light", "dark", "system"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ActionOut(BaseModel):
    code: str
    description: str


class PlanOut(BaseModel):
    id: int
    name: str
    description: str
    price: float
    is_active: bool
    actions: list[str]
    models: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class PlanCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    price: float = Field(default=0, ge=0)
    actions: list[str] = Field(default_factory=list)
    models: list[str] = Field(default_factory=list)
    is_active: bool = True


class PlanUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    price: float | None = Field(default=None, ge=0)
    actions: list[str] | None = None
    models: list[str] | None = None
    is_active: bool | None = None


class DefaultPlanOut(BaseModel):
    plan_id: int | None
    plan: PlanOut | None = None


class SetDefaultPlanRequest(BaseModel):
    plan_id: int


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str | None = None
    avatar_url: str | None = None
    theme: ThemeMode = "system"
    is_admin: bool
    is_active: bool
    plan_id: int | None = None
    plan_name: str | None = None
    actions: list[str]
    created_at: datetime
    profile_survey_completed: bool = False
    feedback_survey_completed: bool = False
    feedback_survey_completed_silo: bool = False
    feedback_survey_completed_mulo: bool = False
    tutorial_dont_show_again: bool = False

    model_config = {"from_attributes": True}


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    theme: ThemeMode | None = None
    current_password: str | None = Field(default=None, min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6)


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    is_admin: bool = False
    plan_id: int | None = None


class UpdateUserRequest(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None
    password: str | None = Field(default=None, min_length=6)
    plan_id: int | None = None


class UserProfileSurveyOut(BaseModel):
    university: str | None
    degree: str | None
    major: str | None
    matlab_experience: str | None
    control_design_experience: str | None
    completed_at: datetime | None


class UserFeedbackSurveyOut(BaseModel):
    pipeline_type: str
    satisfaction: int
    ease_of_use: int
    product_value: int
    confidence: int
    reuse_intention: int
    willingness_to_pay: int
    main_problems: str
    created_at: datetime


class LoginHistoryOut(BaseModel):
    id: int
    email: str
    success: bool
    ip_address: str | None = None
    user_agent: str | None = None
    failure_reason: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminUserDetailOut(BaseModel):
    user: UserOut
    allowed_models: list[str]
    profile_survey: UserProfileSurveyOut | None = None
    feedback_surveys: list[UserFeedbackSurveyOut] = []
    projects: list["ProjectSummary"]
    errors: list["ErrorEventOut"]
    login_history: list[LoginHistoryOut] = []


# Avoid circular imports at runtime; populated after sibling schemas load.
from backend_api.http.schemas.error_tracking import ErrorEventOut  # noqa: E402
from backend_api.http.schemas.projects import ProjectSummary  # noqa: E402

AdminUserDetailOut.model_rebuild()
