"""Single-use auth tokens for email verification and password reset."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import AuthToken, User
from backend_api.http.config import (
    EMAIL_VERIFY_EXPIRE_HOURS,
    EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS,
    PASSWORD_RESET_EXPIRE_HOURS,
)

PURPOSE_EMAIL_VERIFY = "email_verify"
PURPOSE_PASSWORD_RESET = "password_reset"


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_auth_token(
    db: Session,
    *,
    user: User,
    purpose: str,
    expire_hours: float,
    invalidate_previous: bool = True,
) -> str:
    """Create a single-use token; returns the raw token for emailing."""
    if invalidate_previous:
        now = _utcnow()
        pending = (
            db.query(AuthToken)
            .filter(
                AuthToken.user_id == user.id,
                AuthToken.purpose == purpose,
                AuthToken.used_at.is_(None),
            )
            .all()
        )
        for row in pending:
            row.used_at = now
            db.add(row)

    raw = secrets.token_urlsafe(32)
    row = AuthToken(
        user_id=user.id,
        token_hash=_hash_token(raw),
        purpose=purpose,
        expires_at=_utcnow() + timedelta(hours=expire_hours),
    )
    db.add(row)
    db.commit()
    return raw


def create_email_verify_token(db: Session, user: User) -> str:
    return create_auth_token(
        db,
        user=user,
        purpose=PURPOSE_EMAIL_VERIFY,
        expire_hours=EMAIL_VERIFY_EXPIRE_HOURS,
    )


def create_password_reset_token(db: Session, user: User) -> str:
    return create_auth_token(
        db,
        user=user,
        purpose=PURPOSE_PASSWORD_RESET,
        expire_hours=PASSWORD_RESET_EXPIRE_HOURS,
    )


def consume_auth_token(
    db: Session,
    *,
    raw_token: str,
    purpose: str,
) -> AuthToken | None:
    """Mark token used and return it when valid; otherwise None."""
    if not raw_token.strip():
        return None
    row = (
        db.query(AuthToken)
        .filter(
            AuthToken.token_hash == _hash_token(raw_token.strip()),
            AuthToken.purpose == purpose,
        )
        .first()
    )
    if row is None:
        return None
    now = _utcnow()
    if row.used_at is not None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        return None
    row.used_at = now
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def latest_unused_token(
    db: Session,
    *,
    user_id: int,
    purpose: str,
) -> AuthToken | None:
    return (
        db.query(AuthToken)
        .filter(
            AuthToken.user_id == user_id,
            AuthToken.purpose == purpose,
            AuthToken.used_at.is_(None),
        )
        .order_by(AuthToken.created_at.desc())
        .first()
    )


def is_resend_cooling_down(db: Session, user_id: int) -> bool:
    latest = latest_unused_token(
        db, user_id=user_id, purpose=PURPOSE_EMAIL_VERIFY
    )
    if latest is None:
        # Also check most recent used/any verify token for cooldown after send.
        latest = (
            db.query(AuthToken)
            .filter(
                AuthToken.user_id == user_id,
                AuthToken.purpose == PURPOSE_EMAIL_VERIFY,
            )
            .order_by(AuthToken.created_at.desc())
            .first()
        )
    if latest is None:
        return False
    created = latest.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    elapsed = (_utcnow() - created).total_seconds()
    return elapsed < EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS
