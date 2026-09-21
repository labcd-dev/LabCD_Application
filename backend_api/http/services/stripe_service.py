"""Stripe billing integration.

Covers three things:
  * Creating Checkout Sessions (subscription mode) for the Plus / Pro /
    Business plans, monthly or yearly.
  * Creating Customer Portal sessions so users can update payment methods,
    change plans, or cancel from Stripe's hosted UI.
  * Handling the webhook events that keep our ``User``/``Plan`` rows in sync
    with Stripe: ``checkout.session.completed``,
    ``customer.subscription.updated``, ``customer.subscription.deleted`` and
    ``invoice.payment_failed``.

Enterprise is deliberately excluded from all of the above — it stays a
"Contact us" flow (see ``Plan.is_contact_sales``) and is provisioned by an
admin from the existing admin panel, not through Stripe Checkout.

Secrets (``STRIPE_SECRET_KEY`` / ``STRIPE_WEBHOOK_SECRET`` /
``STRIPE_PUBLISHABLE_KEY``) are never read from ``backend_api.http.config`` at
import time. They're read live via ``api_key_service.current_env_value`` so
that a key saved from Admin -> API keys takes effect immediately, exactly
like the existing OpenAI/Groq/etc. provider keys.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import stripe
from sqlalchemy.orm import Session

from backend_api.db.models import Plan, User
from backend_api.http.config import APP_PUBLIC_URL
from backend_api.http.services import api_key_service, audit_service, email_service, plan_service

logger = logging.getLogger(__name__)

BILLING_INTERVALS = {"month", "year"}

# Subscription statuses that mean "the user should have plan access".
ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "past_due"}


class StripeConfigError(RuntimeError):
    """Stripe secret key / webhook secret is missing or invalid."""


class StripeBillingError(ValueError):
    """User-facing billing error (bad plan, unconfigured price, etc.)."""


# --------------------------------------------------------------------------
# Client / configuration helpers
# --------------------------------------------------------------------------

def _secret_key() -> str:
    return api_key_service.current_env_value("STRIPE_SECRET_KEY")


def _webhook_secret() -> str:
    return api_key_service.current_env_value("STRIPE_WEBHOOK_SECRET")


def is_configured() -> bool:
    """True once an admin has saved a Stripe secret key."""
    return bool(_secret_key())


def _client():
    """Return a Stripe SDK client bound to the current secret key.

    A fresh ``stripe.StripeClient`` is built per call (rather than mutating
    the global ``stripe.api_key``) so concurrent requests can never race on a
    shared mutable module attribute.
    """
    key = _secret_key()
    if not key:
        raise StripeConfigError(
            "Stripe is not configured. An admin must set STRIPE_SECRET_KEY "
            "from Admin -> API keys."
        )
    return stripe.StripeClient(api_key=key).v1


def _to_plain_dict(obj: Any) -> dict[str, Any]:
    """Normalize a Stripe SDK response into a plain, deeply-nested dict.

    Real Stripe API responses (Customer, Subscription, Invoice, Event, the
    Session inside a checkout event, ...) come back as typed ``StripeObject``
    instances. ``StripeObject`` deliberately blocks dict methods like
    ``.get()``/``.keys()``/``.items()`` -- they'd collide with real API field
    names (e.g. a Subscription's ``items`` field) -- and raises
    ``AttributeError`` if you call them; see stripe/_stripe_object.py's
    ``_DICT_METHOD_NAMES`` guard and https://github.com/stripe/stripe-python#working-with-api-resources.

    Everything below this point in the module is written against plain
    dicts (and is unit-tested against plain dicts), so every Stripe SDK
    response is normalized here, once, right where it's received, via the
    SDK's own recursive ``.to_dict()``.
    """
    if obj is None:
        return {}
    to_dict = getattr(obj, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    return dict(obj)


# --------------------------------------------------------------------------
# Plan <-> Stripe price mapping
# --------------------------------------------------------------------------

def get_price_id(plan: Plan, interval: str) -> str | None:
    if interval == "year":
        return plan.stripe_price_id_yearly
    if interval == "month":
        return plan.stripe_price_id_monthly
    return None


def find_plan_by_price_id(db: Session, price_id: str) -> tuple[Plan | None, str | None]:
    """Return ``(plan, interval)`` for a Stripe Price id, or ``(None, None)``."""
    if not price_id:
        return None, None
    plan = db.query(Plan).filter(Plan.stripe_price_id_monthly == price_id).first()
    if plan is not None:
        return plan, "month"
    plan = db.query(Plan).filter(Plan.stripe_price_id_yearly == price_id).first()
    if plan is not None:
        return plan, "year"
    return None, None


# --------------------------------------------------------------------------
# Customer / Checkout / Portal
# --------------------------------------------------------------------------

def ensure_customer(db: Session, user: User) -> str:
    """Return this user's Stripe Customer id, creating (or repairing) it as needed."""
    client = _client()

    if user.stripe_customer_id:
        try:
            existing = _to_plain_dict(client.customers.retrieve(user.stripe_customer_id))
            if not existing.get("deleted"):
                return user.stripe_customer_id
        except stripe.StripeError:
            logger.warning(
                "Stripe customer %s missing for user %s; creating a new one",
                user.stripe_customer_id,
                user.id,
            )

    customer = _to_plain_dict(
        client.customers.create(
            {
                "email": user.email,
                "name": (user.display_name or user.email),
                "metadata": {"user_id": str(user.id)},
            }
        )
    )
    user.stripe_customer_id = customer["id"]
    db.add(user)
    db.commit()
    db.refresh(user)
    return user.stripe_customer_id


def create_checkout_session(
    db: Session,
    *,
    user: User,
    plan: Plan,
    interval: str,
    success_url: str,
    cancel_url: str,
) -> str:
    """Create a subscription-mode Checkout Session and return its hosted URL."""
    if interval not in BILLING_INTERVALS:
        raise StripeBillingError("Billing interval must be 'month' or 'year'.")
    if plan.is_contact_sales:
        raise StripeBillingError(
            f"{plan.name} is a Contact Us plan and cannot be purchased through Checkout."
        )
    if not plan.is_active:
        raise StripeBillingError(f"{plan.name} is not currently available.")

    price_id = get_price_id(plan, interval)
    if not price_id:
        raise StripeBillingError(
            f"{plan.name} has no Stripe {('yearly' if interval == 'year' else 'monthly')} "
            "price configured yet."
        )

    client = _client()
    customer_id = ensure_customer(db, user)

    session = client.checkout.sessions.create(
        {
            "mode": "subscription",
            "customer": customer_id,
            "client_reference_id": str(user.id),
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "allow_promotion_codes": True,
            "subscription_data": {
                "metadata": {
                    "user_id": str(user.id),
                    "plan_id": str(plan.id),
                    "plan_code": plan.plan_code or "",
                    "interval": interval,
                }
            },
            "metadata": {
                "user_id": str(user.id),
                "plan_id": str(plan.id),
                "plan_code": plan.plan_code or "",
                "interval": interval,
            },
        }
    )
    return session.url


def create_portal_session(db: Session, *, user: User, return_url: str) -> str:
    """Create a Customer Portal session (manage payment method / cancel / invoices)."""
    if not user.stripe_customer_id:
        raise StripeBillingError(
            "This account doesn't have a Stripe customer yet. Subscribe to a plan first."
        )
    client = _client()
    session = client.billing_portal.sessions.create(
        {"customer": user.stripe_customer_id, "return_url": return_url}
    )
    return session.url


# --------------------------------------------------------------------------
# Reading fields off Stripe objects (defensive against API-version drift)
# --------------------------------------------------------------------------

def _ts_to_dt(value: int | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _subscription_price_id(subscription: dict[str, Any]) -> str | None:
    items = ((subscription.get("items") or {}).get("data")) or []
    if not items:
        return None
    price = items[0].get("price") or {}
    return price.get("id")


def _subscription_period_end(subscription: dict[str, Any]) -> int | None:
    # Newer Stripe API versions moved current_period_end onto each
    # subscription item; older ones kept it on the subscription itself.
    items = ((subscription.get("items") or {}).get("data")) or []
    if items and items[0].get("current_period_end"):
        return items[0]["current_period_end"]
    return subscription.get("current_period_end")


def _invoice_subscription_id(invoice: dict[str, Any]) -> str | None:
    parent = invoice.get("parent") or {}
    subscription_details = parent.get("subscription_details") or {}
    nested = subscription_details.get("subscription")
    if nested:
        return nested if isinstance(nested, str) else nested.get("id")
    legacy = invoice.get("subscription")
    if legacy:
        return legacy if isinstance(legacy, str) else legacy.get("id")
    return None


# --------------------------------------------------------------------------
# Applying Stripe state to our User/Plan rows
# --------------------------------------------------------------------------

def _apply_subscription_to_user(db: Session, user: User, subscription: dict[str, Any]) -> None:
    price_id = _subscription_price_id(subscription)
    plan, interval = (None, None)
    if price_id:
        plan, interval = find_plan_by_price_id(db, price_id)

    customer_id = subscription.get("customer")
    if customer_id:
        user.stripe_customer_id = customer_id if isinstance(customer_id, str) else customer_id.get("id")

    user.stripe_subscription_id = subscription.get("id")
    user.stripe_subscription_status = subscription.get("status")
    user.stripe_price_id = price_id
    user.billing_interval = interval or user.billing_interval
    user.stripe_cancel_at_period_end = bool(subscription.get("cancel_at_period_end"))
    user.stripe_current_period_end = _ts_to_dt(_subscription_period_end(subscription))

    status = subscription.get("status")
    if plan is not None and status in ACTIVE_SUBSCRIPTION_STATUSES:
        user.plan = plan
        user.plan_id = plan.id

    db.add(user)
    db.commit()
    db.refresh(user)


def _find_user(
    db: Session,
    *,
    user_id: str | int | None = None,
    customer_id: str | None = None,
    subscription_id: str | None = None,
) -> User | None:
    if user_id:
        try:
            user = db.query(User).filter(User.id == int(user_id)).first()
        except (TypeError, ValueError):
            user = None
        if user is not None:
            return user
    if subscription_id:
        user = db.query(User).filter(User.stripe_subscription_id == subscription_id).first()
        if user is not None:
            return user
    if customer_id:
        user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if user is not None:
            return user
    return None


# --------------------------------------------------------------------------
# Webhook event handlers
# --------------------------------------------------------------------------

def _handle_checkout_completed(db: Session, session_obj: dict[str, Any]) -> None:
    if session_obj.get("mode") != "subscription":
        return

    metadata = session_obj.get("metadata") or {}
    user_id = session_obj.get("client_reference_id") or metadata.get("user_id")
    customer_id = session_obj.get("customer")
    customer_id = customer_id if isinstance(customer_id, str) else (customer_id or {}).get("id")
    subscription_ref = session_obj.get("subscription")
    subscription_id = subscription_ref if isinstance(subscription_ref, str) else (subscription_ref or {}).get("id")

    user = _find_user(db, user_id=user_id, customer_id=customer_id)
    if user is None:
        logger.error(
            "checkout.session.completed: no matching user (user_id=%s customer=%s)",
            user_id,
            customer_id,
        )
        return

    if customer_id:
        user.stripe_customer_id = customer_id

    if subscription_id:
        client = _client()
        subscription = _to_plain_dict(client.subscriptions.retrieve(subscription_id))
        _apply_subscription_to_user(db, user, subscription)
    else:
        db.add(user)
        db.commit()

    audit_service.record(
        db,
        action="billing.checkout.completed",
        category="billing",
        actor_user_id=user.id,
        actor_email=user.email,
        resource_type="stripe_subscription",
        resource_id=subscription_id,
        success=True,
        details={"customer_id": customer_id, "plan_id": user.plan_id},
    )


def _handle_subscription_updated(db: Session, subscription: dict[str, Any]) -> None:
    customer_id = subscription.get("customer")
    customer_id = customer_id if isinstance(customer_id, str) else (customer_id or {}).get("id")
    user = _find_user(db, customer_id=customer_id, subscription_id=subscription.get("id"))
    if user is None:
        logger.warning(
            "customer.subscription.updated: no matching user for subscription %s",
            subscription.get("id"),
        )
        return

    previous_status = user.stripe_subscription_status
    _apply_subscription_to_user(db, user, subscription)

    audit_service.record(
        db,
        action="billing.subscription.updated",
        category="billing",
        actor_user_id=user.id,
        actor_email=user.email,
        resource_type="stripe_subscription",
        resource_id=subscription.get("id"),
        success=True,
        details={
            "previous_status": previous_status,
            "status": subscription.get("status"),
            "cancel_at_period_end": subscription.get("cancel_at_period_end"),
            "plan_id": user.plan_id,
        },
    )


def _handle_subscription_deleted(db: Session, subscription: dict[str, Any]) -> None:
    customer_id = subscription.get("customer")
    customer_id = customer_id if isinstance(customer_id, str) else (customer_id or {}).get("id")
    user = _find_user(db, customer_id=customer_id, subscription_id=subscription.get("id"))
    if user is None:
        logger.warning(
            "customer.subscription.deleted: no matching user for subscription %s",
            subscription.get("id"),
        )
        return

    user.stripe_subscription_status = "canceled"
    user.stripe_cancel_at_period_end = False
    user.stripe_current_period_end = _ts_to_dt(_subscription_period_end(subscription))

    default_plan = plan_service.get_default_plan(db)
    reverted_to_plan_id = None
    if default_plan is not None:
        user.plan = default_plan
        user.plan_id = default_plan.id
        reverted_to_plan_id = default_plan.id

    db.add(user)
    db.commit()
    db.refresh(user)

    audit_service.record(
        db,
        action="billing.subscription.deleted",
        category="billing",
        actor_user_id=user.id,
        actor_email=user.email,
        resource_type="stripe_subscription",
        resource_id=subscription.get("id"),
        success=True,
        details={"reverted_to_plan_id": reverted_to_plan_id},
    )


def _handle_invoice_payment_failed(db: Session, invoice: dict[str, Any]) -> None:
    customer_id = invoice.get("customer")
    customer_id = customer_id if isinstance(customer_id, str) else (customer_id or {}).get("id")
    subscription_id = _invoice_subscription_id(invoice)

    user = _find_user(db, customer_id=customer_id, subscription_id=subscription_id)
    if user is None:
        logger.warning(
            "invoice.payment_failed: no matching user (customer=%s subscription=%s)",
            customer_id,
            subscription_id,
        )
        return

    user.stripe_subscription_status = "past_due"
    db.add(user)
    db.commit()

    audit_service.record(
        db,
        action="billing.invoice.payment_failed",
        category="billing",
        actor_user_id=user.id,
        actor_email=user.email,
        resource_type="stripe_invoice",
        resource_id=invoice.get("id"),
        success=False,
        details={
            "amount_due": invoice.get("amount_due"),
            "attempt_count": invoice.get("attempt_count"),
        },
    )

    try:
        email_service.send_email(
            to=user.email,
            subject="Action needed: your LabCD payment failed",
            body=(
                "We were unable to charge your card for your LabCD subscription.\n\n"
                "Please update your payment method to avoid losing access:\n"
                f"{APP_PUBLIC_URL}/profile\n\n"
                "You can update your payment method from your Profile page, "
                "under Billing.\n"
            ),
        )
    except Exception:  # pragma: no cover - best-effort notification
        logger.exception("Failed to queue payment-failed email for user %s", user.id)


_EVENT_HANDLERS = {
    "checkout.session.completed": _handle_checkout_completed,
    "customer.subscription.updated": _handle_subscription_updated,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.payment_failed": _handle_invoice_payment_failed,
}


def construct_event(payload: bytes, sig_header: str | None) -> stripe.Event:
    """Verify a webhook payload's signature and return the parsed Event."""
    secret = _webhook_secret()
    if not secret:
        raise StripeConfigError(
            "Stripe webhook secret is not configured. An admin must set "
            "STRIPE_WEBHOOK_SECRET from Admin -> API keys."
        )
    if not sig_header:
        raise StripeBillingError("Missing Stripe-Signature header.")
    return stripe.Webhook.construct_event(payload, sig_header, secret)


def dispatch_event(db: Session, event: stripe.Event) -> str:
    """Route a verified Stripe event to its handler. Returns a short status string."""
    event_dict = _to_plain_dict(event)
    event_type = event_dict.get("type")
    handler = _EVENT_HANDLERS.get(event_type)
    if handler is None:
        return "ignored"
    data_object = ((event_dict.get("data") or {}).get("object")) or {}
    handler(db, data_object)
    return "handled"


# --------------------------------------------------------------------------
# Admin actions (used by the admin panel's user-detail billing controls)
# --------------------------------------------------------------------------

def admin_cancel_subscription(db: Session, user: User, *, at_period_end: bool = True) -> User:
    if not user.stripe_subscription_id:
        raise StripeBillingError("This user has no active Stripe subscription.")
    client = _client()
    if at_period_end:
        subscription = _to_plain_dict(
            client.subscriptions.update(
                user.stripe_subscription_id, {"cancel_at_period_end": True}
            )
        )
    else:
        subscription = _to_plain_dict(client.subscriptions.cancel(user.stripe_subscription_id))
    _apply_subscription_to_user(db, user, subscription)

    audit_service.record(
        db,
        action="billing.admin.cancel_subscription",
        category="billing",
        resource_type="stripe_subscription",
        resource_id=user.stripe_subscription_id,
        success=True,
        details={"user_id": user.id, "at_period_end": at_period_end},
    )
    return user


def admin_resume_subscription(db: Session, user: User) -> User:
    """Undo a pending cancel_at_period_end (subscription is still active)."""
    if not user.stripe_subscription_id:
        raise StripeBillingError("This user has no active Stripe subscription.")
    client = _client()
    subscription = _to_plain_dict(
        client.subscriptions.update(user.stripe_subscription_id, {"cancel_at_period_end": False})
    )
    _apply_subscription_to_user(db, user, subscription)

    audit_service.record(
        db,
        action="billing.admin.resume_subscription",
        category="billing",
        resource_type="stripe_subscription",
        resource_id=user.stripe_subscription_id,
        success=True,
        details={"user_id": user.id},
    )
    return user


def admin_sync_subscription(db: Session, user: User) -> User:
    """Re-fetch this user's subscription from Stripe and re-apply it locally."""
    if not user.stripe_subscription_id:
        raise StripeBillingError("This user has no Stripe subscription to sync.")
    client = _client()
    subscription = _to_plain_dict(client.subscriptions.retrieve(user.stripe_subscription_id))
    _apply_subscription_to_user(db, user, subscription)
    return user
