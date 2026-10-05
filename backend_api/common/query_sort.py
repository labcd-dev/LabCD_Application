"""Shared sort helpers for admin list/export queries."""

from __future__ import annotations

from typing import Any, Callable, Iterable, Sequence


def normalize_sort_dir(sort_dir: str | None, *, default: str = "asc") -> str:
    value = (sort_dir or default).strip().lower()
    return "desc" if value == "desc" else "asc"


def resolve_sort_key(
    sort_by: str | None,
    allowed: Sequence[str],
    *,
    default: str,
) -> str:
    key = (sort_by or default).strip()
    if key in allowed:
        return key
    return default


def apply_sql_order(
    query: Any,
    columns: dict[str, Any],
    *,
    sort_by: str | None,
    sort_dir: str | None,
    default_key: str,
    default_dir: str = "asc",
) -> Any:
    """Apply ORDER BY from a whitelist of SQLAlchemy columns."""
    key = resolve_sort_key(sort_by, tuple(columns.keys()), default=default_key)
    direction = normalize_sort_dir(sort_dir, default=default_dir)
    column = columns[key]
    return query.order_by(column.desc() if direction == "desc" else column.asc())


def sort_rows(
    rows: Iterable[Any],
    *,
    sort_by: str | None,
    sort_dir: str | None,
    default_key: str,
    default_dir: str = "asc",
    accessors: dict[str, Callable[[Any], Any]],
) -> list[Any]:
    """Sort in-memory rows with the same whitelist semantics as SQL sort."""
    key = resolve_sort_key(sort_by, tuple(accessors.keys()), default=default_key)
    direction = normalize_sort_dir(sort_dir, default=default_dir)
    accessor = accessors[key]
    reverse = direction == "desc"

    def sort_value(item: Any) -> tuple[int, Any]:
        value = accessor(item)
        if value is None or value == "":
            return (1, "")
        if isinstance(value, bool):
            return (0, int(value))
        if isinstance(value, (int, float)):
            return (0, value)
        return (0, str(value).lower())

    return sorted(rows, key=sort_value, reverse=reverse)
