"""UTC datetime helpers for API timestamps."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_UTC = timezone.utc


def utcnow() -> datetime:
    return datetime.now(_UTC)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=_UTC)
    return value.astimezone(_UTC)


def utc_iso(value: datetime | None) -> str:
    """Serialize a datetime as UTC ISO-8601 with a Z suffix.

    Naive values are treated as UTC, matching how the database stores timestamps.
    """
    if value is None:
        return ""
    return as_utc(value).isoformat().replace("+00:00", "Z")


def resolve_timezone(name: str | None) -> ZoneInfo:
    """Return an IANA timezone, falling back to UTC when the name is missing or invalid."""
    if not name:
        return ZoneInfo("UTC")
    cleaned = name.strip()
    if not cleaned:
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(cleaned)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return ZoneInfo("UTC")
