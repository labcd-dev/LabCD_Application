"""HTTP adapter for the AgentPlant pipeline (Stages 2-7).

Stage 1 stays in ``plant_model_service``. This module starts the pipeline when
Stage 1 completes and runs each later chat turn through the orchestrator.

Conventions:
- ``status`` keeps its Stage-1 meaning. While the pipeline runs it stays
  ``"complete"`` and ``final_result`` holds the confirmed plant, so the existing
  persistence and artifact code keeps working.
- ``final_result.metadata`` gets the merged Stage 2-7 metadata once the pipeline is done.
- Pipeline position is reported in ``pipeline_stage`` / ``pipeline_status`` /
  ``pipeline_payload``.
"""

from __future__ import annotations

from typing import Any, Optional

from backend_core.AgentPlant.agent import PlantModelAgent
from backend_core.AgentPlant.stages.orchestrator import PlantPipelineOrchestrator, build_final_metadata
from backend_core.AgentPlant.stages.pipeline_types import PipelineTurn, PlantPipelineState
from backend_api.http.schemas.plant_model import (
    PlantModelChatRequest,
    PlantModelChatResponse,
    PlantModelResult,
    PlantModelSessionState,
    PlantModelStep,
    PlantModelWebSearch,
    TokenUsageOut,
)

PAYLOAD_KIND_BY_STAGE = {
    3: "trim",
    4: "constraints",
    5: "control_objective",
    6: "uncertainty",
}


# Stages where the pipeline asks the user a question and a typed reply is a gate answer.
_CHAT_GATE_STAGES = (4, 5, 6)


def message_kinds(
    request: PlantModelChatRequest,
    response: PlantModelChatResponse,
) -> tuple[str | None, str | None]:
    """Display kinds for the user and assistant rows stored for one turn (None = plain chat).

    - A gate click, Confirm System, or a typed answer to an open Stage 4-6 question is a
      ``hitl_selection`` (rendered as a muted trace line, never a bubble).
    - Any reply produced while the pipeline is active is a ``stage_note`` (no action footer).
    """
    stage_before = request.session_state.pipeline_stage if request.session_state else 1
    is_selection = bool(
        request.pipeline_action or request.force_complete or stage_before in _CHAT_GATE_STAGES
    )
    user_kind = "hitl_selection" if is_selection else None
    assistant_kind = "stage_note" if response.pipeline_stage is not None else None
    return user_kind, assistant_kind


def can_start_pipeline(response: PlantModelChatResponse) -> bool:
    """Stage 1 finished with metadata the later stages can use."""
    return (
        response.status == "complete"
        and response.final_result is not None
        and bool(response.final_result.metadata)
    )


def start_pipeline(request: PlantModelChatRequest, stage1: PlantModelChatResponse) -> PlantModelChatResponse:
    final = stage1.final_result
    plant = {
        "system_name": final.system_name,
        "python_code": final.python_code,
        "metadata": dict(final.metadata or {}),
    }
    llm = _new_llm(request)
    state, turn = PlantPipelineOrchestrator(llm).start(plant)
    return _respond(
        prefix=stage1.reply,
        usage_before=stage1.usage,
        session=_session_with_pipeline(stage1.session_state, state),
        final=final,
        state=state,
        turn=turn,
        llm=llm,
    )


def run_pipeline_turn(request: PlantModelChatRequest, state: PlantPipelineState) -> PlantModelChatResponse:
    llm = _new_llm(request)
    user_message = request.user_message.strip()
    state, turn = PlantPipelineOrchestrator(llm).step(
        state,
        user_message,
        request.pipeline_action,
        request.pipeline_edit,
    )
    final = PlantModelResult(
        system_name=state.plant["system_name"],
        python_code=state.plant["python_code"],
        metadata=state.plant["metadata"],
    )
    base = request.session_state or PlantModelSessionState()
    return _respond(
        prefix="",
        usage_before=None,
        session=_session_with_pipeline(base, state),
        final=final,
        state=state,
        turn=turn,
        llm=llm,
    )


def _respond(
    *,
    prefix: str,
    usage_before: Optional[TokenUsageOut],
    session: PlantModelSessionState,
    final: PlantModelResult,
    state: PlantPipelineState,
    turn: PipelineTurn,
    llm: PlantModelAgent,
) -> PlantModelChatResponse:
    if state.status == "done":
        final = PlantModelResult(
            system_name=final.system_name,
            python_code=final.python_code,
            metadata=build_final_metadata(state),
        )
        # Keep the artifact/sidebar metadata in step with the merged result.
        session = session.model_copy(update={"latest_draft": final})

    payload = _payload_for(state)
    # Stored so a reloaded conversation can redraw the current gate without re-deriving it.
    session = session.model_copy(
        update={"pipeline_context": {**session.pipeline_context, "payload": payload}}
    )
    return PlantModelChatResponse(
        reply=_join_replies(prefix, turn.reply),
        status="complete",
        final_result=final,
        session_state=session,
        usage=_sum_usage(usage_before, llm),
        steps=[PlantModelStep(kind="pipeline", label=label, ok=True) for label in turn.steps],
        rag_chunks=[],
        web_search=PlantModelWebSearch(status="empty"),
        pipeline_stage=state.stage,
        pipeline_status=state.status,
        pipeline_payload=payload,
    )


def _session_with_pipeline(
    session: Optional[PlantModelSessionState],
    state: PlantPipelineState,
) -> PlantModelSessionState:
    base = session or PlantModelSessionState()
    return base.model_copy(
        update={"pipeline_stage": state.stage, "pipeline_context": state.to_context()}
    )


def _payload_for(state: PlantPipelineState) -> dict[str, Any]:
    if state.status == "done":
        return {"stage": 7, "kind": "routing", "routing": state.data["routing"]}
    return {
        "stage": state.stage,
        "kind": PAYLOAD_KIND_BY_STAGE[state.stage],
        "proposal": state.proposal,
    }


def _new_llm(request: PlantModelChatRequest) -> PlantModelAgent:
    return PlantModelAgent(model=request.model)


def _sum_usage(before: Optional[TokenUsageOut], llm: PlantModelAgent) -> TokenUsageOut:
    totals = llm.total_usage
    return TokenUsageOut(
        input_tokens=(before.input_tokens if before else 0) + totals.input_tokens,
        output_tokens=(before.output_tokens if before else 0) + totals.output_tokens,
        estimated_cost=(before.estimated_cost if before else 0.0) + llm.total_cost,
    )


def _join_replies(prefix: str, text: str) -> str:
    return "\n\n".join(part for part in (prefix, text) if part)
