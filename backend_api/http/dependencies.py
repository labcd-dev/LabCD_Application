"""FastAPI dependencies for authentication and authorization."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from collections.abc import Generator

from backend_api.db.models import AuthSession, User
from backend_api.db.session import SessionLocal, get_db
from backend_api.http.services.auth_service import decode_access_token, get_user_by_id
from backend_api.http.services.developer_api_key_service import (
    KEY_PREFIX,
    authenticate_api_key,
)
from backend_api.http.services.job_store import Job
from backend_api.http.services import session_service

bearer_scheme = HTTPBearer(auto_error=False)
_TOUCH_INTERVAL_SECONDS = 60


def _maybe_touch_session(db: Session, session: AuthSession) -> None:
    now = datetime.now(timezone.utc)
    last = session.last_seen_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if (now - last).total_seconds() >= _TOUCH_INTERVAL_SECONDS:
        session_service.touch_session(db, session)
        from backend_api.http.services import analytics_service

        analytics_service.record_active_day(db, session.user_id)


def _load_user_and_session(
    token: str,
    db: Session,
    *,
    require_verified: bool = True,
) -> tuple[User, AuthSession]:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
        jti = str(payload.get("jti") or "")
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    if not jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    session = session_service.get_active_session_by_jti(db, jti)
    if session is None or session.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = get_user_by_id(db, user_id)
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if require_verified and not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before continuing.",
        )

    _maybe_touch_session(db, session)
    return user, session


def _extract_bearer_token(
    credentials: HTTPAuthorizationCredentials | None,
    access_token: str | None,
) -> str | None:
    if credentials is not None and credentials.scheme.lower() == "bearer":
        return credentials.credentials
    if access_token:
        return access_token
    return None


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate via Bearer header, or access_token query (for EventSource streams)."""
    token = _extract_bearer_token(credentials, access_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user, _session = _load_user_and_session(token, db)
    return user


def get_current_user_and_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> tuple[User, AuthSession]:
    token = _extract_bearer_token(credentials, access_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _load_user_and_session(token, db)


def get_current_user_and_session_allow_unverified(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> tuple[User, AuthSession]:
    """Like get_current_user_and_session but allows unverified accounts (logout)."""
    token = _extract_bearer_token(credentials, access_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _load_user_and_session(token, db, require_verified=False)


def get_db_if_authenticated(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
) -> Generator[Session | None, None, None]:
    """Acquire a DB session ONLY if an auth token is provided; otherwise yield None without touching the DB pool."""
    token = _extract_bearer_token(credentials, access_token)
    if not token:
        yield None
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
    db: Session | None = Depends(get_db_if_authenticated),
) -> User | None:
    """Return the current user when a valid token is present; otherwise None without touching DB."""
    if db is None:
        return None
    token = _extract_bearer_token(credentials, access_token)
    if not token:
        return None
    try:
        user, _session = _load_user_and_session(token, db)
        return user
    except HTTPException:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require admin-area access (any user with admin:access)."""
    if not user.has_action("admin:access"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def get_user_from_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate a developer via X-API-Key or Bearer labcd_… token."""
    raw: str | None = None
    if x_api_key and x_api_key.strip():
        raw = x_api_key.strip()
    elif credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials.strip()
        if token.startswith(KEY_PREFIX):
            raw = token

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    user = authenticate_api_key(db, raw)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return user


def require_action(action_code: str):
    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not user.has_action(action_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required action: {action_code}",
            )
        return user

    return _dependency


def require_api_key_action(action_code: str):
    """Like require_action, but for developer API-key auth."""

    def _dependency(user: User = Depends(get_user_from_api_key)) -> User:
        if not user.has_action(action_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required action: {action_code}",
            )
        return user

    return _dependency


def assert_model_allowed(user: User, model: str | None) -> None:
    """Reject models that are not entitled on the user's plan."""
    if not model or not str(model).strip():
        return
    normalized = str(model).strip()
    if user.has_model(normalized):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Model not allowed for your plan: {normalized}",
    )


def assert_job_access(job: Job, user: User) -> None:
    if user.role is not None and user.role.is_system:
        return
    if user.has_action("admin:projects"):
        return
    if job.user_id is None or job.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Job access denied")
