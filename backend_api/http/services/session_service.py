"""Server-side auth sessions bound to JWT jti values."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import AuthSession


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_session(
    db: Session,
    *,
    user_id: int,
    ip_address: str | None,
    user_agent: str | None,
) -> AuthSession:
    now = _utcnow()
    row = AuthSession(
        user_id=user_id,
        jti=secrets.token_urlsafe(24),
        ip_address=ip_address,
        user_agent=(user_agent[:512] if user_agent else None),
        created_at=now,
        last_seen_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    from backend_api.http.services.analytics_service import record_active_day

    record_active_day(db, user_id)
    return row


def get_active_session_by_jti(db: Session, jti: str) -> AuthSession | None:
    if not jti:
        return None
    return (
        db.query(AuthSession)
        .filter(AuthSession.jti == jti, AuthSession.revoked_at.is_(None))
        .first()
    )


def touch_session(db: Session, session: AuthSession) -> None:
    session.last_seen_at = _utcnow()
    db.add(session)
    db.commit()


def revoke_session(db: Session, session: AuthSession) -> None:
    if session.revoked_at is None:
        session.revoked_at = _utcnow()
        db.add(session)
        db.commit()


def revoke_session_by_id(
    db: Session,
    *,
    session_id: int,
    user_id: int | None = None,
) -> AuthSession | None:
    query = db.query(AuthSession).filter(AuthSession.id == session_id)
    if user_id is not None:
        query = query.filter(AuthSession.user_id == user_id)
    row = query.first()
    if row is None:
        return None
    revoke_session(db, row)
    return row


def revoke_all_user_sessions(db: Session, user_id: int) -> int:
    now = _utcnow()
    rows = (
        db.query(AuthSession)
        .filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .all()
    )
    for row in rows:
        row.revoked_at = now
        db.add(row)
    db.commit()
    return len(rows)


def list_user_sessions(db: Session, user_id: int) -> list[AuthSession]:
    return (
        db.query(AuthSession)
        .filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_seen_at.desc())
        .all()
    )
