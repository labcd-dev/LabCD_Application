"""Inclusive calendar-day range filters for admin list/export queries."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, TypeVar

from backend_api.common.datetime_utils import as_utc, resolve_timezone

Q = TypeVar("Q")


def parse_iso_date(value: str | None) -> date | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        return date.fromisoformat(cleaned[:10])
    except ValueError:
        return None


def date_range_bounds(
    date_from: str | None,
    date_to: str | None,
    tz_name: str | None = None,
) -> tuple[datetime | None, datetime | None]:
    """Return [start, end) UTC bounds for inclusive local calendar days."""
    tz = resolve_timezone(tz_name)
    start_day = parse_iso_date(date_from)
    end_day = parse_iso_date(date_to)
    start = (
        datetime.combine(start_day, time.min, tzinfo=tz).astimezone(timezone.utc)
        if start_day is not None
        else None
    )
    end = (
        datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=tz).astimezone(
            timezone.utc
        )
        if end_day is not None
        else None
    )
    return start, end


def apply_sql_date_range(
    query: Q,
    column: Any,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
) -> Q:
    start, end = date_range_bounds(date_from, date_to, tz)
    if start is not None:
        query = query.filter(column >= start)
    if end is not None:
        query = query.filter(column < end)
    return query


def is_in_date_range(
    moment: datetime | None,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
) -> bool:
    if not date_from and not date_to:
        return True
    if moment is None:
        return False
    start, end = date_range_bounds(date_from, date_to, tz)
    value = as_utc(moment)
    if start is not None and value < start:
        return False
    if end is not None and value >= end:
        return False
    return True
