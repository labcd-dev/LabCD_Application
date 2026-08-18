"""Serialization helpers shared across backend workflows."""

import ast
import json
import math
from datetime import date, datetime
from typing import Any, Optional

from backend_api.common.datetime_utils import utc_iso


def _sanitize_number(value: float) -> Any:
    """Convert non-finite floats to null for strict JSON compatibility."""
    if not math.isfinite(value):
        return None
    return value


def make_serializable(obj: Any) -> Any:
    """Convert arbitrary objects to JSON-serializable values."""
    if callable(obj):
        return str(obj)
    if hasattr(obj, "tolist"):
        return make_serializable(obj.tolist())
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes, dict, list)):
        try:
            return make_serializable(obj.item())
        except (ValueError, TypeError):
            pass
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, int) and not isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        return _sanitize_number(obj)
    if isinstance(obj, datetime):
        return utc_iso(obj)
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {key: make_serializable(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [make_serializable(item) for item in obj]

    try:
        json.dumps(obj, allow_nan=False)
        return obj
    except (TypeError, ValueError):
        return str(obj)


def is_json_mapping(value: str) -> Optional[bool]:
    """Return True when the string parses to a mapping, preserving legacy falsy None."""
    try:
        result = json.loads(value)
        return isinstance(result, dict)
    except json.JSONDecodeError:
        pass

    try:
        result = ast.literal_eval(value)
        return isinstance(result, dict)
    except (ValueError, SyntaxError):
        pass

    return None
