"""Shared helpers for CSV export."""

from __future__ import annotations

import csv
import io
from typing import Any, Iterable, Sequence

from starlette.responses import StreamingResponse

# Excel on Windows misreads UTF-8 CSV without a BOM (Persian becomes mojibake).
_UTF8_BOM = "\ufeff"


def rows_to_csv(rows: Iterable[dict[str, Any]], fieldnames: Sequence[str]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()


def with_utf8_bom(content: str) -> str:
    if content.startswith(_UTF8_BOM):
        return content
    return f"{_UTF8_BOM}{content}"


def csv_response(content: str, filename: str) -> StreamingResponse:
    """Return a downloadable CSV with UTF-8 BOM so Excel shows Persian correctly."""
    return StreamingResponse(
        iter([with_utf8_bom(content)]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
