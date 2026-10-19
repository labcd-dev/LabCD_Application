"""Shared page/limit helpers for admin list endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, TypeVar

DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100

T = TypeVar("T")


@dataclass(frozen=True)
class PaginationResult(Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


def normalize_page(page: int | None, *, default: int = 1) -> int:
    value = default if page is None else int(page)
    return max(1, value)


def normalize_page_size(
    page_size: int | None,
    *,
    default: int = DEFAULT_PAGE_SIZE,
    max_size: int = MAX_PAGE_SIZE,
) -> int:
    value = default if page_size is None else int(page_size)
    return max(1, min(value, max_size))


def page_offset(page: int, page_size: int) -> int:
    return (page - 1) * page_size


def paginate_query(
    query: Any,
    *,
    page: int = 1,
    page_size: int | None = DEFAULT_PAGE_SIZE,
    max_size: int = MAX_PAGE_SIZE,
) -> PaginationResult[Any]:
    """Apply COUNT + OFFSET/LIMIT. ``page_size=None`` returns the full result set."""
    if page_size is None:
        items = query.all()
        total = len(items)
        return PaginationResult(items=items, total=total, page=1, page_size=total or 1)

    safe_page = normalize_page(page)
    safe_size = normalize_page_size(page_size, max_size=max_size)
    total = int(query.order_by(None).count())
    items = (
        query.offset(page_offset(safe_page, safe_size))
        .limit(safe_size)
        .all()
    )
    return PaginationResult(
        items=items,
        total=total,
        page=safe_page,
        page_size=safe_size,
    )


def paginate_sequence(
    rows: list[T],
    *,
    page: int = 1,
    page_size: int | None = DEFAULT_PAGE_SIZE,
    max_size: int = MAX_PAGE_SIZE,
) -> PaginationResult[T]:
    """Slice an in-memory list. ``page_size=None`` returns the full list."""
    total = len(rows)
    if page_size is None:
        return PaginationResult(items=rows, total=total, page=1, page_size=total or 1)

    safe_page = normalize_page(page)
    safe_size = normalize_page_size(page_size, max_size=max_size)
    start = page_offset(safe_page, safe_size)
    return PaginationResult(
        items=rows[start : start + safe_size],
        total=total,
        page=safe_page,
        page_size=safe_size,
    )
