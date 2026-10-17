"""Display kinds for stored plant-model messages, and their schema migration."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, text

from backend_api.http.schemas.plant_model import (
    MESSAGE_KINDS,
    ChatMessage,
    PlantModelChatRequest,
    PlantModelChatResponse,
    PlantModelSessionState,
)
from backend_api.http.services.plant_pipeline_service import message_kinds


def _req(stage: int = 1, **kwargs):
    return PlantModelChatRequest(
        user_message=kwargs.pop("user_message", "hi"),
        session_state=PlantModelSessionState(pipeline_stage=stage),
        **kwargs,
    )


def _resp(pipeline_stage: int | None = None) -> PlantModelChatResponse:
    return PlantModelChatResponse(
        reply="r", status="continue", session_state=PlantModelSessionState(), pipeline_stage=pipeline_stage
    )


@pytest.mark.parametrize(
    "request_kwargs, stage, response_stage, expected",
    [
        # Plain Stage 1 chat: no kind on either row.
        ({}, 1, None, (None, None)),
        # Stage 1 reply that is not part of the pipeline stays a chat bubble.
        ({"user_message": "make it stiffer"}, 1, None, (None, None)),
        # Gate click (accept / edit): the user row is a selection.
        ({"pipeline_action": "confirm", "user_message": "Accepted trim point"}, 3, 4,
         ("hitl_selection", "stage_note")),
        ({"pipeline_action": "edit", "pipeline_edit": {"x0": [1, 0]}}, 3, 3,
         ("hitl_selection", "stage_note")),
        # Confirm System starts the pipeline: selection in, stage line out.
        ({"force_complete": True, "user_message": "Confirmed system — X"}, 1, 3,
         ("hitl_selection", "stage_note")),
        # Typed answer to an open Stage 4, 5, or 6 question is a selection.
        ({"user_message": "no"}, 6, 6, ("hitl_selection", "stage_note")),
        ({"user_message": "no"}, 4, 4, ("hitl_selection", "stage_note")),
        ({"user_message": "make it faster"}, 5, 5, ("hitl_selection", "stage_note")),
        # Typed text at Stage 3 is not a gate answer: it gets a plain chat row.
        ({"user_message": "what is trim?"}, 3, 3, (None, "stage_note")),
        # After the pipeline finished, a new message is plain Stage 1 chat again.
        ({"user_message": "new plant"}, 7, None, (None, None)),
        # The Stage 7 routing line is a stage note (no action footer).
        ({"pipeline_action": "confirm"}, 6, 7, ("hitl_selection", "stage_note")),
    ],
)
def test_message_kinds_rules(request_kwargs, stage, response_stage, expected):
    assert message_kinds(_req(stage, **request_kwargs), _resp(response_stage)) == expected


def test_message_kinds_without_session_state_is_plain_chat():
    request = PlantModelChatRequest(user_message="hi")
    assert message_kinds(request, _resp(None)) == (None, None)


def test_chat_message_accepts_only_known_kinds():
    assert set(MESSAGE_KINDS) == {"stage_note", "hitl_selection"}
    assert ChatMessage(role="assistant", content="x", kind="stage_note").kind == "stage_note"
    assert ChatMessage(role="user", content="x").kind is None
    with pytest.raises(ValidationError):
        ChatMessage(role="user", content="x", kind="bogus")


def test_migration_adds_kind_to_an_existing_table_and_is_idempotent(monkeypatch):
    from backend_api.db import session as db_session

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        # An older deployment: the table exists without the kind column.
        conn.execute(text(
            "CREATE TABLE plant_model_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, "
            "role VARCHAR(20), content TEXT, created_at TIMESTAMP)"
        ))
    monkeypatch.setattr(db_session, "engine", engine)

    db_session._migrate_plant_model_messages()
    db_session._migrate_plant_model_messages()  # second run must be a no-op

    columns = {c["name"] for c in inspect(engine).get_columns("plant_model_messages")}
    assert "kind" in columns


def test_migration_skips_when_the_table_is_missing(monkeypatch):
    from backend_api.db import session as db_session

    engine = create_engine("sqlite:///:memory:")
    monkeypatch.setattr(db_session, "engine", engine)
    db_session._migrate_plant_model_messages()  # no table yet: nothing to alter
    assert "plant_model_messages" not in inspect(engine).get_table_names()
