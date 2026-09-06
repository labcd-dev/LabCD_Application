"""Integration tests for AgentAdaptive and AgentMPC routes and services in LabCD_Application."""

from __future__ import annotations

try:
    import pytest
except ImportError:
    pytest = None

from backend_api.http.main import app
from backend_api.http.services.adaptive_job_store import InMemoryAdaptiveJobStore
from backend_api.http.services.mpc_job_store import InMemoryMPCJobStore


def test_routes_registered():
    """Verify that adaptive and mpc routes are registered under /api/v1."""
    routes = [route.path for route in app.routes]
    
    # Adaptive routes
    assert "/api/v1/adaptive/jobs" in routes
    assert "/api/v1/adaptive/jobs/{job_id}" in routes
    assert "/api/v1/adaptive/jobs/{job_id}/clarify" in routes
    assert "/api/v1/adaptive/jobs/{job_id}/cancel" in routes
    assert "/api/v1/adaptive/jobs/{job_id}/results" in routes
    assert "/api/v1/adaptive/jobs/{job_id}/events" in routes
    
    # MPC routes
    assert "/api/v1/mpc/jobs" in routes
    assert "/api/v1/mpc/jobs/{job_id}" in routes
    assert "/api/v1/mpc/jobs/{job_id}/cancel" in routes
    assert "/api/v1/mpc/jobs/{job_id}/results" in routes
    assert "/api/v1/mpc/jobs/{job_id}/events" in routes

    # Plant model artifact routes
    assert "/api/v1/plant-model/artifacts" in routes
    assert "/api/v1/plant-model/artifacts/{artifact_id}" in routes
    assert "/api/v1/plant-model/artifacts/{artifact_id}/plugin" in routes
    assert "/api/v1/plant-model/artifacts/{artifact_id}/adaptive-spec" in routes
    assert "/api/v1/plant-model/validate" in routes

    # Database ORM models
    from backend_api.db.models import AdaptiveJobRecord, MPCJobRecord
    assert AdaptiveJobRecord.__tablename__ == "adaptive_jobs"
    assert MPCJobRecord.__tablename__ == "mpc_jobs"


def test_adaptive_job_store():
    store = InMemoryAdaptiveJobStore()
    record = store.create(system_spec={"system_name": "test_plant"}, options={"enable_tuning": False}, user_id=1)
    assert record.job_id is not None
    assert record.status == "queued"
    
    # Update record
    updated = store.update(record.job_id, status="completed", message="Done")
    assert updated.status == "completed"
    assert updated.message == "Done"
    
    # Get record
    fetched = store.get(record.job_id)
    assert fetched is not None
    assert fetched.status == "completed"
    
    # List jobs
    jobs = store.list_jobs(user_id=1)
    assert len(jobs) == 1
    assert jobs[0].job_id == record.job_id


def test_mpc_job_store():
    store = InMemoryMPCJobStore()
    record = store.create(dynamics_ref={"plugin_id": "example_pendulum"}, options={"max_iterations": 5}, user_id=2)
    assert record.job_id is not None
    assert record.status == "queued"
    assert record.max_iterations == 5
    
    # Append progress
    store.append_progress(record.job_id, {"kind": "stage_start", "stage": "actor", "text": "Starting actor"})
    fetched = store.get(record.job_id)
    assert len(fetched.progress) == 1
    assert fetched.progress[0]["stage"] == "actor"
    
    # Request cancel
    cancelled = store.request_cancel(record.job_id)
    assert cancelled.cancel_requested is True
    assert store.is_cancel_requested(record.job_id) is True
