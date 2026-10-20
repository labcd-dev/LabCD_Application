"""Self-service account closure: email confirm then soft delete."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.http.config import PRIVACY_EMAIL
from backend_api.http.services import session_service, token_service
from backend_api.http.services.auth_service import is_last_active_admin
from backend_api.http.services.email_service import send_close_account_email

logger = logging.getLogger(__name__)

CLOSE_ACCOUNT_MESSAGE = (
    "If your account can be closed, a confirmation email has been sent."
)


def request_close_account(db: Session, user: User) -> dict[str, str]:
    """Send confirmation email; does not delete yet."""
    if user.deleted_at is not None:
        raise ValueError("This account is already closed")
    if is_last_active_admin(db, user):
        raise ValueError("Cannot close the last active admin account")

    raw_token = token_service.create_account_delete_token(db, user)
    send_close_account_email(to=user.email, token=raw_token)
    return {
        "message": CLOSE_ACCOUNT_MESSAGE,
        "privacy_email": PRIVACY_EMAIL or "privacy@labcd.app",
    }


def confirm_close_account(db: Session, *, raw_token: str) -> User:
    """Consume token and soft-delete the account."""
    row = token_service.consume_auth_token(
        db,
        raw_token=raw_token,
        purpose=token_service.PURPOSE_ACCOUNT_DELETE,
    )
    if row is None:
        raise ValueError("Invalid or expired confirmation link")

    user = db.get(User, row.user_id)
    if user is None:
        raise ValueError("Invalid or expired confirmation link")
    if user.deleted_at is not None:
        return user
    if is_last_active_admin(db, user):
        raise ValueError("Cannot close the last active admin account")

    _soft_delete_user(db, user)
    return user


def _soft_delete_user(db: Session, user: User) -> None:
    now = datetime.now(timezone.utc)
    user.deleted_at = now
    user.is_active = False
    db.add(user)
    db.commit()
    db.refresh(user)

    session_service.revoke_all_user_sessions(db, user.id)
    _best_effort_cancel_stripe(db, user)


def _best_effort_cancel_stripe(db: Session, user: User) -> None:
    if not user.stripe_subscription_id:
        return
    try:
        from backend_api.http.services.stripe_service import (
            StripeBillingError,
            admin_cancel_subscription,
        )

        admin_cancel_subscription(db, user, at_period_end=False)
    except StripeBillingError:
        logger.warning(
            "Stripe cancel skipped for closed user %s (billing error)",
            user.id,
        )
    except Exception:
        logger.exception(
            "Stripe cancel failed for closed user %s",
            user.id,
        )


def restore_user(db: Session, user: User) -> User:
    """Clear soft-delete and reactivate (admin trash restore)."""
    if user.deleted_at is None:
        raise ValueError("User is not in the deleted trash")
    user.deleted_at = None
    user.is_active = True
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
