"""Redis client provider and helper utilities with graceful fallback."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from backend_api.http.config import REDIS_URL

log = logging.getLogger(__name__)

_redis_client: Any = None
_redis_checked: bool = False
_redis_available: bool = False


def get_redis_client():
    """Return a singleton Redis client instance or None if unavailable."""
    global _redis_client, _redis_checked, _redis_available
    if _redis_client is not None:
        return _redis_client if _redis_available else None

    if _redis_checked and not _redis_available:
        return None

    try:
        import redis

        client = redis.Redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2.0,
            socket_timeout=2.0,
        )
        # Verify connection
        client.ping()
        _redis_client = client
        _redis_available = True
        _redis_checked = True
        log.info("Successfully connected to Redis at %s", REDIS_URL)
        return _redis_client
    except Exception as exc:
        _redis_checked = True
        _redis_available = False
        log.debug("Redis not available (%s); falling back to in-memory store.", exc)
        return None


def is_redis_available() -> bool:
    """Check if Redis connection is active and healthy."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        return bool(client.ping())
    except Exception:
        return False


def redis_set_json(key: str, value: Any, ex: Optional[int] = None) -> bool:
    """Store serializable python object as JSON string in Redis."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        payload = json.dumps(value, default=str)
        client.set(key, payload, ex=ex)
        return True
    except Exception as exc:
        log.warning("Failed to set JSON key '%s' in Redis: %s", key, exc)
        return False


def redis_get_json(key: str) -> Optional[Any]:
    """Retrieve and deserialize JSON string from Redis."""
    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        log.warning("Failed to get JSON key '%s' from Redis: %s", key, exc)
        return None


def redis_delete(key: str) -> bool:
    """Delete a key from Redis."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        client.delete(key)
        return True
    except Exception as exc:
        log.warning("Failed to delete key '%s' from Redis: %s", key, exc)
        return False


def redis_publish(channel: str, message: Any) -> bool:
    """Publish a message to a Redis Pub/Sub channel."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        payload = json.dumps(message, default=str) if not isinstance(message, str) else message
        client.publish(channel, payload)
        return True
    except Exception as exc:
        log.warning("Failed to publish to channel '%s': %s", channel, exc)
        return False


def redis_push_list(key: str, item: Any) -> bool:
    """Append a serializable item to a Redis list."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        payload = json.dumps(item, default=str)
        client.rpush(key, payload)
        return True
    except Exception as exc:
        log.warning("Failed to rpush to list '%s': %s", key, exc)
        return False


def redis_get_list(key: str, start: int = 0, end: int = -1) -> list[Any]:
    """Retrieve list of deserialized JSON items from Redis list."""
    client = get_redis_client()
    if client is None:
        return []
    try:
        items = client.lrange(key, start, end)
        return [json.loads(it) for it in items]
    except Exception as exc:
        log.warning("Failed to get list '%s' from Redis: %s", key, exc)
        return []
