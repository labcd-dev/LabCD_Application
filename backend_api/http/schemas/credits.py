"""Pydantic schemas for credit balances, ledger, and usage sessions."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class CreditRatesOut(BaseModel):
    per_1k_tokens: Decimal
    per_minute: Decimal
    min_job_charge: Decimal


class CreditDashboardOut(BaseModel):
    bonus_balance: Decimal
    daily_balance: Decimal
    spendable: Decimal
    daily_allotment: Decimal
    daily_date: str | None = None
    today_spent: Decimal
    referral_code: str | None = None
    referral_link: str | None = None
    hard_gate_enabled: bool
    rates: CreditRatesOut


class CreditLedgerEntryOut(BaseModel):
    id: int
    amount: Decimal
    balance_after: Decimal
    entry_type: str
    usage_session_id: int | None = None
    note: str = ""
    created_at: datetime


class CreditUsageSessionOut(BaseModel):
    id: int
    module: str
    job_id: str | None = None
    status: str
    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: int
    prompt_tokens: int
    completion_tokens: int
    credits_charged: Decimal
    live_credits_estimate: Decimal


class CreditSettingsOut(BaseModel):
    new_user_bonus: Decimal
    referral_inviter_bonus: Decimal
    referral_invitee_bonus: Decimal
    daily_allotment: Decimal
    per_1k_tokens: Decimal
    per_minute: Decimal
    min_job_charge: Decimal
    hard_gate_enabled: bool


class CreditSettingsUpdate(BaseModel):
    new_user_bonus: Decimal | None = Field(default=None, ge=0)
    referral_inviter_bonus: Decimal | None = Field(default=None, ge=0)
    referral_invitee_bonus: Decimal | None = Field(default=None, ge=0)
    daily_allotment: Decimal | None = Field(default=None, ge=0)
    per_1k_tokens: Decimal | None = Field(default=None, ge=0)
    per_minute: Decimal | None = Field(default=None, ge=0)
    min_job_charge: Decimal | None = Field(default=None, ge=0)
    hard_gate_enabled: bool | None = None


class CreditAdjustRequest(BaseModel):
    amount: Decimal
    note: str = Field(default="", max_length=500)


class AdminUserCreditsOut(BaseModel):
    user_id: int
    bonus_balance: Decimal
    daily_balance: Decimal
    spendable: Decimal
    daily_date: str | None = None
    referral_code: str | None = None
    referred_by_user_id: int | None = None
    new_user_bonus_granted_at: datetime | None = None
    ledger: list[CreditLedgerEntryOut]
    sessions: list[CreditUsageSessionOut]
