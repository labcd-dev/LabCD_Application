"""Manage whitelisted LLM/search API keys in process env and root .env."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

from backend_api.http.config import PROJECT_ROOT

MANAGED_API_KEYS: tuple[str, ...] = (
    "OPENAI_API_KEY",
    "NVIDIA_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "TAVILY_API_KEY",
)

MANAGED_API_KEY_SET = frozenset(MANAGED_API_KEYS)

_ENV_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=")


class ApiKeyError(Exception):
    """Raised when API key env file operations fail."""


def env_file_path() -> Path:
    return PROJECT_ROOT / ".env"


def _mask_value(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "••••"
    return f"••••{value[-4:]}"


def _current_value(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def list_keys() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for name in MANAGED_API_KEYS:
        value = _current_value(name)
        rows.append(
            {
                "name": name,
                "configured": bool(value),
                "masked_value": _mask_value(value),
            }
        )
    return rows


def _apply_process_env(name: str, value: str | None) -> None:
    if value is None or value == "":
        os.environ.pop(name, None)
    else:
        os.environ[name] = value


def _format_env_assignment(name: str, value: str) -> str:
    if value == "":
        return f"{name}="
    if any(ch in value for ch in (' ', '#', '"', "'", "\n", "\r")):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'{name}="{escaped}"'
    return f"{name}={value}"


def _upsert_env_file(path: Path, updates: dict[str, str]) -> None:
    if not path.exists():
        raise ApiKeyError(f".env file not found at {path}")
    if not os.access(path, os.W_OK):
        raise ApiKeyError(f".env file is not writable at {path}")

    original = path.read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in original else "\n"
    # Preserve final newline behavior of original file.
    lines = original.splitlines()
    pending = dict(updates)
    new_lines: list[str] = []

    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("#") or not stripped:
            new_lines.append(line)
            continue
        match = _ENV_KEY_RE.match(stripped)
        if match is None:
            new_lines.append(line)
            continue
        key = match.group(1)
        if key not in pending:
            new_lines.append(line)
            continue
        new_lines.append(_format_env_assignment(key, pending.pop(key)))

    for key, value in pending.items():
        new_lines.append(_format_env_assignment(key, value))

    content = newline.join(new_lines)
    if original.endswith(("\n", "\r\n")):
        content += newline

    fd, tmp_name = tempfile.mkstemp(
        prefix=".env.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def update_keys(updates: dict[str, str | None]) -> list[str]:
    """Apply updates. Empty string clears; omitted keys are not in `updates`.

    Returns the list of key names that changed.
    """
    if not updates:
        return []

    unknown = sorted(set(updates) - MANAGED_API_KEY_SET)
    if unknown:
        raise ApiKeyError(f"Unknown API key(s): {', '.join(unknown)}")

    changed: list[str] = []
    previous: dict[str, str] = {}
    file_updates: dict[str, str] = {}

    for name, raw in updates.items():
        if raw is None:
            continue
        new_value = raw.strip() if raw else ""
        old_value = _current_value(name)
        if new_value == old_value:
            continue
        previous[name] = old_value
        _apply_process_env(name, new_value if new_value else None)
        file_updates[name] = new_value
        changed.append(name)

    if not file_updates:
        return []

    try:
        _upsert_env_file(env_file_path(), file_updates)
    except ApiKeyError:
        for name, old_value in previous.items():
            _apply_process_env(name, old_value if old_value else None)
        raise
    except OSError as exc:
        for name, old_value in previous.items():
            _apply_process_env(name, old_value if old_value else None)
        raise ApiKeyError(f"Failed to write .env: {exc}") from exc

    return changed
