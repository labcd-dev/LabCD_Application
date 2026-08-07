"""Public SSO routes: list providers, start OAuth, handle callback."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from backend_api.db.session import get_db
from backend_api.http.schemas.sso import SsoProviderPublicOut
from backend_api.http.services import audit_service
from backend_api.http.services.auth_service import client_ip_from_request, record_login_attempt
from backend_api.http.services import sso_service

router = APIRouter(prefix="/auth/sso", tags=["auth-sso"])


@router.get("/providers", response_model=list[SsoProviderPublicOut])
def list_sso_providers(db: Session = Depends(get_db)) -> list[SsoProviderPublicOut]:
    rows = sso_service.list_enabled_providers(db)
    return [SsoProviderPublicOut(**sso_service.provider_public_dict(row)) for row in rows]


@router.get("/{provider}/start")
def start_sso(
    provider: str,
    http_request: Request,
    redirect_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if provider not in sso_service.SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown SSO provider")

    row = sso_service.get_provider(db, provider)
    if row is None or not row.enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SSO provider is not available",
        )
    if not row.client_id or not row.client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SSO provider is not configured",
        )

    state = sso_service.create_oauth_state(
        db,
        provider=provider,
        redirect_to=redirect_to or "/studio",
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="auth.sso.start",
        category="auth",
        actor=None,
        resource_type="sso_provider",
        resource_id=row.id,
        success=True,
        details={"provider": provider},
    )
    return RedirectResponse(
        url=sso_service.build_authorize_url(row, state),
        status_code=status.HTTP_302_FOUND,
    )


@router.get("/{provider}/callback")
def sso_callback(
    provider: str,
    http_request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    ip = client_ip_from_request(http_request)
    user_agent = http_request.headers.get("user-agent")

    def fail(message: str, *, email: str = "unknown") -> RedirectResponse:
        record_login_attempt(
            db,
            email=email,
            success=False,
            ip_address=ip,
            user_agent=user_agent,
            failure_reason="sso_failed",
        )
        audit_service.record_from_request(
            db,
            http_request,
            action="auth.sso.callback",
            category="auth",
            actor=None,
            resource_type="sso_provider",
            success=False,
            details={"provider": provider, "error": message},
        )
        return RedirectResponse(
            url=sso_service.frontend_error_url(message),
            status_code=status.HTTP_302_FOUND,
        )

    if provider not in sso_service.SUPPORTED_PROVIDERS:
        return fail("Unknown SSO provider")
    if error:
        return fail(error_description or error)
    if not code or not state:
        return fail("Missing OAuth code or state")

    state_row = sso_service.consume_oauth_state(db, state, provider)
    if state_row is None:
        return fail("Invalid or expired OAuth state")

    row = sso_service.get_provider(db, provider)
    if row is None or not row.enabled:
        return fail("SSO provider is not available")

    try:
        profile = sso_service.fetch_oauth_profile(row, code)
        user = sso_service.resolve_or_create_user(db, provider=provider, profile=profile)
        token = sso_service.issue_sso_token(
            db,
            user,
            ip_address=ip,
            user_agent=user_agent,
        )
    except sso_service.SsoError as exc:
        return fail(str(exc))
    except Exception:
        return fail("SSO login failed")

    audit_service.record_from_request(
        db,
        http_request,
        action="auth.sso.callback",
        category="auth",
        actor=user,
        resource_type="sso_provider",
        resource_id=row.id,
        success=True,
        details={"provider": provider},
    )
    return RedirectResponse(
        url=sso_service.frontend_callback_url(
            access_token=token,
            redirect_to=state_row.redirect_to,
        ),
        status_code=status.HTTP_302_FOUND,
    )
