"""User-facing credit dashboard routes."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user
from backend_api.http.schemas.credits import (
    CreditDashboardOut,
    CreditLedgerEntryOut,
    CreditRatesOut,
    CreditUsageSessionOut,
)
from backend_api.http.services import credit_service

router = APIRouter(prefix="/credits", tags=["credits"])


def _ledger_out(row) -> CreditLedgerEntryOut:
    return CreditLedgerEntryOut(
        id=row.id,
        amount=row.amount,
        balance_after=row.balance_after,
        entry_type=row.entry_type,
        usage_session_id=row.usage_session_id,
        note=row.note or "",
        created_at=row.created_at,
    )


def _session_out(row) -> CreditUsageSessionOut:
    return CreditUsageSessionOut(
        id=row.id,
        module=row.module,
        job_id=row.job_id,
        status=row.status,
        started_at=row.started_at,
        ended_at=row.ended_at,
        duration_seconds=row.duration_seconds,
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        credits_charged=row.credits_charged,
        live_credits_estimate=row.live_credits_estimate,
    )


@router.get("/me", response_model=CreditDashboardOut)
def get_my_credits(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreditDashboardOut:
    data = credit_service.get_dashboard(db, user)
    return CreditDashboardOut(
        bonus_balance=data["bonus_balance"],
        daily_balance=data["daily_balance"],
        spendable=data["spendable"],
        daily_allotment=data["daily_allotment"],
        daily_date=data["daily_date"],
        today_spent=data["today_spent"],
        referral_code=data["referral_code"],
        referral_link=data["referral_link"],
        hard_gate_enabled=data["hard_gate_enabled"],
        rates=CreditRatesOut(**data["rates"]),
    )


@router.get("/me/ledger", response_model=list[CreditLedgerEntryOut])
def get_my_ledger(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CreditLedgerEntryOut]:
    rows = credit_service.list_ledger(db, user.id, limit=limit, offset=offset)
    return [_ledger_out(row) for row in rows]


@router.get("/me/sessions", response_model=list[CreditUsageSessionOut])
def get_my_sessions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CreditUsageSessionOut]:
    rows = credit_service.list_sessions(db, user.id, limit=limit, offset=offset)
    return [_session_out(row) for row in rows]


@router.get("/sessions/{session_id}", response_model=CreditUsageSessionOut)
def get_usage_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreditUsageSessionOut:
    row = credit_service.get_session(db, session_id, user_id=user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Usage session not found")
    return _session_out(row)
