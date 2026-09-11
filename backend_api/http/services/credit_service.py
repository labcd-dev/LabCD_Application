"""User credit balances, bonuses, daily reset, and per-job usage metering."""

from __future__ import annotations

import math
import secrets
import string
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from backend_api.db.models import (
    CreditLedgerEntry,
    CreditUsageSession,
    User,
    UserCreditAccount,
)
from backend_api.http.config import APP_PUBLIC_URL
from backend_api.http.services import plan_service

# AppSetting keys (admin-editable).
SETTING_NEW_USER_BONUS = "credits.new_user_bonus"
SETTING_REFERRAL_INVITER = "credits.referral_inviter_bonus"
SETTING_REFERRAL_INVITEE = "credits.referral_invitee_bonus"
SETTING_DAILY_ALLOTMENT = "credits.daily_allotment"
SETTING_PER_1K_TOKENS = "credits.per_1k_tokens"
SETTING_PER_MINUTE = "credits.per_minute"
SETTING_MIN_JOB_CHARGE = "credits.min_job_charge"
SETTING_HARD_GATE = "credits.hard_gate_enabled"

DEFAULT_NEW_USER_BONUS = Decimal("100")
DEFAULT_REFERRAL_INVITER = Decimal("100")
DEFAULT_REFERRAL_INVITEE = Decimal("50")
DEFAULT_DAILY_ALLOTMENT = Decimal("20")
DEFAULT_PER_1K_TOKENS = Decimal("1")
DEFAULT_PER_MINUTE = Decimal("1")
DEFAULT_MIN_JOB_CHARGE = Decimal("1")
DEFAULT_HARD_GATE = True

ENTRY_NEW_USER = "new_user_bonus"
ENTRY_REFERRAL_INVITER = "referral_inviter"
ENTRY_REFERRAL_INVITEE = "referral_invitee"
ENTRY_DAILY_RESET = "daily_reset"
ENTRY_USAGE_DEBIT = "usage_debit"
ENTRY_ADMIN_ADJUST = "admin_adjust"

SESSION_OPEN = "open"
SESSION_FINALIZED = "finalized"
SESSION_CANCELLED = "cancelled"

ZERO = Decimal("0.00")


class InsufficientCreditsError(Exception):
    """Raised when hard gate blocks a new job."""

    def __init__(self, message: str = "Insufficient credits to start a new job.") -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class CreditSettings:
    new_user_bonus: Decimal
    referral_inviter_bonus: Decimal
    referral_invitee_bonus: Decimal
    daily_allotment: Decimal
    per_1k_tokens: Decimal
    per_minute: Decimal
    min_job_charge: Decimal
    hard_gate_enabled: bool


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _today_utc() -> date:
    return _utcnow().date()


def _as_decimal(value: Any, default: Decimal) -> Decimal:
    if value is None or value == "":
        return default
    try:
        return Decimal(str(value))
    except Exception:
        return default


def _truthy(raw: str | None, *, default: bool) -> bool:
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def get_settings(db: Session) -> CreditSettings:
    return CreditSettings(
        new_user_bonus=_as_decimal(
            plan_service.get_setting(db, SETTING_NEW_USER_BONUS), DEFAULT_NEW_USER_BONUS
        ),
        referral_inviter_bonus=_as_decimal(
            plan_service.get_setting(db, SETTING_REFERRAL_INVITER), DEFAULT_REFERRAL_INVITER
        ),
        referral_invitee_bonus=_as_decimal(
            plan_service.get_setting(db, SETTING_REFERRAL_INVITEE), DEFAULT_REFERRAL_INVITEE
        ),
        daily_allotment=_as_decimal(
            plan_service.get_setting(db, SETTING_DAILY_ALLOTMENT), DEFAULT_DAILY_ALLOTMENT
        ),
        per_1k_tokens=_as_decimal(
            plan_service.get_setting(db, SETTING_PER_1K_TOKENS), DEFAULT_PER_1K_TOKENS
        ),
        per_minute=_as_decimal(
            plan_service.get_setting(db, SETTING_PER_MINUTE), DEFAULT_PER_MINUTE
        ),
        min_job_charge=_as_decimal(
            plan_service.get_setting(db, SETTING_MIN_JOB_CHARGE), DEFAULT_MIN_JOB_CHARGE
        ),
        hard_gate_enabled=_truthy(
            plan_service.get_setting(db, SETTING_HARD_GATE), default=DEFAULT_HARD_GATE
        ),
    )


def seed_credit_settings(db: Session) -> None:
    """Ensure default credit settings exist (idempotent)."""
    defaults = {
        SETTING_NEW_USER_BONUS: str(DEFAULT_NEW_USER_BONUS),
        SETTING_REFERRAL_INVITER: str(DEFAULT_REFERRAL_INVITER),
        SETTING_REFERRAL_INVITEE: str(DEFAULT_REFERRAL_INVITEE),
        SETTING_DAILY_ALLOTMENT: str(DEFAULT_DAILY_ALLOTMENT),
        SETTING_PER_1K_TOKENS: str(DEFAULT_PER_1K_TOKENS),
        SETTING_PER_MINUTE: str(DEFAULT_PER_MINUTE),
        SETTING_MIN_JOB_CHARGE: str(DEFAULT_MIN_JOB_CHARGE),
        SETTING_HARD_GATE: "true" if DEFAULT_HARD_GATE else "false",
    }
    for key, value in defaults.items():
        if plan_service.get_setting(db, key) is None:
            plan_service.set_setting(db, key, value)


def update_settings(
    db: Session,
    *,
    new_user_bonus: Decimal | None = None,
    referral_inviter_bonus: Decimal | None = None,
    referral_invitee_bonus: Decimal | None = None,
    daily_allotment: Decimal | None = None,
    per_1k_tokens: Decimal | None = None,
    per_minute: Decimal | None = None,
    min_job_charge: Decimal | None = None,
    hard_gate_enabled: bool | None = None,
) -> CreditSettings:
    mapping: list[tuple[str, Decimal | bool | None]] = [
        (SETTING_NEW_USER_BONUS, new_user_bonus),
        (SETTING_REFERRAL_INVITER, referral_inviter_bonus),
        (SETTING_REFERRAL_INVITEE, referral_invitee_bonus),
        (SETTING_DAILY_ALLOTMENT, daily_allotment),
        (SETTING_PER_1K_TOKENS, per_1k_tokens),
        (SETTING_PER_MINUTE, per_minute),
        (SETTING_MIN_JOB_CHARGE, min_job_charge),
    ]
    for key, value in mapping:
        if value is None:
            continue
        amount = _money(Decimal(value))
        if amount < ZERO:
            raise ValueError(f"{key} must be >= 0")
        plan_service.set_setting(db, key, str(amount))
    if hard_gate_enabled is not None:
        plan_service.set_setting(db, SETTING_HARD_GATE, "true" if hard_gate_enabled else "false")
    return get_settings(db)


def generate_referral_code(db: Session) -> str:
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(32):
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        exists = db.query(User.id).filter(User.referral_code == code).first()
        if exists is None:
            return code
    return secrets.token_hex(8).upper()


def resolve_referrer(db: Session, referral_code: str | None) -> User | None:
    if not referral_code:
        return None
    code = referral_code.strip().upper()
    if not code:
        return None
    return db.query(User).filter(User.referral_code == code).first()


def spendable(account: UserCreditAccount) -> Decimal:
    return _money(account.bonus_balance + account.daily_balance)


def get_or_create_account(db: Session, user_id: int) -> UserCreditAccount:
    account = db.query(UserCreditAccount).filter(UserCreditAccount.user_id == user_id).first()
    if account is not None:
        return account
    account = UserCreditAccount(
        user_id=user_id,
        bonus_balance=ZERO,
        daily_balance=ZERO,
        daily_date=None,
    )
    db.add(account)
    db.flush()
    return account


def ensure_daily_reset(db: Session, account: UserCreditAccount, *, commit: bool = False) -> bool:
    """Reset daily_balance to allotment when UTC day changes. Bonus untouched."""
    today = _today_utc()
    if account.daily_date == today:
        return False

    settings = get_settings(db)
    allotment = _money(settings.daily_allotment)
    account.daily_balance = allotment
    account.daily_date = today
    account.updated_at = _utcnow()
    db.add(account)

    entry = CreditLedgerEntry(
        user_id=account.user_id,
        amount=allotment,
        balance_after=spendable(account),
        entry_type=ENTRY_DAILY_RESET,
        note=f"Daily allotment for {today.isoformat()} UTC",
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(account)
    else:
        db.flush()
    return True


def _credit_bonus(
    db: Session,
    account: UserCreditAccount,
    amount: Decimal,
    *,
    entry_type: str,
    note: str = "",
    usage_session_id: int | None = None,
) -> CreditLedgerEntry:
    amount = _money(amount)
    account.bonus_balance = _money(account.bonus_balance + amount)
    account.updated_at = _utcnow()
    db.add(account)
    entry = CreditLedgerEntry(
        user_id=account.user_id,
        amount=amount,
        balance_after=spendable(account),
        entry_type=entry_type,
        usage_session_id=usage_session_id,
        note=note,
    )
    db.add(entry)
    db.flush()
    return entry


def debit_credits(
    db: Session,
    account: UserCreditAccount,
    amount: Decimal,
    *,
    entry_type: str = ENTRY_USAGE_DEBIT,
    note: str = "",
    usage_session_id: int | None = None,
) -> CreditLedgerEntry:
    """Debit daily balance first, then bonus. Caps at available spendable."""
    ensure_daily_reset(db, account)
    amount = _money(amount)
    if amount <= ZERO:
        raise ValueError("Debit amount must be positive")

    available = spendable(account)
    to_charge = min(amount, available)

    daily_take = min(account.daily_balance, to_charge)
    account.daily_balance = _money(account.daily_balance - daily_take)
    bonus_take = _money(to_charge - daily_take)
    if bonus_take > ZERO:
        account.bonus_balance = _money(account.bonus_balance - bonus_take)
    account.updated_at = _utcnow()
    db.add(account)

    entry = CreditLedgerEntry(
        user_id=account.user_id,
        amount=_money(-to_charge),
        balance_after=spendable(account),
        entry_type=entry_type,
        usage_session_id=usage_session_id,
        note=note,
    )
    db.add(entry)
    db.flush()
    return entry


def compute_credits(
    *,
    prompt_tokens: int,
    completion_tokens: int,
    duration_seconds: int,
    settings: CreditSettings | None = None,
    db: Session | None = None,
) -> Decimal:
    if settings is None:
        if db is None:
            raise ValueError("settings or db required")
        settings = get_settings(db)
    tokens = max(0, int(prompt_tokens) + int(completion_tokens))
    duration_min = max(0.0, float(duration_seconds) / 60.0)
    raw = (Decimal(tokens) / Decimal(1000)) * settings.per_1k_tokens + (
        Decimal(str(duration_min)) * settings.per_minute
    )
    # Ceil to whole credits (plan formula uses ceil).
    ceiled = Decimal(str(math.ceil(float(raw)))) if raw > ZERO else ZERO
    return max(_money(settings.min_job_charge), _money(ceiled))


def assert_can_start_job(db: Session, user_id: int) -> UserCreditAccount:
    account = get_or_create_account(db, user_id)
    ensure_daily_reset(db, account)
    settings = get_settings(db)
    if settings.hard_gate_enabled and spendable(account) <= ZERO:
        raise InsufficientCreditsError()
    return account


def open_usage_session(
    db: Session,
    user_id: int,
    *,
    module: str,
    job_id: str | None = None,
    check_balance: bool = True,
) -> CreditUsageSession:
    if check_balance:
        assert_can_start_job(db, user_id)
    else:
        account = get_or_create_account(db, user_id)
        ensure_daily_reset(db, account)
    session = CreditUsageSession(
        user_id=user_id,
        module=module.strip()[:40],
        job_id=(job_id or None),
        status=SESSION_OPEN,
        started_at=_utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _duration_seconds(session: CreditUsageSession, *, ended_at: datetime | None = None) -> int:
    end = ended_at or _utcnow()
    start = session.started_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return max(0, int((end - start).total_seconds()))


def update_live_usage(
    db: Session,
    session_id: int,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
) -> CreditUsageSession | None:
    session = db.query(CreditUsageSession).filter(CreditUsageSession.id == session_id).first()
    if session is None or session.status != SESSION_OPEN:
        return session
    if prompt_tokens is not None:
        session.prompt_tokens = max(0, int(prompt_tokens))
    if completion_tokens is not None:
        session.completion_tokens = max(0, int(completion_tokens))
    session.duration_seconds = _duration_seconds(session)
    session.live_credits_estimate = compute_credits(
        prompt_tokens=session.prompt_tokens,
        completion_tokens=session.completion_tokens,
        duration_seconds=session.duration_seconds,
        db=db,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def update_live_usage_by_job(
    db: Session,
    job_id: str,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
) -> CreditUsageSession | None:
    session = (
        db.query(CreditUsageSession)
        .filter(
            CreditUsageSession.job_id == job_id,
            CreditUsageSession.status == SESSION_OPEN,
        )
        .order_by(CreditUsageSession.id.desc())
        .first()
    )
    if session is None:
        return None
    return update_live_usage(
        db,
        session.id,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


def finalize_usage_session(
    db: Session,
    session_id: int,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cancel: bool = False,
) -> CreditUsageSession | None:
    session = db.query(CreditUsageSession).filter(CreditUsageSession.id == session_id).first()
    if session is None:
        return None
    if session.status != SESSION_OPEN:
        return session

    ended = _utcnow()
    if prompt_tokens is not None:
        session.prompt_tokens = max(0, int(prompt_tokens))
    if completion_tokens is not None:
        session.completion_tokens = max(0, int(completion_tokens))
    session.ended_at = ended
    session.duration_seconds = _duration_seconds(session, ended_at=ended)

    if cancel:
        session.status = SESSION_CANCELLED
        session.credits_charged = ZERO
        session.live_credits_estimate = ZERO
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    charge = compute_credits(
        prompt_tokens=session.prompt_tokens,
        completion_tokens=session.completion_tokens,
        duration_seconds=session.duration_seconds,
        db=db,
    )
    account = get_or_create_account(db, session.user_id)
    ensure_daily_reset(db, account)
    debit_credits(
        db,
        account,
        charge,
        entry_type=ENTRY_USAGE_DEBIT,
        note=f"{session.module} job usage",
        usage_session_id=session.id,
    )
    session.credits_charged = charge
    session.live_credits_estimate = charge
    session.status = SESSION_FINALIZED
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def finalize_usage_session_by_job(
    db: Session,
    job_id: str,
    *,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cancel: bool = False,
) -> CreditUsageSession | None:
    session = (
        db.query(CreditUsageSession)
        .filter(
            CreditUsageSession.job_id == job_id,
            CreditUsageSession.status == SESSION_OPEN,
        )
        .order_by(CreditUsageSession.id.desc())
        .first()
    )
    if session is None:
        return None
    return finalize_usage_session(
        db,
        session.id,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cancel=cancel,
    )


def grant_new_user_bonus(db: Session, user: User, *, commit: bool = True) -> bool:
    """Idempotent new-user bonus (bonus_balance)."""
    if user.new_user_bonus_granted_at is not None:
        return False
    settings = get_settings(db)
    amount = _money(settings.new_user_bonus)
    account = get_or_create_account(db, user.id)
    ensure_daily_reset(db, account)
    if amount > ZERO:
        _credit_bonus(
            db,
            account,
            amount,
            entry_type=ENTRY_NEW_USER,
            note="New-user bonus",
        )
    user.new_user_bonus_granted_at = _utcnow()
    db.add(user)
    if commit:
        db.commit()
    else:
        db.flush()
    return True


def apply_referral_bonuses(db: Session, user: User, *, commit: bool = True) -> bool:
    """Grant invitee + inviter referral bonuses once (after verify)."""
    if user.referred_by_user_id is None:
        return False
    # Idempotent: skip if invitee already has a referral_invitee ledger row.
    existing = (
        db.query(CreditLedgerEntry.id)
        .filter(
            CreditLedgerEntry.user_id == user.id,
            CreditLedgerEntry.entry_type == ENTRY_REFERRAL_INVITEE,
        )
        .first()
    )
    if existing is not None:
        return False

    settings = get_settings(db)
    invitee_amount = _money(settings.referral_invitee_bonus)
    inviter_amount = _money(settings.referral_inviter_bonus)

    invitee_account = get_or_create_account(db, user.id)
    ensure_daily_reset(db, invitee_account)
    if invitee_amount > ZERO:
        _credit_bonus(
            db,
            invitee_account,
            invitee_amount,
            entry_type=ENTRY_REFERRAL_INVITEE,
            note=f"Referral invitee bonus (referrer #{user.referred_by_user_id})",
        )

    inviter = db.query(User).filter(User.id == user.referred_by_user_id).first()
    if inviter is not None and inviter_amount > ZERO:
        inviter_account = get_or_create_account(db, inviter.id)
        ensure_daily_reset(db, inviter_account)
        _credit_bonus(
            db,
            inviter_account,
            inviter_amount,
            entry_type=ENTRY_REFERRAL_INVITER,
            note=f"Referral inviter bonus (invitee #{user.id})",
        )

    if commit:
        db.commit()
    else:
        db.flush()
    return True


def on_user_verified(db: Session, user: User) -> None:
    """Grant new-user + referral bonuses after email verification / SSO."""
    grant_new_user_bonus(db, user, commit=False)
    apply_referral_bonuses(db, user, commit=False)
    db.commit()


def admin_adjust(
    db: Session,
    user_id: int,
    amount: Decimal,
    *,
    note: str = "",
) -> UserCreditAccount:
    account = get_or_create_account(db, user_id)
    ensure_daily_reset(db, account)
    amount = _money(amount)
    if amount == ZERO:
        raise ValueError("Adjust amount cannot be zero")
    if amount > ZERO:
        _credit_bonus(
            db,
            account,
            amount,
            entry_type=ENTRY_ADMIN_ADJUST,
            note=note or "Admin credit adjustment",
        )
    else:
        debit_credits(
            db,
            account,
            abs(amount),
            entry_type=ENTRY_ADMIN_ADJUST,
            note=note or "Admin credit adjustment",
        )
    db.commit()
    db.refresh(account)
    return account


def referral_link(referral_code: str | None) -> str | None:
    if not referral_code:
        return None
    return f"{APP_PUBLIC_URL}/register?ref={referral_code}"


def get_dashboard(db: Session, user: User) -> dict[str, Any]:
    account = get_or_create_account(db, user.id)
    ensure_daily_reset(db, account, commit=True)
    db.refresh(account)
    settings = get_settings(db)
    today = _today_utc()
    today_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    today_spent_rows = (
        db.query(CreditLedgerEntry.amount)
        .filter(
            CreditLedgerEntry.user_id == user.id,
            CreditLedgerEntry.entry_type == ENTRY_USAGE_DEBIT,
            CreditLedgerEntry.created_at >= today_start,
        )
        .all()
    )
    today_spent = _money(sum((-row[0] for row in today_spent_rows), ZERO))

    return {
        "bonus_balance": account.bonus_balance,
        "daily_balance": account.daily_balance,
        "spendable": spendable(account),
        "daily_allotment": settings.daily_allotment,
        "daily_date": account.daily_date.isoformat() if account.daily_date else None,
        "today_spent": today_spent,
        "referral_code": user.referral_code,
        "referral_link": referral_link(user.referral_code),
        "hard_gate_enabled": settings.hard_gate_enabled,
        "rates": {
            "per_1k_tokens": settings.per_1k_tokens,
            "per_minute": settings.per_minute,
            "min_job_charge": settings.min_job_charge,
        },
    }


def list_ledger(
    db: Session,
    user_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[CreditLedgerEntry]:
    return (
        db.query(CreditLedgerEntry)
        .filter(CreditLedgerEntry.user_id == user_id)
        .order_by(CreditLedgerEntry.created_at.desc(), CreditLedgerEntry.id.desc())
        .offset(max(0, offset))
        .limit(min(200, max(1, limit)))
        .all()
    )


def list_sessions(
    db: Session,
    user_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[CreditUsageSession]:
    sessions = (
        db.query(CreditUsageSession)
        .filter(CreditUsageSession.user_id == user_id)
        .order_by(CreditUsageSession.started_at.desc(), CreditUsageSession.id.desc())
        .offset(max(0, offset))
        .limit(min(200, max(1, limit)))
        .all()
    )
    # Refresh live estimates for open sessions.
    for session in sessions:
        if session.status == SESSION_OPEN:
            session.duration_seconds = _duration_seconds(session)
            session.live_credits_estimate = compute_credits(
                prompt_tokens=session.prompt_tokens,
                completion_tokens=session.completion_tokens,
                duration_seconds=session.duration_seconds,
                db=db,
            )
            db.add(session)
    db.commit()
    return sessions


def get_session(db: Session, session_id: int, *, user_id: int | None = None) -> CreditUsageSession | None:
    query = db.query(CreditUsageSession).filter(CreditUsageSession.id == session_id)
    if user_id is not None:
        query = query.filter(CreditUsageSession.user_id == user_id)
    session = query.first()
    if session is None:
        return None
    if session.status == SESSION_OPEN:
        session.duration_seconds = _duration_seconds(session)
        session.live_credits_estimate = compute_credits(
            prompt_tokens=session.prompt_tokens,
            completion_tokens=session.completion_tokens,
            duration_seconds=session.duration_seconds,
            db=db,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    return session


def account_summary(db: Session, user_id: int) -> dict[str, Any]:
    account = get_or_create_account(db, user_id)
    ensure_daily_reset(db, account, commit=True)
    db.refresh(account)
    return {
        "bonus_balance": account.bonus_balance,
        "daily_balance": account.daily_balance,
        "spendable": spendable(account),
        "daily_date": account.daily_date.isoformat() if account.daily_date else None,
    }


def begin_job_usage(
    user_id: int | None,
    module: str,
    *,
    job_id: str | None = None,
    check_balance: bool = True,
) -> int | None:
    """Open a usage session using a short-lived DB session. Returns session id."""
    if user_id is None:
        return None
    from backend_api.db.session import SessionLocal

    db = SessionLocal()
    try:
        session = open_usage_session(
            db,
            user_id,
            module=module,
            job_id=job_id,
            check_balance=check_balance,
        )
        return session.id
    finally:
        db.close()


def require_job_credits(user_id: int | None) -> None:
    """Hard-gate check before creating an in-memory job (raises InsufficientCreditsError)."""
    if user_id is None:
        return
    from backend_api.db.session import SessionLocal

    db = SessionLocal()
    try:
        assert_can_start_job(db, user_id)
        db.commit()
    finally:
        db.close()


def end_job_usage(
    *,
    job_id: str | None = None,
    session_id: int | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    cancel: bool = False,
) -> None:
    """Finalize a usage session from a worker thread (best-effort)."""
    if job_id is None and session_id is None:
        return
    from backend_api.db.session import SessionLocal

    db = SessionLocal()
    try:
        if session_id is not None:
            finalize_usage_session(
                db,
                session_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cancel=cancel,
            )
        elif job_id is not None:
            finalize_usage_session_by_job(
                db,
                job_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cancel=cancel,
            )
    except Exception:
        db.rollback()
    finally:
        db.close()


def touch_job_usage(
    *,
    job_id: str | None = None,
    session_id: int | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
) -> None:
    """Best-effort live usage update from a worker."""
    if job_id is None and session_id is None:
        return
    from backend_api.db.session import SessionLocal

    db = SessionLocal()
    try:
        if session_id is not None:
            update_live_usage(
                db,
                session_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
        elif job_id is not None:
            update_live_usage_by_job(
                db,
                job_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
    except Exception:
        db.rollback()
    finally:
        db.close()
