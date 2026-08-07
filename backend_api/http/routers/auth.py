"""Authentication routes: login, register, verify, reset, sessions, profile."""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from backend_api.db.models import AuthSession, User
from backend_api.db.session import get_db
from backend_api.http.dependencies import (
    get_current_user,
    get_current_user_and_session,
    get_current_user_and_session_allow_unverified,
)
from backend_api.http.schemas.auth import (
    ChangePasswordRequest,
    EmailOnlyRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionOut,
    TokenResponse,
    UpdateProfileRequest,
    UserOut,
    VerifyEmailRequest,
)
from backend_api.http.services import audit_service
from backend_api.http.services.auth_service import (
    authenticate_user_with_reason,
    burn_password_hash_cost,
    client_ip_from_request,
    create_access_token,
    create_user,
    get_user_by_email,
    get_user_by_id,
    hash_password,
    record_login_attempt,
)
from backend_api.http.services.email_service import (
    send_password_reset_email,
    send_verification_email,
)
from backend_api.http.services.lockout_service import (
    LOCKOUT_DETAIL,
    apply_failure_lockouts,
    clear_user_lock,
    is_login_locked,
)
from backend_api.http.services.password_policy import validate_password
from backend_api.http.services.profile_service import (
    change_password,
    remove_avatar,
    save_avatar,
    update_profile,
    user_out,
)
from backend_api.http.services import session_service, token_service

router = APIRouter(prefix="/auth", tags=["auth"])

REGISTER_MESSAGE = (
    "If registration is possible, a verification email has been sent."
)
RESEND_MESSAGE = (
    "If an unverified account exists for this email, a verification message was sent."
)
FORGOT_MESSAGE = "If an account exists, reset instructions were sent."


def _session_out(row: AuthSession, *, current_jti: str | None) -> SessionOut:
    return SessionOut(
        id=row.id,
        ip_address=row.ip_address,
        user_agent=row.user_agent,
        created_at=row.created_at,
        last_seen_at=row.last_seen_at,
        is_current=bool(current_jti and row.jti == current_jti),
    )


@router.post("/login", response_model=TokenResponse)
def login(
    request: LoginRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    ip = client_ip_from_request(http_request)
    user_agent = http_request.headers.get("user-agent")
    existing = get_user_by_email(db, request.email)

    if is_login_locked(db, user=existing, ip_address=ip):
        record_login_attempt(
            db,
            email=request.email,
            success=False,
            user_id=existing.id if existing is not None else None,
            ip_address=ip,
            user_agent=user_agent,
            failure_reason="locked",
        )
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.login",
            category="auth",
            actor=existing,
            actor_email=request.email,
            success=False,
            details={"reason": "locked"},
        )
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=LOCKOUT_DETAIL)

    user, failure_reason = authenticate_user_with_reason(db, request.email, request.password)

    if failure_reason == "unverified":
        record_login_attempt(
            db,
            email=request.email,
            success=False,
            user_id=user.id if user is not None else None,
            ip_address=ip,
            user_agent=user_agent,
            failure_reason=failure_reason,
        )
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.login",
            category="auth",
            actor=user,
            actor_email=request.email,
            success=False,
            details={"reason": failure_reason},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before signing in.",
        )

    if failure_reason is not None or user is None:
        record_login_attempt(
            db,
            email=request.email,
            success=False,
            user_id=user.id if user is not None else None,
            ip_address=ip,
            user_agent=user_agent,
            failure_reason=failure_reason,
        )
        lock_result = apply_failure_lockouts(
            db,
            user=user if user is not None else existing,
            email=request.email,
            ip_address=ip,
        )
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.login",
            category="auth",
            actor=user if user is not None else existing,
            actor_email=request.email,
            success=False,
            details={"reason": failure_reason or "unknown"},
        )
        if lock_result.get("user_locked") or lock_result.get("ip_locked"):
            audit_service.record_from_request(
                db,
                http_request,
                action="auth.lockout",
                category="auth",
                actor=user if user is not None else existing,
                actor_email=request.email,
                success=True,
                details=lock_result,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    clear_user_lock(db, user)
    auth_session = session_service.create_session(
        db,
        user_id=user.id,
        ip_address=ip,
        user_agent=user_agent,
    )
    record_login_attempt(
        db,
        email=request.email,
        success=True,
        user_id=user.id,
        ip_address=ip,
        user_agent=user_agent,
        failure_reason=None,
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.login",
        category="auth",
        actor=user,
        success=True,
    )
    token = create_access_token(user.id, user.email, jti=auth_session.jti)
    return TokenResponse(access_token=token)


@router.post("/register", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def register(
    request: RegisterRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    try:
        validate_password(request.password, email=request.email)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    existing = get_user_by_email(db, request.email)
    if existing is not None:
        burn_password_hash_cost()
        return MessageResponse(message=REGISTER_MESSAGE)

    user = create_user(
        db,
        email=request.email,
        password=request.password,
        is_admin=False,
        assign_default_plan=True,
        email_verified=False,
    )
    raw_token = token_service.create_email_verify_token(db, user)
    send_verification_email(to=user.email, token=raw_token)
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.register",
        category="auth",
        actor=user,
        resource_type="user",
        resource_id=user.id,
        success=True,
    )
    return MessageResponse(message=REGISTER_MESSAGE)


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(
    request: VerifyEmailRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    row = token_service.consume_auth_token(
        db,
        raw_token=request.token,
        purpose=token_service.PURPOSE_EMAIL_VERIFY,
    )
    if row is None:
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.verify_email",
            category="auth",
            success=False,
            details={"reason": "invalid_or_expired_token"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )
    user = get_user_by_id(db, row.user_id)
    if user is None:
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.verify_email",
            category="auth",
            success=False,
            details={"reason": "user_missing"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )
    user.email_verified = True
    db.add(user)
    db.commit()
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.verify_email",
        category="auth",
        actor=user,
        resource_type="user",
        resource_id=user.id,
        success=True,
    )
    return MessageResponse(message="Email verified. You can sign in now.")


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification(
    request: EmailOnlyRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_user_by_email(db, request.email)
    if (
        user is not None
        and user.is_active
        and not user.email_verified
        and not token_service.is_resend_cooling_down(db, user.id)
    ):
        raw_token = token_service.create_email_verify_token(db, user)
        send_verification_email(to=user.email, token=raw_token)
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.resend_verification",
            category="auth",
            actor=user,
            resource_type="user",
            resource_id=user.id,
            success=True,
        )
    return MessageResponse(message=RESEND_MESSAGE)


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    request: EmailOnlyRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = get_user_by_email(db, request.email)
    if user is not None and user.is_active and user.email_verified:
        raw_token = token_service.create_password_reset_token(db, user)
        send_password_reset_email(to=user.email, token=raw_token)
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.forgot_password",
            category="auth",
            actor=user,
            resource_type="user",
            resource_id=user.id,
            success=True,
        )
    return MessageResponse(message=FORGOT_MESSAGE)


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    request: ResetPasswordRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> MessageResponse:
    row = token_service.consume_auth_token(
        db,
        raw_token=request.token,
        purpose=token_service.PURPOSE_PASSWORD_RESET,
    )
    if row is None:
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.reset_password",
            category="auth",
            success=False,
            details={"reason": "invalid_or_expired_token"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )
    user = get_user_by_id(db, row.user_id)
    if user is None:
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.reset_password",
            category="auth",
            success=False,
            details={"reason": "user_missing"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )
    try:
        validate_password(
            request.new_password,
            email=user.email,
            display_name=user.display_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    user.password_hash = hash_password(request.new_password)
    db.add(user)
    db.commit()
    session_service.revoke_all_user_sessions(db, user.id)
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.reset_password",
        category="auth",
        actor=user,
        resource_type="user",
        resource_id=user.id,
        success=True,
    )
    return MessageResponse(message="Password updated. You can sign in with your new password.")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    http_request: Request,
    current: tuple[User, AuthSession] = Depends(get_current_user_and_session_allow_unverified),
    db: Session = Depends(get_db),
) -> None:
    user, auth_session = current
    session_service.revoke_session(db, auth_session)
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.logout",
        category="auth",
        actor=user,
        resource_type="session",
        resource_id=auth_session.id,
        success=True,
    )


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    current: tuple[User, AuthSession] = Depends(get_current_user_and_session),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    user, auth_session = current
    rows = session_service.list_user_sessions(db, user.id)
    return [_session_out(row, current_jti=auth_session.jti) for row in rows]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session_endpoint(
    session_id: int,
    http_request: Request,
    current: tuple[User, AuthSession] = Depends(get_current_user_and_session),
    db: Session = Depends(get_db),
) -> None:
    user, _auth_session = current
    row = session_service.revoke_session_by_id(db, session_id=session_id, user_id=user.id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.session.revoke",
        category="auth",
        actor=user,
        resource_type="session",
        resource_id=session_id,
        success=True,
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    request: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    try:
        updated = update_profile(db, user, request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return user_out(updated)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password_endpoint(
    request: ChangePasswordRequest,
    http_request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    try:
        change_password(db, user, request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.change_password",
        category="auth",
        actor=user,
        resource_type="user",
        resource_id=user.id,
        success=True,
    )


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    try:
        updated = await save_avatar(db, user, file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return user_out(updated)


@router.delete("/me/avatar", response_model=UserOut)
def delete_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    return user_out(remove_avatar(db, user))
