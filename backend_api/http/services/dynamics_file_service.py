"""Persist user-uploaded plant dynamics files under UPLOADS_DIR."""

from __future__ import annotations

import uuid
from pathlib import Path

from backend_api.http.config import API_PREFIX, UPLOADS_DIR

DYNAMICS_DIR = UPLOADS_DIR / "dynamics"
URL_PREFIX = f"{API_PREFIX}/uploads/dynamics/"


def _extension(file_name: str, file_type: str) -> str:
    suffix = Path(file_name or "").suffix.lower()
    if suffix in {".py", ".m"}:
        return suffix
    return ".m" if (file_type or "").lower() == "matlab" else ".py"


def _safe_stem(file_name: str) -> str:
    stem = Path(file_name or "dynamics").stem
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in stem).strip("-_")
    return (cleaned[:48] or "dynamics")


def _path_from_url(file_url: str | None) -> Path | None:
    if not file_url or not file_url.startswith(URL_PREFIX):
        return None
    name = Path(file_url[len(URL_PREFIX) :]).name
    if not name or name != file_url[len(URL_PREFIX) :]:
        return None
    return DYNAMICS_DIR / name


def save_dynamics_file(
    *,
    content: str,
    file_name: str,
    file_type: str = "python",
    existing_url: str | None = None,
) -> str | None:
    """Write dynamics source to disk and return a public uploads URL."""
    text = content or ""
    if not text.strip():
        return existing_url

    DYNAMICS_DIR.mkdir(parents=True, exist_ok=True)
    data = text.encode("utf-8")
    existing_path = _path_from_url(existing_url)
    if existing_path is not None:
        existing_path.write_bytes(data)
        return existing_url

    filename = f"{_safe_stem(file_name)}-{uuid.uuid4().hex[:12]}{_extension(file_name, file_type)}"
    path = DYNAMICS_DIR / filename
    path.write_bytes(data)
    return f"{URL_PREFIX}{filename}"


def delete_dynamics_file(file_url: str | None) -> None:
    path = _path_from_url(file_url)
    if path is None or not path.is_file():
        return
    path.unlink(missing_ok=True)
