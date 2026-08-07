"""Self-service profile updates: display name, avatar, theme, and password."""

from __future__ import annotations

import uuid

from fastapi import UploadFile
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.http.config import API_PREFIX, UPLOADS_DIR
from backend_api.http.schemas.auth import ChangePasswordRequest, UpdateProfileRequest, UserOut
from backend_api.http.services.auth_service import get_user_by_email, hash_password, verify_password

AVATARS_DIR = UPLOADS_DIR / "avatars"
ALLOWED_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_AVATAR_BYTES = 2 * 1024 * 1024
VALID_THEMES = {"light", "dark", "system"}


def user_out(user: User) -> UserOut:
    theme = user.theme if user.theme in VALID_THEMES else "system"
    pipelines = {row.pipeline_type for row in (user.feedback_surveys or [])}
    silo_done = "siloDesign" in pipelines
    mulo_done = "muloDesign" in pipelines
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        theme=theme,  # type: ignore[arg-type]
        is_admin=bool(user.role is not None and user.role.is_system),
        is_active=user.is_active,
        email_verified=bool(user.email_verified),
        plan_id=user.plan_id,
        plan_name=user.plan.name if user.plan is not None else None,
        role_id=user.role_id,
        role_name=user.role.name if user.role is not None else None,
        actions=user.action_codes(),
        created_at=user.created_at,
        profile_survey_completed=user.profile_survey_completed_at is not None,
        feedback_survey_completed=silo_done and mulo_done,
        feedback_survey_completed_silo=silo_done,
        feedback_survey_completed_mulo=mulo_done,
        tutorial_dont_show_again=bool(user.tutorial_dont_show_again),
    )


def update_profile(db: Session, user: User, request: UpdateProfileRequest) -> User:
    email_changed = False
    if request.display_name is not None:
        user.display_name = request.display_name.strip() or None

    if request.theme is not None:
        user.theme = request.theme

    if request.email is not None:
        normalized = request.email.lower().strip()
        if normalized != user.email:
            if not user.password_hash:
                raise ValueError("This account uses SSO login; email cannot be changed here")
            if not request.current_password:
                raise ValueError("Current password is required to change email")
            if not verify_password(request.current_password, user.password_hash):
                raise ValueError("Current password is incorrect")
            if get_user_by_email(db, normalized) is not None:
                raise ValueError("Unable to update email")
            user.email = normalized
            user.email_verified = False
            email_changed = True

    db.add(user)
    db.commit()
    db.refresh(user)

    if email_changed:
        from backend_api.http.services.email_service import send_verification_email
        from backend_api.http.services import session_service, token_service

        session_service.revoke_all_user_sessions(db, user.id)
        raw_token = token_service.create_email_verify_token(db, user)
        send_verification_email(to=user.email, token=raw_token)

    return user


def change_password(db: Session, user: User, request: ChangePasswordRequest) -> None:
    from backend_api.http.services.password_policy import validate_password

    if not user.password_hash:
        raise ValueError("This account uses SSO login and has no password set")
    if not verify_password(request.current_password, user.password_hash):
        raise ValueError("Current password is incorrect")
    validate_password(
        request.new_password,
        email=user.email,
        display_name=user.display_name,
    )
    user.password_hash = hash_password(request.new_password)
    db.add(user)
    db.commit()


def _remove_avatar_file(avatar_url: str | None) -> None:
    if not avatar_url:
        return
    prefix = f"{API_PREFIX}/uploads/avatars/"
    if not avatar_url.startswith(prefix):
        return
    filename = avatar_url.removeprefix(prefix)
    path = AVATARS_DIR / filename
    if path.is_file():
        path.unlink()


async def save_avatar(db: Session, user: User, file: UploadFile) -> User:
    content_type = (file.content_type or "").lower()
    extension = ALLOWED_AVATAR_TYPES.get(content_type)
    if extension is None:
        raise ValueError("Avatar must be a JPEG, PNG, WebP, or GIF image")

    data = await file.read()
    if not data:
        raise ValueError("Avatar file is empty")
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError("Avatar must be 2 MB or smaller")

    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    _remove_avatar_file(user.avatar_url)

    filename = f"user_{user.id}_{uuid.uuid4().hex[:8]}{extension}"
    path = AVATARS_DIR / filename
    path.write_bytes(data)

    user.avatar_url = f"{API_PREFIX}/uploads/avatars/{filename}"
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def remove_avatar(db: Session, user: User) -> User:
    _remove_avatar_file(user.avatar_url)
    user.avatar_url = None
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
