"""Login rate limiting: lock account and IP after repeated failures."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import IpLockout, LoginHistory, User
from backend_api.http.config import (
    LOGIN_FAIL_MAX_ATTEMPTS,
    LOGIN_FAIL_WINDOW_SECONDS,
    LOGIN_LOCKOUT_MINUTES,
)

LOCKOUT_DETAIL = "Too many attempts. Try again later."


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def is_user_locked(user: User | None) -> bool:
    if user is None or user.locked_until is None:
        return False
    return _as_aware(user.locked_until) > _utcnow()


def is_ip_locked(db: Session, ip_address: str | None) -> bool:
    if not ip_address:
        return False
    row = db.query(IpLockout).filter(IpLockout.ip_address == ip_address).first()
    if row is None:
        return False
    return _as_aware(row.locked_until) > _utcnow()


def is_login_locked(
    db: Session,
    *,
    user: User | None,
    ip_address: str | None,
) -> bool:
    return is_user_locked(user) or is_ip_locked(db, ip_address)


def _count_recent_failures(
    db: Session,
    *,
    email: str | None = None,
    ip_address: str | None = None,
) -> int:
    since = _utcnow() - timedelta(seconds=LOGIN_FAIL_WINDOW_SECONDS)
    query = db.query(LoginHistory).filter(
        LoginHistory.success.is_(False),
        LoginHistory.created_at >= since,
    )
    if email is not None:
        query = query.filter(LoginHistory.email == email.lower().strip())
    if ip_address is not None:
        query = query.filter(LoginHistory.ip_address == ip_address)
    return query.count()


def apply_failure_lockouts(
    db: Session,
    *,
    user: User | None,
    email: str,
    ip_address: str | None,
) -> None:
    """After a failed attempt is recorded, lock email and/or IP if thresholds hit."""
    lock_until = _utcnow() + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)

    email_failures = _count_recent_failures(db, email=email)
    if user is not None and email_failures >= LOGIN_FAIL_MAX_ATTEMPTS:
        user.locked_until = lock_until
        db.add(user)

    if ip_address:
        ip_failures = _count_recent_failures(db, ip_address=ip_address)
        if ip_failures >= LOGIN_FAIL_MAX_ATTEMPTS:
            row = db.query(IpLockout).filter(IpLockout.ip_address == ip_address).first()
            if row is None:
                row = IpLockout(ip_address=ip_address, locked_until=lock_until)
            else:
                row.locked_until = lock_until
            db.add(row)

    db.commit()


def clear_user_lock(db: Session, user: User) -> None:
    if user.locked_until is not None:
        user.locked_until = None
        db.add(user)
        db.commit()
