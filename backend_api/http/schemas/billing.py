"""Request/response schemas for Stripe billing endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CheckoutSessionRequest(BaseModel):
    plan_id: int
    interval: str = Field(description="'month' or 'year'")


class CheckoutSessionResponse(BaseModel):
    url: str


class PortalSessionResponse(BaseModel):
    url: str


class BillingStatusOut(BaseModel):
    """Lightweight public status used by the pricing page (no secrets)."""

    stripe_enabled: bool
    publishable_key: str | None = None


class PublicPlanOut(BaseModel):
    """Plan fields safe to show on the public/pricing page (no Stripe IDs)."""

    id: int
    plan_code: str | None
    name: str
    description: str
    price: float
    price_yearly: float | None
    is_contact_sales: bool
    is_most_popular: bool
    purchasable: bool
    actions: list[str]

