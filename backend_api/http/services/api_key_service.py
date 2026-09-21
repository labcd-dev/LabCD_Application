"""Manage whitelisted LLM/search API keys in process env and root .env."""

from __future__ import annotations

import os
import re
import tempfile
import threading
from pathlib import Path

from backend_api.http.config import PROJECT_ROOT

MANAGED_API_KEYS: tuple[str, ...] = (
    "OPENAI_API_KEY",
    "NVIDIA_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "TAVILY_API_KEY",
    # Stripe billing — see backend_api.http.services.stripe_service. Reused via
    # this same admin "API keys" UI/endpoint rather than a bespoke settings page.
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
)

MANAGED_API_KEY_SET = frozenset(MANAGED_API_KEYS)

_ENV_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=")
# Match KEY=value or KEY="value" / KEY='value' (dotenv-style).
_ENV_LINE_RE = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$"
)

_reload_lock = threading.Lock()
_last_env_mtime: float | None = None


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
    # Prefer live process env (updated by admin save). Also pull from file so a
    # freshly started worker that has not yet received task_prerun still reflects
    # the on-disk source of truth when the admin page is opened against the API.
    refresh_managed_keys_from_env_file(force=False)
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


def _unquote_env_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        quote = value[0]
        inner = value[1:-1]
        if quote == '"':
            inner = inner.replace('\\"', '"').replace("\\\\", "\\")
        return inner
    # Strip inline comments for unquoted values (dotenv behaviour).
    if " #" in value or "\t#" in value:
        value = re.split(r"(?<!\S)#", value, maxsplit=1)[0].rstrip()
    return value


def _parse_env_file_managed(path: Path) -> dict[str, str]:
    """Return managed key -> value from a .env file (empty string = cleared)."""
    if not path.is_file():
        return {}
    result: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _ENV_LINE_RE.match(stripped)
        if match is None:
            continue
        key, raw_val = match.group(1), match.group(2)
        if key not in MANAGED_API_KEY_SET:
            continue
        result[key] = _unquote_env_value(raw_val)
    return result


def refresh_managed_keys_from_env_file(*, force: bool = False) -> bool:
    """Reload managed API keys from the root ``.env`` into ``os.environ``.

    Used by Celery workers (and optionally the API) so that admin saves that
    only update the shared ``.env`` bind-mount are visible without a process
    restart. Returns True if the file was (re)read.
    """
    global _last_env_mtime
    path = env_file_path()
    try:
        mtime = path.stat().st_mtime if path.is_file() else None
    except OSError:
        return False

    with _reload_lock:
        if not force and mtime is not None and _last_env_mtime is not None and mtime <= _last_env_mtime:
            return False
        file_values = _parse_env_file_managed(path)
        # Apply every managed key that appears in the file; keys absent from the
        # file are left untouched (may still come from container env_file injection).
        for name, value in file_values.items():
            _apply_process_env(name, value if value else None)
        _last_env_mtime = mtime
        return True


def _ensure_env_file(path: Path) -> None:
    """Create an empty .env when missing so first-time admin saves can persist."""
    if path.exists():
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
    except OSError as exc:
        raise ApiKeyError(f"Could not create .env at {path}: {exc}") from exc


def _upsert_env_file(path: Path, updates: dict[str, str]) -> None:
    _ensure_env_file(path)
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
    if original.endswith(("\n", "\r\n")) or not original:
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
        try:
            os.replace(tmp_path, path)
        except OSError:
            # Fall back to in-place overwrite when file is a Docker bind mount (EBUSY / Errno 16)
            with open(path, "w", encoding="utf-8", newline="") as dst:
                dst.write(content)
                dst.flush()
                os.fsync(dst.fileno())
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def update_env_keys(
    updates: dict[str, str | None],
    *,
    allowed: frozenset[str],
) -> list[str]:
    """Apply env updates for an allowlisted set of keys.

    Empty string clears; keys with value ``None`` are ignored.
    Returns the list of key names that changed.
    """
    if not updates:
        return []

    unknown = sorted(set(updates) - allowed)
    if unknown:
        raise ApiKeyError(f"Unknown env key(s): {', '.join(unknown)}")

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

    # Bump reload marker so this process's next refresh sees the new mtime.
    global _last_env_mtime
    try:
        _last_env_mtime = env_file_path().stat().st_mtime
    except OSError:
        _last_env_mtime = None

    return changed


def update_keys(updates: dict[str, str | None]) -> list[str]:
    """Apply LLM/search API key updates. Empty string clears."""
    return update_env_keys(updates, allowed=MANAGED_API_KEY_SET)


def mask_secret(value: str) -> str:
    """Public alias used by other admin endpoints."""
    return _mask_value(value)


def current_env_value(name: str) -> str:
    """Return the live process-env value for ``name`` (after optional refresh)."""
    refresh_managed_keys_from_env_file(force=False)
    return _current_value(name)
