"""User-facing Stripe billing routes: checkout, customer portal, webhook.

Endpoints that create Checkout/Portal sessions require an authenticated user
(mirrors the rest of the app's JWT auth). The webhook endpoint is
intentionally unauthenticated — Stripe calls it directly — and instead
verifies the request using the Stripe-Signature header against
STRIPE_WEBHOOK_SECRET.
"""

from __future__ import annotations

import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.config import (
    STRIPE_CHECKOUT_CANCEL_URL,
    STRIPE_CHECKOUT_SUCCESS_URL,
    STRIPE_PORTAL_RETURN_URL,
)
from backend_api.http.dependencies import get_current_user
from backend_api.http.schemas.billing import (
    BillingStatusOut,
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    PortalSessionResponse,
    PublicPlanOut,
)
from backend_api.http.services import api_key_service, plan_service, stripe_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

# Fixed display order for the pricing page, independent of DB insertion order.
_PLAN_CODE_ORDER = {"plus": 0, "pro": 1, "business": 2, "enterprise": 3}


@router.get("/plans", response_model=list[PublicPlanOut])
def list_public_plans(db: Session = Depends(get_db)) -> list[PublicPlanOut]:
    """Public: the Plus/Pro/Business/Enterprise tiers shown on the pricing page.

    Only plans with a ``plan_code`` are returned — the app's pre-existing
    internal plans (Free / Single Loop / Multi Loop / Full Access) are left
    out so this page is purely additive and doesn't change what those plans
    look like anywhere else in the app.
    """
    plans = [p for p in plan_service.list_plans(db, active_only=True) if p.plan_code]
    plans.sort(key=lambda p: _PLAN_CODE_ORDER.get(p.plan_code or "", 99))
    return [
        PublicPlanOut(
            id=plan.id,
            plan_code=plan.plan_code,
            name=plan.name,
            description=plan.description,
            price=float(plan.price),
            price_yearly=(float(plan.price_yearly) if plan.price_yearly is not None else None),
            is_contact_sales=plan.is_contact_sales,
            is_most_popular=plan.is_most_popular,
            purchasable=bool(
                not plan.is_contact_sales
                and (plan.stripe_price_id_monthly or plan.stripe_price_id_yearly)
            ),
            actions=plan.action_codes(),
        )
        for plan in plans
    ]


@router.get("/status", response_model=BillingStatusOut)
def billing_status() -> BillingStatusOut:
    """Public: lets the pricing page know whether Checkout is available."""
    publishable_key = api_key_service.current_env_value("STRIPE_PUBLISHABLE_KEY") or None
    return BillingStatusOut(
        stripe_enabled=stripe_service.is_configured(),
        publishable_key=publishable_key,
    )


@router.post("/checkout-session", response_model=CheckoutSessionResponse)
def create_checkout_session(
    request: CheckoutSessionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckoutSessionResponse:
    plan = plan_service.get_plan(db, request.plan_id)
    if plan is None or not plan.is_active:
        raise HTTPException(status_code=404, detail="Plan not found")
    try:
        url = stripe_service.create_checkout_session(
            db,
            user=user,
            plan=plan,
            interval=request.interval,
            success_url=STRIPE_CHECKOUT_SUCCESS_URL,
            cancel_url=STRIPE_CHECKOUT_CANCEL_URL,
        )
    except stripe_service.StripeConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except stripe_service.StripeBillingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except stripe.StripeError as exc:
        logger.exception("Stripe error creating checkout session for user %s", user.id)
        raise HTTPException(status_code=502, detail="Stripe error creating checkout session") from exc
    return CheckoutSessionResponse(url=url)


@router.post("/portal-session", response_model=PortalSessionResponse)
def create_portal_session(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PortalSessionResponse:
    try:
        url = stripe_service.create_portal_session(
            db, user=user, return_url=STRIPE_PORTAL_RETURN_URL
        )
    except stripe_service.StripeConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except stripe_service.StripeBillingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except stripe.StripeError as exc:
        logger.exception("Stripe error creating portal session for user %s", user.id)
        raise HTTPException(status_code=502, detail="Stripe error creating portal session") from exc
    return PortalSessionResponse(url=url)


@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    try:
        event = stripe_service.construct_event(payload, sig_header)
    except stripe_service.StripeConfigError as exc:
        # Misconfiguration, not a bad request — but Stripe will retry either
        # way, and we don't want to leak config details in the response.
        logger.error("Stripe webhook received but not configured: %s", exc)
        raise HTTPException(status_code=503, detail="Stripe webhook not configured") from exc
    except (stripe.SignatureVerificationError, stripe_service.StripeBillingError) as exc:
        logger.warning("Rejected Stripe webhook: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid Stripe signature") from exc

    try:
        result = stripe_service.dispatch_event(db, event)
    except Exception:
        # Let Stripe retry: return 500 rather than swallowing the failure.
        logger.exception("Error handling Stripe webhook event %s", event.get("type"))
        raise HTTPException(status_code=500, detail="Webhook handler error")

    return {"status": result}
