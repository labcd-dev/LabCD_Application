"""Package initialization for backend_core."""

from __future__ import annotations

import importlib.abc
import importlib.util
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent


class _BackendCoreRedirect(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if not fullname.startswith("backend_core."):
            return None
        # If the file or directory actually exists in backend_core, do not intercept!
        parts = fullname.split(".")
        if len(parts) >= 2:
            sub = parts[1]
            if (_THIS_DIR / sub).exists() or (_THIS_DIR / f"{sub}.py").exists():
                return None
        redirected = "backend_api." + fullname[len("backend_core.") :]
        try:
            return importlib.util.find_spec(redirected)
        except (ModuleNotFoundError, ValueError):
            return None


if not any(isinstance(finder, _BackendCoreRedirect) for finder in sys.meta_path):
    sys.meta_path.append(_BackendCoreRedirect())

