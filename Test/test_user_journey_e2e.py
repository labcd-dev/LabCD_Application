"""E2E: admin user-journey API aggregates timeline steps and final comments."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend_api.db.base import Base
from backend_api.db.models import (
    AnalyticsEvent,
    ErrorEvent,
    FeedbackSurveyResponse,
    LoginHistory,
    Project,
    User,
)
from backend_api.db.session import get_db
from backend_api.http.config import API_PREFIX
from backend_api.http.routers import admin
from backend_api.http.services import session_service
from backend_api.http.services.auth_service import (
    ADMIN_EMAIL,
    create_access_token,
    create_user,
    get_user_by_email,
    seed_auth_data,
)


@pytest.fixture()
def journey_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(admin.router, prefix=API_PREFIX)
    app.dependency_overrides[get_db] = override_get_db

    db = SessionLocal()
    try:
        seed_auth_data(db)
        admin_user = get_user_by_email(db, ADMIN_EMAIL)
        assert admin_user is not None
        assert admin_user.has_action("admin:users")

        t0 = datetime(2026, 8, 12, 10, 0, 0, tzinfo=timezone.utc)
        target = create_user(
            db,
            email="journey.user@example.com",
            password="JourneyUser1!",
            email_verified=True,
            assign_default_plan=False,
            assign_default_role=True,
            display_name="Journey User",
        )
        target.created_at = t0
        target.profile_survey_completed_at = t0 + timedelta(hours=1)
        db.add(target)
        db.commit()
        db.refresh(target)

        db.add(
            LoginHistory(
                user_id=target.id,
                email=target.email,
                success=True,
                ip_address="127.0.0.1",
                created_at=t0 + timedelta(hours=2),
            )
        )
        db.add(
            AnalyticsEvent(
                user_id=target.id,
                event_type="module",
                module="silo",
                created_at=t0 + timedelta(hours=3),
            )
        )
        project = Project(
            user_id=target.id,
            title="DC motor · SILO",
            pipeline_type="siloDesign",
            status="completed",
            file_name="motor.py",
            results={
                "score": 78,
                "success": True,
                "design_grade": {
                    "rating": 4,
                    "comment": "Clarifying questions helped; numerical warning was unclear.",
                    "created_at": (t0 + timedelta(hours=5)).isoformat().replace("+00:00", "Z"),
                },
            },
            created_at=t0 + timedelta(hours=3, minutes=5),
            updated_at=t0 + timedelta(hours=5),
        )
        db.add(project)
        db.add(
            FeedbackSurveyResponse(
                user_id=target.id,
                pipeline_type="siloDesign",
                satisfaction=4,
                ease_of_use=4,
                product_value=5,
                confidence=4,
                reuse_intention=5,
                willingness_to_pay=3,
                main_problems="Wish the docs covered saturation limits earlier.",
                created_at=t0 + timedelta(hours=6),
            )
        )
        db.add(
            ErrorEvent(
                source="frontend",
                message="Numerical warning on first SILO pass",
                user_id=target.id,
                created_at=t0 + timedelta(hours=4),
            )
        )
        db.commit()

        admin_session = session_service.create_session(
            db, user_id=admin_user.id, ip_address="127.0.0.1", user_agent="test"
        )
        admin_token = create_access_token(
            admin_user.id, admin_user.email, jti=admin_session.jti
        )

        regular = create_user(
            db,
            email="regular.user@example.com",
            password="RegularUser1!",
            email_verified=True,
            assign_default_plan=False,
            assign_default_role=True,
        )
        regular_session = session_service.create_session(
            db, user_id=regular.id, ip_address="127.0.0.1", user_agent="test"
        )
        regular_token = create_access_token(
            regular.id, regular.email, jti=regular_session.jti
        )
        target_id = target.id
    finally:
        db.close()

    with TestClient(app) as client:
        yield {
            "client": client,
            "admin_token": admin_token,
            "regular_token": regular_token,
            "target_id": target_id,
        }

    app.dependency_overrides.clear()
    engine.dispose()


def test_journey_requires_auth(journey_client):
    client = journey_client["client"]
    target_id = journey_client["target_id"]
    res = client.get(f"{API_PREFIX}/admin/users/{target_id}/journey")
    assert res.status_code == 401


def test_journey_forbidden_for_non_admin(journey_client):
    client = journey_client["client"]
    target_id = journey_client["target_id"]
    res = client.get(
        f"{API_PREFIX}/admin/users/{target_id}/journey",
        headers={"Authorization": f"Bearer {journey_client['regular_token']}"},
    )
    assert res.status_code == 403


def test_journey_complete_timeline_and_comments(journey_client):
    client = journey_client["client"]
    target_id = journey_client["target_id"]
    res = client.get(
        f"{API_PREFIX}/admin/users/{target_id}/journey",
        headers={"Authorization": f"Bearer {journey_client['admin_token']}"},
    )
    assert res.status_code == 200
    body = res.json()

    assert body["user"]["email"] == "journey.user@example.com"
    steps = body["steps"]
    assert steps, "expected journey steps"
    timestamps = [s["timestamp"] for s in steps]
    assert timestamps == sorted(timestamps)

    kinds = [s["kind"] for s in steps]
    assert "registered" in kinds
    assert "profile_survey" in kinds
    assert "login" in kinds
    assert "module" in kinds
    assert "project" in kinds
    assert "error" in kinds
    assert "feedback" in kinds

    # Coarse order: signup before login before module/project before feedback
    idx = {kind: kinds.index(kind) for kind in ("registered", "login", "module", "feedback")}
    assert idx["registered"] < idx["login"] < idx["module"] < idx["feedback"]

    comments = body["comments"]
    texts = [c["text"] for c in comments]
    assert any("Clarifying questions helped" in t for t in texts)
    assert any("saturation limits" in t for t in texts)

    comment_ts = [c["timestamp"] for c in comments]
    assert comment_ts == sorted(comment_ts, reverse=True)

    dossier = body["dossier"]
    assert dossier["health"] in {"good", "at_risk", "new"}
    assert "survey complete" in dossier["tags"]
    assert "activated" in dossier["tags"]
    kpis = dossier["kpis"]
    assert kpis["sessions"] == 1
    assert kpis["sessions_completed"] == 1
    assert kpis["success_rate"] == 100.0
    assert kpis["avg_score"] == 78.0
    assert kpis["error_count"] == 1
    assert dossier["persona"] is not None
    assert "label" in dossier["persona"]
    assert dossier["profile"] is not None
    assert len(dossier["recent_sessions"]) == 1
    assert dossier["recent_sessions"][0]["title"] == "DC motor · SILO"
    assert dossier["latest_project_id"] is not None
    mix_names = {m["pipeline_type"] for m in dossier["pipeline_mix"]}
    assert "siloDesign" in mix_names
    silo = next(m for m in dossier["pipeline_mix"] if m["pipeline_type"] == "siloDesign")
    assert silo["count"] == 1
    assert dossier["flags"]["email_verified"] is True
    assert dossier["flags"]["profile_survey_complete"] is True
    assert dossier["usage"]["avg_rating"] == 4.0
    assert isinstance(dossier["actions"], list) and len(dossier["actions"]) >= 1


def test_journey_not_found(journey_client):
    client = journey_client["client"]
    res = client.get(
        f"{API_PREFIX}/admin/users/999999/journey",
        headers={"Authorization": f"Bearer {journey_client['admin_token']}"},
    )
    assert res.status_code == 404
