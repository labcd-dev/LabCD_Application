"""Admin-managed per-user developer API keys."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend_api.db.models import DeveloperApiKey, User

KEY_PREFIX = "labcd_"
_KEY_BYTES = 32


class DeveloperApiKeyError(Exception):
    """Raised when developer API key operations fail."""


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _generate_raw_key() -> str:
    return f"{KEY_PREFIX}{secrets.token_hex(_KEY_BYTES)}"


def _to_metadata(row: DeveloperApiKey) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "key_prefix": row.key_prefix,
        "key_last4": row.key_last4,
        "masked_key": f"{row.key_prefix}••••{row.key_last4}",
        "name": row.name or "",
        "created_at": row.created_at,
        "revoked_at": row.revoked_at,
        "last_used_at": row.last_used_at,
        "is_active": row.revoked_at is None,
    }


def get_active_key(db: Session, user_id: int) -> DeveloperApiKey | None:
    return (
        db.query(DeveloperApiKey)
        .filter(
            DeveloperApiKey.user_id == user_id,
            DeveloperApiKey.revoked_at.is_(None),
        )
        .order_by(DeveloperApiKey.created_at.desc())
        .first()
    )


def get_key_metadata(db: Session, user_id: int) -> dict | None:
    row = get_active_key(db, user_id)
    if row is None:
        return None
    return _to_metadata(row)


def create_or_regenerate_key(
    db: Session,
    *,
    user: User,
    admin: User,
    name: str = "",
) -> tuple[dict, str]:
    """Revoke any active key, create a new one. Returns (metadata, raw_key)."""
    now = datetime.now(timezone.utc)
    active = get_active_key(db, user.id)
    if active is not None:
        active.revoked_at = now

    raw_key = _generate_raw_key()
    row = DeveloperApiKey(
        user_id=user.id,
        created_by_admin_id=admin.id,
        key_prefix=KEY_PREFIX,
        key_last4=raw_key[-4:],
        key_hash=_hash_key(raw_key),
        name=(name or "").strip()[:100],
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_metadata(row), raw_key


def revoke_key(db: Session, user_id: int) -> dict | None:
    """Revoke the active key. Returns previous metadata or None if none existed."""
    row = get_active_key(db, user_id)
    if row is None:
        return None
    meta = _to_metadata(row)
    row.revoked_at = datetime.now(timezone.utc)
    db.commit()
    meta["revoked_at"] = row.revoked_at
    meta["is_active"] = False
    return meta


def authenticate_api_key(db: Session, raw_key: str) -> User | None:
    """Look up an active key by raw secret; update last_used_at on success."""
    raw = (raw_key or "").strip()
    if not raw.startswith(KEY_PREFIX) or len(raw) < len(KEY_PREFIX) + 8:
        return None

    key_hash = _hash_key(raw)
    row = (
        db.query(DeveloperApiKey)
        .filter(
            DeveloperApiKey.key_hash == key_hash,
            DeveloperApiKey.revoked_at.is_(None),
        )
        .first()
    )
    if row is None:
        return None

    user = row.user
    if user is None or not user.is_active:
        return None
    if not user.email_verified:
        return None

    row.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return user
