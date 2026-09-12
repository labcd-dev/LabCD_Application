"""Unit tests for credit balances, bonuses, daily reset, and usage metering."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend_api.db.base import Base
from backend_api.db.models import User
from backend_api.http.services import credit_service


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    credit_service.seed_credit_settings(session)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _user(db, email: str = "user@example.com", **kwargs) -> User:
    user = User(
        email=email,
        password_hash="x",
        is_admin=False,
        is_active=True,
        email_verified=True,
        referral_code=kwargs.pop("referral_code", credit_service.generate_referral_code(db)),
        **kwargs,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_new_user_bonus_idempotent(db):
    user = _user(db)
    assert credit_service.grant_new_user_bonus(db, user) is True
    account = credit_service.get_or_create_account(db, user.id)
    assert account.bonus_balance == Decimal("100.00")
    assert credit_service.grant_new_user_bonus(db, user) is False
    db.refresh(account)
    assert account.bonus_balance == Decimal("100.00")


def test_referral_bonuses_both_sides_once(db):
    inviter = _user(db, email="inviter@example.com", referral_code="INVITE01")
    invitee = _user(
        db,
        email="invitee@example.com",
        referred_by_user_id=inviter.id,
    )
    credit_service.on_user_verified(db, invitee)
    inviter_acct = credit_service.get_or_create_account(db, inviter.id)
    invitee_acct = credit_service.get_or_create_account(db, invitee.id)
    # invitee: new-user 100 + invitee 50; inviter: referral 100 (+ daily reset may also apply)
    assert invitee_acct.bonus_balance == Decimal("150.00")
    assert inviter_acct.bonus_balance == Decimal("100.00")
    assert credit_service.apply_referral_bonuses(db, invitee) is False


def test_daily_reset_non_rollover_bonus_untouched(db):
    user = _user(db)
    credit_service.grant_new_user_bonus(db, user)
    account = credit_service.get_or_create_account(db, user.id)
    credit_service.ensure_daily_reset(db, account, commit=True)
    account.daily_balance = Decimal("5.00")
    account.daily_date = date.today() - timedelta(days=1)
    db.add(account)
    db.commit()

    credit_service.ensure_daily_reset(db, account, commit=True)
    db.refresh(account)
    assert account.daily_balance == Decimal("20.00")
    assert account.bonus_balance == Decimal("100.00")
    assert account.daily_date == date.today()


def test_debit_daily_then_bonus(db):
    user = _user(db)
    account = credit_service.get_or_create_account(db, user.id)
    credit_service.ensure_daily_reset(db, account, commit=True)
    account.bonus_balance = Decimal("10.00")
    account.daily_balance = Decimal("5.00")
    db.add(account)
    db.commit()

    credit_service.debit_credits(db, account, Decimal("8.00"), note="test")
    db.refresh(account)
    assert account.daily_balance == Decimal("0.00")
    assert account.bonus_balance == Decimal("7.00")


def test_hard_gate_blocks_zero_balance(db):
    user = _user(db)
    account = credit_service.get_or_create_account(db, user.id)
    account.daily_balance = Decimal("0.00")
    account.bonus_balance = Decimal("0.00")
    account.daily_date = date.today()
    db.add(account)
    db.commit()
    # Prevent ensure_daily_reset from refilling: set allotment to 0 for this test.
    credit_service.update_settings(db, daily_allotment=Decimal("0"), hard_gate_enabled=True)
    with pytest.raises(credit_service.InsufficientCreditsError):
        credit_service.assert_can_start_job(db, user.id)


def test_compute_credits_formula_ceil(db):
    settings = credit_service.get_settings(db)
    # 1500 tokens => 1.5 * 1 = 1.5; 90s => 1.5 min * 1 = 1.5; total 3.0 -> ceil 3
    amount = credit_service.compute_credits(
        prompt_tokens=1000,
        completion_tokens=500,
        duration_seconds=90,
        settings=settings,
    )
    assert amount == Decimal("3.00")


def test_live_estimate_then_finalize(db):
    user = _user(db)
    credit_service.update_settings(db, daily_allotment=Decimal("50"), hard_gate_enabled=True)
    session = credit_service.open_usage_session(db, user.id, module="silo", job_id="job-1")
    assert session.status == "open"

    live = credit_service.update_live_usage(
        db,
        session.id,
        prompt_tokens=1000,
        completion_tokens=0,
    )
    assert live is not None
    assert live.live_credits_estimate >= Decimal("1.00")

    final = credit_service.finalize_usage_session(
        db,
        session.id,
        prompt_tokens=2000,
        completion_tokens=0,
    )
    assert final is not None
    assert final.status == "finalized"
    assert final.credits_charged >= Decimal("1.00")
    account = credit_service.get_or_create_account(db, user.id)
    assert credit_service.spendable(account) < Decimal("50.00")


def test_credits_routes_registered():
    from backend_api.http.main import app

    routes = [route.path for route in app.routes]
    assert "/api/v1/credits/me" in routes
    assert "/api/v1/credits/me/ledger" in routes
    assert "/api/v1/credits/me/sessions" in routes
    assert "/api/v1/admin/credits/settings" in routes
