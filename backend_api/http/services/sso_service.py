"""Google / GitHub OAuth SSO: provider CRUD, authorize, callback, JIT users."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from backend_api.db.models import SsoProvider, SsoState, User, UserIdentity
from backend_api.http.config import API_PREFIX, API_PUBLIC_URL, APP_PUBLIC_URL
from backend_api.http.services.auth_service import (
    create_access_token,
    create_user,
    get_user_by_email,
    record_login_attempt,
)
from backend_api.http.services import session_service

SUPPORTED_PROVIDERS = frozenset({"google", "github"})
STATE_TTL_MINUTES = 10
DEFAULT_DISPLAY_NAMES = {
    "google": "Google",
    "github": "GitHub",
}


class SsoError(Exception):
    """Raised for SSO configuration or IdP failures."""


@dataclass(frozen=True)
class OAuthProfile:
    subject: str
    email: str
    display_name: str | None = None
    avatar_url: str | None = None


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "••••"
    return f"••••{value[-4:]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def redirect_uri_for(provider: str) -> str:
    return f"{API_PUBLIC_URL}{API_PREFIX}/auth/sso/{provider}/callback"


def sanitize_redirect_to(value: str | None) -> str:
    raw = (value or "/studio").strip() or "/studio"
    if not raw.startswith("/") or raw.startswith("//") or "://" in raw:
        return "/studio"
    return raw


def get_provider(db: Session, provider: str) -> SsoProvider | None:
    return (
        db.query(SsoProvider)
        .filter(SsoProvider.provider == provider)
        .first()
    )


def get_provider_by_id(db: Session, provider_id: int) -> SsoProvider | None:
    return db.query(SsoProvider).filter(SsoProvider.id == provider_id).first()


def list_enabled_providers(db: Session) -> list[SsoProvider]:
    return (
        db.query(SsoProvider)
        .filter(SsoProvider.enabled.is_(True))
        .order_by(SsoProvider.provider.asc())
        .all()
    )


def list_all_providers(db: Session) -> list[SsoProvider]:
    return db.query(SsoProvider).order_by(SsoProvider.provider.asc()).all()


def provider_admin_dict(row: SsoProvider) -> dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "display_name": row.display_name,
        "client_id": row.client_id,
        "client_secret_configured": bool(row.client_secret),
        "client_secret_masked": _mask_secret(row.client_secret),
        "enabled": row.enabled,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def provider_public_dict(row: SsoProvider) -> dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "display_name": row.display_name,
    }


def create_provider(
    db: Session,
    *,
    provider: str,
    display_name: str,
    client_id: str,
    client_secret: str,
    enabled: bool = False,
) -> SsoProvider:
    if provider not in SUPPORTED_PROVIDERS:
        raise SsoError("Unsupported SSO provider")
    if get_provider(db, provider) is not None:
        raise SsoError(f"{provider} is already configured")

    name = display_name.strip() or DEFAULT_DISPLAY_NAMES.get(provider, provider.title())
    row = SsoProvider(
        provider=provider,
        display_name=name,
        client_id=client_id.strip(),
        client_secret=client_secret.strip(),
        enabled=enabled,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_provider(
    db: Session,
    row: SsoProvider,
    *,
    display_name: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    enabled: bool | None = None,
) -> SsoProvider:
    if display_name is not None:
        row.display_name = display_name.strip() or row.display_name
    if client_id is not None:
        row.client_id = client_id.strip()
    if client_secret is not None and client_secret.strip():
        row.client_secret = client_secret.strip()
    if enabled is not None:
        row.enabled = enabled
    row.updated_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_provider(db: Session, row: SsoProvider) -> None:
    db.delete(row)
    db.commit()


def create_oauth_state(
    db: Session,
    *,
    provider: str,
    redirect_to: str,
) -> str:
    state = secrets.token_urlsafe(32)
    db.add(
        SsoState(
            state=state,
            provider=provider,
            redirect_to=sanitize_redirect_to(redirect_to),
            expires_at=_now() + timedelta(minutes=STATE_TTL_MINUTES),
        )
    )
    db.commit()
    return state


def consume_oauth_state(db: Session, state: str, provider: str) -> SsoState | None:
    row = db.query(SsoState).filter(SsoState.state == state).first()
    if row is None:
        return None
    db.delete(row)
    db.commit()
    if row.provider != provider:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < _now():
        return None
    return row


def build_authorize_url(row: SsoProvider, state: str) -> str:
    redirect_uri = redirect_uri_for(row.provider)
    if row.provider == "google":
        params = {
            "client_id": row.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "online",
            "prompt": "select_account",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    if row.provider == "github":
        params = {
            "client_id": row.client_id,
            "redirect_uri": redirect_uri,
            "scope": "read:user user:email",
            "state": state,
        }
        return f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    raise SsoError("Unsupported SSO provider")


def _exchange_google(row: SsoProvider, code: str) -> OAuthProfile:
    redirect_uri = redirect_uri_for("google")
    with httpx.Client(timeout=30.0) as client:
        token_resp = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": row.client_id,
                "client_secret": row.client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code >= 400:
            raise SsoError("Google token exchange failed")
        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise SsoError("Google did not return an access token")

        user_resp = client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_resp.status_code >= 400:
            raise SsoError("Google userinfo request failed")
        data = user_resp.json()

    email = (data.get("email") or "").strip().lower()
    subject = str(data.get("sub") or "").strip()
    if not email or not subject:
        raise SsoError("Google account is missing email or subject")
    if data.get("email_verified") is False:
        raise SsoError("Google email is not verified")

    return OAuthProfile(
        subject=subject,
        email=email,
        display_name=(data.get("name") or "").strip() or None,
        avatar_url=(data.get("picture") or "").strip() or None,
    )


def _exchange_github(row: SsoProvider, code: str) -> OAuthProfile:
    redirect_uri = redirect_uri_for("github")
    headers = {
        "Accept": "application/json",
        "User-Agent": "LabCD-SSO",
    }
    with httpx.Client(timeout=30.0, headers=headers) as client:
        token_resp = client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": row.client_id,
                "client_secret": row.client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        if token_resp.status_code >= 400:
            raise SsoError("GitHub token exchange failed")
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise SsoError(token_data.get("error_description") or "GitHub token exchange failed")

        auth_headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "LabCD-SSO",
        }
        user_resp = client.get("https://api.github.com/user", headers=auth_headers)
        if user_resp.status_code >= 400:
            raise SsoError("GitHub user request failed")
        user_data = user_resp.json()

        emails_resp = client.get("https://api.github.com/user/emails", headers=auth_headers)
        if emails_resp.status_code >= 400:
            raise SsoError("GitHub email request failed")
        emails = emails_resp.json()

    subject = str(user_data.get("id") or "").strip()
    if not subject:
        raise SsoError("GitHub account is missing subject")

    email = ""
    if isinstance(emails, list):
        primary_verified = next(
            (
                item
                for item in emails
                if isinstance(item, dict)
                and item.get("primary")
                and item.get("verified")
                and item.get("email")
            ),
            None,
        )
        any_verified = next(
            (
                item
                for item in emails
                if isinstance(item, dict) and item.get("verified") and item.get("email")
            ),
            None,
        )
        chosen = primary_verified or any_verified
        if chosen is not None:
            email = str(chosen["email"]).strip().lower()

    if not email:
        fallback = (user_data.get("email") or "").strip().lower()
        email = fallback
    if not email:
        raise SsoError("GitHub account has no verified email")

    return OAuthProfile(
        subject=subject,
        email=email,
        display_name=(user_data.get("name") or user_data.get("login") or "").strip() or None,
        avatar_url=(user_data.get("avatar_url") or "").strip() or None,
    )


def fetch_oauth_profile(row: SsoProvider, code: str) -> OAuthProfile:
    if row.provider == "google":
        return _exchange_google(row, code)
    if row.provider == "github":
        return _exchange_github(row, code)
    raise SsoError("Unsupported SSO provider")


def _find_identity(db: Session, provider: str, subject: str) -> UserIdentity | None:
    return (
        db.query(UserIdentity)
        .filter(
            UserIdentity.provider == provider,
            UserIdentity.provider_subject == subject,
        )
        .first()
    )


def resolve_or_create_user(
    db: Session,
    *,
    provider: str,
    profile: OAuthProfile,
) -> User:
    from backend_api.http.services.auth_service import get_user_by_id

    identity = _find_identity(db, provider, profile.subject)
    if identity is not None:
        user = get_user_by_id(db, identity.user_id)
        if user is None:
            raise SsoError("Linked user no longer exists")
        if not user.is_active:
            raise SsoError("Account is inactive")
        if identity.email != profile.email:
            identity.email = profile.email
            db.add(identity)
            db.commit()
        return user

    user = get_user_by_email(db, profile.email)
    if user is None:
        user = create_user(
            db,
            email=profile.email,
            password=None,
            email_verified=True,
            display_name=profile.display_name,
            avatar_url=profile.avatar_url,
        )
    else:
        if not user.is_active:
            raise SsoError("Account is inactive")
        if not user.email_verified:
            user.email_verified = True
        if profile.display_name and not user.display_name:
            user.display_name = profile.display_name
        if profile.avatar_url and not user.avatar_url:
            user.avatar_url = profile.avatar_url
        db.add(user)
        db.commit()
        db.refresh(user)

    db.add(
        UserIdentity(
            user_id=user.id,
            provider=provider,
            provider_subject=profile.subject,
            email=profile.email,
        )
    )
    db.commit()
    return user


def issue_sso_token(
    db: Session,
    user: User,
    *,
    ip_address: str | None,
    user_agent: str | None,
) -> str:
    auth_session = session_service.create_session(
        db,
        user_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    record_login_attempt(
        db,
        email=user.email,
        success=True,
        user_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return create_access_token(user.id, user.email, jti=auth_session.jti)


def frontend_callback_url(*, access_token: str, redirect_to: str) -> str:
    safe_redirect = sanitize_redirect_to(redirect_to)
    fragment = urlencode(
        {
            "access_token": access_token,
            "redirect_to": safe_redirect,
        }
    )
    return f"{APP_PUBLIC_URL}/login/sso#{fragment}"


def frontend_error_url(message: str) -> str:
    fragment = urlencode({"error": message})
    return f"{APP_PUBLIC_URL}/login/sso#{fragment}"
