"""In-process system and API request metrics for the admin monitoring panel."""

from __future__ import annotations

import statistics
import threading
import time
from collections import deque
from typing import Deque, Dict, List, Optional, Tuple

import psutil

from backend_api.common.datetime_utils import utc_iso, utcnow
from backend_api.http.config import API_PREFIX

HISTORY_SIZE = 60
REQUEST_WINDOW_SIZE = 500
EXCLUDED_PATH_SUFFIXES = (
    f"{API_PREFIX}/admin/monitoring",
    f"{API_PREFIX}/health",
)

_PROCESS_START = time.time()
_lock = threading.Lock()
_requests: Deque[Tuple[float, float, int]] = deque(maxlen=REQUEST_WINDOW_SIZE)
_history: Deque[Dict] = deque(maxlen=HISTORY_SIZE)
_prev_net: Optional[Tuple[float, int, int]] = None


def _utc_now_iso() -> str:
    return utc_iso(utcnow())


def _should_track_path(path: str) -> bool:
    normalized = path.rstrip("/") or "/"
    for suffix in EXCLUDED_PATH_SUFFIXES:
        if normalized == suffix or normalized.endswith(suffix):
            return False
    return True


def record_request(path: str, status_code: int, duration_ms: float) -> None:
    """Record a completed HTTP request for latency / error-rate stats."""
    if not _should_track_path(path):
        return
    with _lock:
        _requests.append((time.time(), max(0.0, duration_ms), int(status_code)))


def _percentile(sorted_values: List[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (len(sorted_values) - 1) * pct
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    weight = rank - low
    return sorted_values[low] * (1.0 - weight) + sorted_values[high] * weight


def _api_metrics() -> Dict:
    with _lock:
        samples = list(_requests)
    if not samples:
        return {
            "avg_latency_ms": 0.0,
            "p50_latency_ms": 0.0,
            "p95_latency_ms": 0.0,
            "error_rate_percent": 0.0,
            "requests_in_window": 0,
        }

    durations = sorted(duration for _, duration, _ in samples)
    errors = sum(1 for _, _, status in samples if status >= 500)
    return {
        "avg_latency_ms": round(statistics.fmean(durations), 2),
        "p50_latency_ms": round(_percentile(durations, 0.50), 2),
        "p95_latency_ms": round(_percentile(durations, 0.95), 2),
        "error_rate_percent": round((errors / len(samples)) * 100.0, 2),
        "requests_in_window": len(samples),
    }


def _disk_path() -> str:
    return "C:\\" if psutil.WINDOWS else "/"


def _network_metrics() -> Dict:
    global _prev_net
    counters = psutil.net_io_counters()
    now = time.time()
    sent = int(counters.bytes_sent)
    recv = int(counters.bytes_recv)
    sent_rate = 0.0
    recv_rate = 0.0
    with _lock:
        prev = _prev_net
        if prev is not None:
            prev_t, prev_sent, prev_recv = prev
            elapsed = max(now - prev_t, 1e-6)
            sent_rate = max(0.0, (sent - prev_sent) / elapsed)
            recv_rate = max(0.0, (recv - prev_recv) / elapsed)
        _prev_net = (now, sent, recv)
    return {
        "bytes_sent": sent,
        "bytes_recv": recv,
        "sent_rate_bps": round(sent_rate, 2),
        "recv_rate_bps": round(recv_rate, 2),
    }


def collect_snapshot() -> Dict:
    """Collect a live metrics snapshot and append it to in-memory history."""
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(_disk_path())
    # First call often returns 0.0; a tiny interval yields a meaningful reading.
    cpu_percent = psutil.cpu_percent(interval=0.1)

    snapshot = {
        "collected_at": _utc_now_iso(),
        "uptime_seconds": round(time.time() - _PROCESS_START, 1),
        "cpu_percent": round(cpu_percent, 2),
        "memory": {
            "used_bytes": int(memory.used),
            "total_bytes": int(memory.total),
            "percent": round(float(memory.percent), 2),
        },
        "disk": {
            "used_bytes": int(disk.used),
            "total_bytes": int(disk.total),
            "percent": round(float(disk.percent), 2),
        },
        "network": _network_metrics(),
        "api": _api_metrics(),
    }
    with _lock:
        _history.append(snapshot)
        history = list(_history)
    return {"current": snapshot, "history": history}
