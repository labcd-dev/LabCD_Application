"""Pydantic schemas for auth and user administration."""

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


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str | None = None
    avatar_url: str | None = None
    theme: ThemeMode = "system"
    is_admin: bool
    is_active: bool
    actions: list[str]
    created_at: datetime

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
    actions: list[str] = Field(default_factory=list)


class UpdateUserActionsRequest(BaseModel):
    actions: list[str]


class UpdateUserRequest(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None
    password: str | None = Field(default=None, min_length=6)
