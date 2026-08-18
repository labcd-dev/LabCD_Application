"""Product analytics: activity and module-usage events plus admin aggregates."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend_api.common.datetime_utils import as_utc, resolve_timezone, utcnow
from backend_api.db.models import AnalyticsEvent, User
from backend_api.db.session import SessionLocal

EVENT_ACTIVE = "active"
EVENT_MODULE = "module"
EVENT_LLM = "llm"

VALID_MODULES = frozenset({"silo", "mulo", "recommender", "trimmer", "regularize", "plant_model"})
MAX_LLM_MODEL_LEN = 100


def _utcnow() -> datetime:
    return utcnow()


def _utc_day_start(moment: datetime | None = None) -> datetime:
    now = as_utc(moment or _utcnow())
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _calendar_date(moment: datetime, tz: ZoneInfo) -> date:
    return as_utc(moment).astimezone(tz).date()


def _local_midnight_utc(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)


def record_active_day(db: Session, user_id: int) -> None:
    """Insert at most one active event per user per UTC day."""
    day_start = _utc_day_start()
    day_end = day_start + timedelta(days=1)
    exists = (
        db.query(AnalyticsEvent.id)
        .filter(
            AnalyticsEvent.user_id == user_id,
            AnalyticsEvent.event_type == EVENT_ACTIVE,
            AnalyticsEvent.created_at >= day_start,
            AnalyticsEvent.created_at < day_end,
        )
        .first()
    )
    if exists is not None:
        return
    db.add(
        AnalyticsEvent(
            user_id=user_id,
            event_type=EVENT_ACTIVE,
            module=None,
            created_at=_utcnow(),
        )
    )
    db.commit()


def record_module_use(user_id: int | None, module: str) -> None:
    """Persist a module-run event. Opens its own DB session (safe from workers)."""
    if user_id is None:
        return
    if module not in VALID_MODULES:
        return
    db = SessionLocal()
    try:
        db.add(
            AnalyticsEvent(
                user_id=user_id,
                event_type=EVENT_MODULE,
                module=module,
                created_at=_utcnow(),
            )
        )
        db.commit()
    finally:
        db.close()


def record_llm_use(user_id: int | None, llm_model: str | None) -> None:
    """Persist an LLM-model usage event. Opens its own DB session (safe from workers)."""
    if user_id is None:
        return
    model = (llm_model or "").strip()
    if not model:
        return
    model = model[:MAX_LLM_MODEL_LEN]
    db = SessionLocal()
    try:
        db.add(
            AnalyticsEvent(
                user_id=user_id,
                event_type=EVENT_LLM,
                module=model,
                created_at=_utcnow(),
            )
        )
        db.commit()
    finally:
        db.close()


def _distinct_active_count(db: Session, start: datetime, end: datetime) -> int:
    return (
        db.query(func.count(func.distinct(AnalyticsEvent.user_id)))
        .filter(
            AnalyticsEvent.event_type == EVENT_ACTIVE,
            AnalyticsEvent.created_at >= start,
            AnalyticsEvent.created_at < end,
        )
        .scalar()
        or 0
    )


def _cohort_retention(db: Session, *, retention_days: int, now: datetime) -> float | None:
    """Share of cohort users who returned on or after day N relative to signup.

    Cohort: users created in [now - 2N days, now - N days).
    """
    cohort_end = _utc_day_start(now - timedelta(days=retention_days))
    cohort_start = _utc_day_start(now - timedelta(days=2 * retention_days))
    cohort_users = (
        db.query(User.id, User.created_at)
        .filter(
            User.created_at >= cohort_start,
            User.created_at < cohort_end,
        )
        .all()
    )
    if not cohort_users:
        return None

    retained = 0
    for user_id, created_at in cohort_users:
        created_at = as_utc(created_at)
        threshold = created_at + timedelta(days=retention_days)
        hit = (
            db.query(AnalyticsEvent.id)
            .filter(
                AnalyticsEvent.user_id == user_id,
                AnalyticsEvent.event_type == EVENT_ACTIVE,
                AnalyticsEvent.created_at >= threshold,
            )
            .first()
        )
        if hit is not None:
            retained += 1
    return retained / len(cohort_users)


def get_analytics(db: Session, days: int = 30, tz_name: str | None = None) -> dict:
    """Aggregate DAU/MAU series, retention, and module usage for the admin UI."""
    days = max(1, min(int(days), 90))
    tz = resolve_timezone(tz_name)
    now = _utcnow()
    today_local = _calendar_date(now, tz)
    today_start = _local_midnight_utc(today_local, tz)
    tomorrow = _local_midnight_utc(today_local + timedelta(days=1), tz)
    range_start_date = today_local - timedelta(days=days - 1)
    range_start = _local_midnight_utc(range_start_date, tz)
    mau_window_start = _local_midnight_utc(today_local - timedelta(days=29), tz)

    dau_today = _distinct_active_count(db, today_start, tomorrow)
    mau = _distinct_active_count(db, mau_window_start, tomorrow)

    # Preload active events spanning MAU lookback for the earliest series day.
    series_lookback_start = _local_midnight_utc(range_start_date - timedelta(days=29), tz)
    active_rows = (
        db.query(AnalyticsEvent.user_id, AnalyticsEvent.created_at)
        .filter(
            AnalyticsEvent.event_type == EVENT_ACTIVE,
            AnalyticsEvent.created_at >= series_lookback_start,
            AnalyticsEvent.created_at < tomorrow,
        )
        .all()
    )
    # user_id -> set of viewer-local calendar dates with activity
    activity_by_user: dict[int, set[date]] = {}
    for user_id, created_at in active_rows:
        activity_by_user.setdefault(user_id, set()).add(_calendar_date(created_at, tz))

    dau_series: list[dict] = []
    mau_series: list[dict] = []
    for offset in range(days):
        day = range_start_date + timedelta(days=offset)
        day_users = {
            user_id
            for user_id, days_set in activity_by_user.items()
            if day in days_set
        }
        mau_start = day - timedelta(days=29)
        mau_users = {
            user_id
            for user_id, days_set in activity_by_user.items()
            if any(mau_start <= d <= day for d in days_set)
        }
        dau_series.append({"date": day.isoformat(), "count": len(day_users)})
        mau_series.append({"date": day.isoformat(), "count": len(mau_users)})

    module_rows = (
        db.query(AnalyticsEvent.module, func.count(AnalyticsEvent.id))
        .filter(
            AnalyticsEvent.event_type == EVENT_MODULE,
            AnalyticsEvent.created_at >= range_start,
            AnalyticsEvent.created_at < tomorrow,
            AnalyticsEvent.module.isnot(None),
        )
        .group_by(AnalyticsEvent.module)
        .order_by(func.count(AnalyticsEvent.id).desc())
        .all()
    )
    modules = [
        {"module": module or "", "count": int(count)}
        for module, count in module_rows
        if module
    ]

    llm_rows = (
        db.query(AnalyticsEvent.module, func.count(AnalyticsEvent.id))
        .filter(
            AnalyticsEvent.event_type == EVENT_LLM,
            AnalyticsEvent.created_at >= range_start,
            AnalyticsEvent.created_at < tomorrow,
            AnalyticsEvent.module.isnot(None),
        )
        .group_by(AnalyticsEvent.module)
        .order_by(func.count(AnalyticsEvent.id).desc())
        .all()
    )
    llms = [
        {"model": model or "", "count": int(count)}
        for model, count in llm_rows
        if model
    ]
    most_used_llm = llms[0]["model"] if llms else None

    return {
        "days": days,
        "dau_today": dau_today,
        "mau": mau,
        "retention_d7": _cohort_retention(db, retention_days=7, now=now),
        "retention_d30": _cohort_retention(db, retention_days=30, now=now),
        "dau_series": dau_series,
        "mau_series": mau_series,
        "modules": modules,
        "llms": llms,
        "most_used_llm": most_used_llm,
    }
