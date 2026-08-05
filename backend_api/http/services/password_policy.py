"""Shared password strength rules for register, reset, and change-password."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

MIN_PASSWORD_LENGTH = 12

_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "common_passwords.txt"
_HAS_LETTER = re.compile(r"[A-Za-z]")
_HAS_DIGIT = re.compile(r"\d")


@lru_cache(maxsize=1)
def _common_passwords() -> frozenset[str]:
    if not _DATA_PATH.is_file():
        return frozenset()
    lines = _DATA_PATH.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip())


def validate_password(
    password: str,
    *,
    email: str | None = None,
    display_name: str | None = None,
) -> None:
    """Raise ValueError when password does not meet policy."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

    if not _HAS_LETTER.search(password) or not _HAS_DIGIT.search(password):
        raise ValueError("Password must include both letters and numbers")

    lowered = password.lower()
    if lowered in _common_passwords():
        raise ValueError("Password is too common; choose a stronger one")

    if email:
        normalized_email = email.lower().strip()
        local_part = normalized_email.split("@", 1)[0]
        if normalized_email and normalized_email in lowered:
            raise ValueError("Password must not contain your email address")
        if local_part and len(local_part) >= 3 and local_part in lowered:
            raise ValueError("Password must not contain your email username")

    if display_name:
        name = display_name.strip().lower()
        if name and len(name) >= 3 and name in lowered:
            raise ValueError("Password must not contain your display name")
