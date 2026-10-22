"""Tests for the AgentPlant seven-stage pipeline (Stages 2-7).

The LLM is replaced by a scripted fake that answers each stage based on the
marker in its system prompt, so no network or API key is needed.
"""

from __future__ import annotations

import copy
import os
from types import SimpleNamespace

import pytest

from backend_core.AgentPlant.stages import stage2_analysis, stage3_trim, stage4_constraints
from backend_core.AgentPlant.stages import stage5_objective, stage6_uncertainty, stage7_routing
from backend_core.AgentPlant.stages.common import load_prompt
from backend_core.AgentPlant.stages.orchestrator import PlantPipelineOrchestrator, build_final_metadata
from backend_core.AgentPlant.stages.pipeline_types import PlantPipelineState

# ---------------------------------------------------------------- fixtures

STAGE1_METADATA = {
    "inputs": ["V"],
    "states": ["theta", "omega"],
    "outputs": ["theta"],
    "parameters": {"J": 0.01, "K": 0.1, "L": 0.5, "R": 1, "b": 0.1},
    "assumptions": ["Continuous-time state-space dynamics"],
    "system_type": "SISO",
    "state_meanings": ["angular position (rad)", "angular velocity (rad/s)"],
    "state_equations": ["omega", "(K * V - b * omega) / J"],
    "complexity": 1,
}

DC_PLANT = {
    "system_name": "Simple DC Motor",
    "python_code": "def dynamics(t, x, u):\n    return x\n",
    "metadata": STAGE1_METADATA,
}


class FakeLLM:
    """Answers each pipeline stage based on a marker in its system prompt.

    Tests can override any stage's reply by setting ``overrides[marker] = text``
    or by setting ``objective`` / ``clarifier_replies`` to change defaults.
    """

    def __init__(self):
        self.calls: list[str] = []
        self.objective = "Track a step reference for theta with settling time under 500 ms."
        self.clarifier_replies: list[str] = []  # queue of raw JSON strings
        self.constraints_replies: list[str] = []
        self.overrides: dict[str, str] = {}
        self.total_usage = SimpleNamespace(input_tokens=0, output_tokens=0)
        self.total_cost = 0.0

    def invoke_llm(self, system_prompt, user_prompt):
        if "control objective" in system_prompt:
            self.calls.append("objective")
            text = self.overrides.get("objective") or f'{{"control_objective": "{self.objective}"}}'
        elif "constraints interviewer" in system_prompt:
            self.calls.append("constraints")
            text = self.constraints_replies.pop(0) if self.constraints_replies else (
                '{"status": "complete", "reply": "No limits.", "state_bounds": null, "input_bounds": null}'
            )
        elif "uncertainty/disturbance analyst" in system_prompt:
            self.calls.append("clarifier")
            text = self.clarifier_replies.pop(0) if self.clarifier_replies else (
                '{"status": "continue", "reply": "Does anything else act on the plant?"}'
            )
        else:
            raise AssertionError("unexpected system prompt")
        return text, {}


def orchestrator_with(llm=None):
    llm = llm or FakeLLM()
    return PlantPipelineOrchestrator(llm), llm


def started(llm=None):
    orch, llm = orchestrator_with(llm)
    state, turn = orch.start(copy.deepcopy(DC_PLANT))
    return orch, llm, state, turn


CLARIFIER_COMPLETE_NONE = (
    '{"status": "complete", "reply": "Recorded: no uncertainty.", '
    '"dynamics": {"uncertainty": [], "disturbance": [], "references": [{"output": "r", "expr": "sin(t)"}]}}'
)
CLARIFIER_COMPLETE_OMEGA = (
    '{"status": "complete", "reply": "Recorded friction on omega.", '
    '"dynamics": {"uncertainty": [{"state": "omega", "expr": ""}], "disturbance": []}}'
)


def walk_to_stage6(llm=None):
    """Advance through 3, 4 (unbounded), 5 (draft accepted) and land on the Stage 6 gate."""
    orch, llm, state, _ = started(llm)
    state, _ = orch.step(state, "", "confirm", None)  # accept trim
    state, _ = orch.step(state, "", "confirm", None)  # accept unbounded
    state, _ = orch.step(state, "", "confirm", None)  # accept objective
    assert state.stage == 6
    return orch, llm, state


# ------------------------------------------------------------ prompt wiring

@pytest.mark.parametrize(
    "file_name, key",
    [
        ("stage4_constraints", "system_prompt"),
        ("stage4_constraints", "user_prompt_template"),
        ("stage5_objective", "system_prompt"),
        ("stage5_objective", "user_prompt_template"),
        ("stage6_uncertainty_clarifier", "system_prompt"),
        ("stage6_uncertainty_clarifier", "user_prompt_template"),
        ("stage7_routing", "system_prompt"),
        ("stage7_routing", "user_prompt_template"),
    ],
)
def test_every_stage_prompt_loads_through_prompt_library(file_name, key):
    assert load_prompt(file_name, key).strip()


def test_stage6_clone_has_no_references_handling():
    text = load_prompt("stage6_uncertainty_clarifier", "system_prompt").lower()
    for banned in ("references", "reference signal", "normaliz", "sympy"):
        assert banned not in text


def test_stage6_clone_keeps_the_clarifier_contract():
    text = load_prompt("stage6_uncertainty_clarifier", "system_prompt")
    assert '"status": "continue"' in text and '"status": "complete"' in text
    assert "uncertainty" in text and "disturbance" in text


# -------------------------------------------------------------- stage 2 + 3

def test_start_runs_stage2_and_opens_trim_gate_sized_from_metadata():
    _, _, state, turn = started()
    assert state.stage == 3 and state.status == "awaiting_hitl"
    assert state.data["analysis"]["actuation"] == "fullyactuated"
    assert "[MOCK]" in state.data["analysis"]["notes"]
    assert state.proposal["x0"] == [0.0, 0.0]
    assert state.proposal["u_ff"] == [0.0]
    assert "[MOCK]" in state.proposal["source"]
    assert turn.reply.startswith(stage2_analysis.TRACE_NOTE)


def test_trim_edit_keeps_gate_open_and_marks_source_as_user():
    orch, _, state, _ = started()
    state, turn = orch.step(state, "", "edit", {"x0": [0.5, -1.0]})
    assert state.stage == 3 and state.proposal["x0"] == [0.5, -1.0]
    assert state.proposal["source"] == stage3_trim.USER_SOURCE
    assert "Accept" in turn.reply


def test_trim_confirm_with_edit_uses_user_values_and_advances_to_constraints():
    orch, _, state, _ = started()
    state, _ = orch.step(state, "", "confirm", {"u_ff": [2.5]})
    assert state.stage == 4
    assert state.data["trim"]["u_ff"] == [2.5]
    assert state.data["trim"]["source"] == stage3_trim.USER_SOURCE


def test_trim_rejects_wrong_length_and_nonfinite_values():
    orch, _, state, _ = started()
    with pytest.raises(ValueError, match="x0 must be a list of 2"):
        orch.step(state, "", "edit", {"x0": [1.0]})
    with pytest.raises(ValueError, match="non-finite"):
        orch.step(state, "", "edit", {"x0": [float("inf"), 0.0]})
    assert state.stage == 3 and state.proposal["x0"] == [0.0, 0.0]


def test_trim_gate_ignores_a_plain_message_and_does_not_advance():
    orch, _, state, _ = started()
    state, turn = orch.step(state, "what is trim?", None, None)
    assert state.stage == 3
    assert "Accept or edit" in turn.reply


def test_trim_mock_helper_matches_metadata_dimensions():
    proposal = stage3_trim.propose_trim({"states": ["a", "b", "c"], "inputs": ["u1", "u2"]})
    assert proposal["x0"] == [0.0, 0.0, 0.0]
    assert proposal["u_ff"] == [0.0, 0.0]


# -------------------------------------------------------------- stage 4

def test_unbounded_constraints_are_the_mock_default():
    orch, _, state, _ = started()
    state, _ = orch.step(state, "", "confirm", None)
    assert state.stage == 4
    assert state.proposal == {
        "bounded": False,
        "state_bounds": None,
        "input_bounds": None,
        "notes": stage4_constraints.MOCK_NOTE,
    }


def test_partial_bounds_leave_unspecified_sides_null_and_mark_bounded():
    orch, _, state, _ = started()
    state, _ = orch.step(state, "", "confirm", None)  # to stage 4
    state, _ = orch.step(state, "", "edit", {"state_bounds": [[-1.0, 1.0], [None, None]]})
    assert state.proposal["bounded"] is True
    assert state.proposal["state_bounds"] == [[-1.0, 1.0], [None, None]]
    assert state.proposal["input_bounds"] is None


@pytest.mark.parametrize(
    "edit, message",
    [
        ({"state_bounds": [[0.0, 1.0]]}, "state_bounds must have 2"),
        ({"state_bounds": [[5.0, 1.0], [None, None]]}, "lower bound 5.0 is above upper bound 1.0"),
        ({"input_bounds": [["a", 1.0]]}, "input_bounds must have 1|non-numeric"),
    ],
)
def test_constraint_edits_reject_contradictions_and_bad_shapes(edit, message):
    orch, _, state, _ = started()
    state, _ = orch.step(state, "", "confirm", None)
    with pytest.raises(ValueError, match=message):
        orch.step(state, "", "edit", edit)


def test_constraints_chat_completes_with_bounds_but_waits_for_confirm():
    llm = FakeLLM()
    llm.constraints_replies = [
        '{"status": "complete", "reply": "Got it: theta in [-1, 1].", '
        '"state_bounds": [[-1, 1], [null, null]], "input_bounds": null}'
    ]
    orch, _, state, _ = started(llm)
    state, _ = orch.step(state, "", "confirm", None)
    state, turn = orch.step(state, "theta must stay within plus minus one", None, None)
    assert state.stage == 4
    assert state.proposal["state_bounds"] == [[-1.0, 1.0], [None, None]]
    assert turn.reply == "Got it: theta in [-1, 1]."
    assert state.dialogue[-1]["role"] == "assistant"


def test_constraints_chat_contradiction_is_reported_and_proposal_unchanged():
    llm = FakeLLM()
    llm.constraints_replies = [
        '{"status": "complete", "reply": "ok", "state_bounds": [[3, 1], [null, null]], "input_bounds": null}'
    ]
    orch, _, state, _ = started(llm)
    state, _ = orch.step(state, "", "confirm", None)
    before = copy.deepcopy(state.proposal)
    state, turn = orch.step(state, "limits?", None, None)
    assert state.proposal == before
    assert "Those bounds don't work" in turn.reply


def test_constraints_chat_with_unparseable_reply_asks_again():
    llm = FakeLLM()
    llm.constraints_replies = ["this is not json"]
    orch, _, state, _ = started(llm)
    state, _ = orch.step(state, "", "confirm", None)
    state, turn = orch.step(state, "hmm", None, None)
    assert state.stage == 4 and "didn't catch that" in turn.reply


def test_check_bounds_accepts_none_and_rejects_non_pairs():
    assert stage4_constraints.check_bounds(None, 2, "state_bounds") is None
    with pytest.raises(ValueError, match=r"\[lower, upper\]"):
        stage4_constraints.check_bounds([[1.0, 2.0, 3.0], [0, 1]], 2, "state_bounds")


# -------------------------------------------------------------- stage 5

def test_stage5_drafts_objective_from_llm_on_entry():
    orch, llm, state, _ = started()
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    assert state.stage == 5 and state.status == "awaiting_hitl"
    assert state.proposal["control_objective"].startswith("Track a step reference")
    assert llm.calls == ["objective"]


def test_stage5_edit_then_confirm_stores_the_edited_text():
    orch, _, state, _ = started()
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(
        state, "", "confirm",
        {"control_objective": "Track a step reference with settling time under 500 ms."},
    )
    assert state.stage == 6
    assert state.data["control_objective"].endswith("under 500 ms.")


def test_stage5_empty_objective_is_rejected():
    orch, _, state, _ = started()
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    with pytest.raises(ValueError, match="can't be empty"):
        orch.step(state, "", "edit", {"control_objective": "   "})


def test_stage5_revision_message_calls_llm_with_current_text_and_request():
    llm = FakeLLM()
    orch, _, state, _ = started(llm)
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    llm.objective = "Hold theta at zero with a settling time under 1 s."
    state, turn = orch.step(state, "make it faster", None, None)
    assert state.proposal["control_objective"].startswith("Hold theta")
    assert "revised" in turn.reply


def test_stage5_unusable_llm_reply_keeps_current_draft():
    llm = FakeLLM()
    orch, _, state, _ = started(llm)
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    llm.overrides["objective"] = "not json at all"
    before = state.proposal["control_objective"]
    state, turn = orch.step(state, "make it faster", None, None)
    assert state.proposal["control_objective"] == before
    assert "couldn't revise" in turn.reply


# -------------------------------------------------------------- stage 6

def test_stage6_opens_with_first_clarifier_question():
    _, llm, state = walk_to_stage6()
    assert state.proposal["ready"] is False
    assert state.proposal["question"] == "Does anything else act on the plant?"
    assert llm.calls[-1] == "clarifier"


def test_stage6_confirm_before_answering_is_refused():
    orch, _, state = walk_to_stage6()
    state, turn = orch.step(state, "", "confirm", None)
    assert state.stage == 6
    assert turn.reply == "Answer my question first, then confirm."


def test_stage6_complete_strips_references_and_keeps_only_two_lists():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = [CLARIFIER_COMPLETE_NONE]
    state, turn = orch.step(state, "no, nothing else", None, None)
    assert state.proposal["ready"] is True
    assert "references" not in state.proposal
    assert state.proposal["uncertainty"] == [] and state.proposal["disturbance"] == []


def test_stage6_uncertainty_on_unknown_state_asks_again_instead_of_completing():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = [
        '{"status": "complete", "reply": "x", "dynamics": '
        '{"uncertainty": [{"state": "x9", "expr": ""}], "disturbance": []}}'
    ]
    state, turn = orch.step(state, "yes friction", None, None)
    assert state.proposal["ready"] is False
    assert "theta, omega" in turn.reply


def test_stage6_confirm_routes_to_stage7_and_finishes_pipeline():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = [CLARIFIER_COMPLETE_OMEGA]
    state, _ = orch.step(state, "friction could be off by 20%", None, None)
    state, turn = orch.step(state, "", "confirm", None)
    assert state.status == "done" and state.stage == 7
    assert state.data["uncertainty"] == [{"state": "omega", "expr": ""}]
    assert state.data["routing"]["mpc_applicable"] is True
    assert "routing" in state.data


def test_stage6_edit_validates_state_names():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = [CLARIFIER_COMPLETE_NONE]
    state, _ = orch.step(state, "none", None, None)
    with pytest.raises(ValueError, match="does not exist"):
        orch.step(state, "", "edit", {"disturbance": [{"state": "nope", "expr": "1"}]})


def test_stage6_unparseable_reply_falls_back_to_a_question():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = ["not json"]
    state, turn = orch.step(state, "hmm", None, None)
    assert state.proposal["ready"] is False
    assert "unmodelled" in turn.reply


# -------------------------------------------------------------- stage 7 + merge

def test_stage7_mock_routing_shape_is_extensible():
    routing = stage7_routing.route_plant({}, {})
    assert set(routing["applicable"]) == {"mpc", "adaptive", "silo", "mulo", "pid_tuner", "lqr"}
    assert routing["applicable"]["pid_tuner"] is None  # not evaluated, not a guessed boolean
    assert routing["mpc_applicable"] is True and routing["adaptive_applicable"] is True
    assert "[MOCK]" in routing["rationale"]


def test_full_pipeline_merges_metadata_without_touching_stage1_keys():
    orch, llm = orchestrator_with()
    state, _ = orch.start(copy.deepcopy(DC_PLANT))
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    state, _ = orch.step(state, "", "confirm", None)
    llm.clarifier_replies = [CLARIFIER_COMPLETE_NONE]
    state, _ = orch.step(state, "no other effects", None, None)
    state, _ = orch.step(state, "", "confirm", None)
    meta = build_final_metadata(state)

    for key in ("control_objective", "uncertainty", "disturbance", "mpc_applicable", "adaptive_applicable"):
        assert key in meta
    for key in ("analysis", "trim", "constraints", "routing"):
        assert key in meta
    for key, value in STAGE1_METADATA.items():
        assert meta[key] == value, f"Stage-1 key {key} was altered"
    assert meta["complexity"] == 1
    assert "references" not in str(meta.get("uncertainty"))


def test_pipeline_state_round_trips_through_session_context():
    orch, _, state, _ = started()
    restored = PlantPipelineState.from_session(state.stage, state.to_context())
    assert restored.stage == 3 and restored.proposal == state.proposal
    assert restored.plant == state.plant and restored.in_progress


def test_step_after_done_is_rejected():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = [CLARIFIER_COMPLETE_NONE]
    state, _ = orch.step(state, "none", None, None)
    state, _ = orch.step(state, "", "confirm", None)
    assert state.status == "done"
    with pytest.raises(ValueError, match="No pipeline stage"):
        orch.step(state, "again", None, None)


def test_stage7_mock_does_not_call_llm():
    orch, llm, state = walk_to_stage6()
    llm.clarifier_replies = [CLARIFIER_COMPLETE_NONE]
    state, _ = orch.step(state, "none", None, None)
    calls_before = list(llm.calls)
    orch.step(state, "", "confirm", None)
    assert llm.calls == calls_before  # routing added no LLM calls


# ------------------------------------------------------- service / HTTP layer

@pytest.fixture
def fake_llm_service(monkeypatch):
    """Route every pipeline LLM call in the service layer to one FakeLLM."""
    from backend_api.http.services import plant_pipeline_service

    llm = FakeLLM()
    monkeypatch.setattr(plant_pipeline_service, "PlantModelAgent", lambda model: llm)
    return llm


@pytest.fixture
def stage1_complete(monkeypatch):
    """Make Stage 1 return a completed DC motor plant without any LLM call."""
    from backend_api.http.schemas.plant_model import PlantModelChatResponse, PlantModelResult, PlantModelSessionState
    from backend_api.http.services import plant_model_service

    def fake_stage1(request):
        return PlantModelChatResponse(
            reply="Model ready — **Simple DC Motor**.",
            status="complete",
            final_result=PlantModelResult(
                system_name=DC_PLANT["system_name"],
                python_code=DC_PLANT["python_code"],
                metadata=copy.deepcopy(STAGE1_METADATA),
            ),
            session_state=PlantModelSessionState(draft_count=1),
        )

    monkeypatch.setattr(plant_model_service, "_run_stage1_chat", fake_stage1)
    return fake_stage1


def _chat(**kwargs):
    from backend_api.http.schemas.plant_model import PlantModelChatRequest
    from backend_api.http.services.plant_model_service import run_plant_model_chat

    return run_plant_model_chat(PlantModelChatRequest(**kwargs))


def test_stage1_completion_starts_pipeline_and_returns_trim_gate(fake_llm_service, stage1_complete):
    resp = _chat(user_message="finish")
    assert resp.status == "complete"  # Stage-1 meaning preserved
    assert resp.pipeline_stage == 3 and resp.pipeline_status == "awaiting_hitl"
    assert resp.pipeline_payload["kind"] == "trim"
    assert resp.pipeline_payload["proposal"]["x0"] == [0.0, 0.0]
    assert resp.session_state.pipeline_stage == 3
    assert resp.final_result.metadata == STAGE1_METADATA  # not merged until done


def test_pipeline_turns_never_call_stage1_again(fake_llm_service, stage1_complete, monkeypatch):
    from backend_api.http.services import plant_model_service

    first = _chat(user_message="finish")

    def must_not_run(request):
        raise AssertionError("Stage 1 must not run while the pipeline is in progress")

    monkeypatch.setattr(plant_model_service, "_run_stage1_chat", must_not_run)
    second = _chat(user_message="", pipeline_action="confirm", session_state=first.session_state)
    assert second.pipeline_stage == 4
    assert second.pipeline_payload["kind"] == "constraints"


def test_full_service_walk_produces_done_result_with_merged_metadata(fake_llm_service, stage1_complete):
    # (fake_llm_service is the FakeLLM shared by every pipeline turn in this test)
    resp = _chat(user_message="finish")
    for _ in range(2):  # accept trim, accept constraints
        resp = _chat(user_message="", pipeline_action="confirm", session_state=resp.session_state)
    assert resp.pipeline_stage == 5 and resp.pipeline_payload["kind"] == "control_objective"

    resp = _chat(user_message="", pipeline_action="confirm", session_state=resp.session_state)  # accept objective
    assert resp.pipeline_stage == 6 and resp.pipeline_payload["kind"] == "uncertainty"

    fake_llm_service.clarifier_replies = [CLARIFIER_COMPLETE_NONE]
    resp = _chat(user_message="no other effects", session_state=resp.session_state)
    resp = _chat(user_message="", pipeline_action="confirm", session_state=resp.session_state)

    assert resp.pipeline_status == "done" and resp.pipeline_stage == 7
    assert resp.pipeline_payload["kind"] == "routing"
    meta = resp.final_result.metadata
    for key in ("control_objective", "uncertainty", "disturbance", "mpc_applicable", "adaptive_applicable"):
        assert key in meta
    assert meta["complexity"] == 1
    # The conversation's artifact/sidebar metadata must match the merged result.
    assert resp.session_state.latest_draft.metadata == meta


def test_edit_action_keeps_gate_open_through_the_service(fake_llm_service, stage1_complete):
    resp = _chat(user_message="finish")
    resp = _chat(user_message="", pipeline_action="edit", pipeline_edit={"x0": [1.0, 0.0]},
                 session_state=resp.session_state)
    assert resp.pipeline_stage == 3
    assert resp.pipeline_payload["proposal"]["x0"] == [1.0, 0.0]


def test_bad_edit_surfaces_as_value_error_for_the_router_to_map_to_400(fake_llm_service, stage1_complete):
    resp = _chat(user_message="finish")
    with pytest.raises(ValueError, match="x0 must be a list"):
        _chat(user_message="", pipeline_action="edit", pipeline_edit={"x0": [1.0, 2.0, 3.0]},
              session_state=resp.session_state)


def test_stage1_continue_turn_leaves_pipeline_idle(monkeypatch):
    from backend_api.http.schemas.plant_model import PlantModelChatResponse, PlantModelSessionState
    from backend_api.http.services import plant_model_service

    def stage1_asks(request):
        return PlantModelChatResponse(
            reply="What system is this?", status="continue", session_state=PlantModelSessionState()
        )

    monkeypatch.setattr(plant_model_service, "_run_stage1_chat", stage1_asks)
    resp = _chat(user_message="a motor")
    assert resp.status == "continue"
    assert resp.pipeline_stage is None and resp.pipeline_payload is None
    assert resp.session_state.pipeline_stage == 1 and resp.session_state.pipeline_context == {}


def test_stage1_complete_without_metadata_skips_pipeline(monkeypatch):
    from backend_api.http.schemas.plant_model import PlantModelChatResponse, PlantModelResult, PlantModelSessionState
    from backend_api.http.services import plant_model_service

    def no_meta(request):
        return PlantModelChatResponse(
            reply="done", status="complete",
            final_result=PlantModelResult(system_name="x", python_code="def dynamics(t,x,u): return x"),
            session_state=PlantModelSessionState(),
        )

    monkeypatch.setattr(plant_model_service, "_run_stage1_chat", no_meta)
    resp = _chat(user_message="finish")
    assert resp.pipeline_stage is None and resp.status == "complete"


def test_session_state_persistence_keeps_pipeline_fields():
    from backend_api.http.schemas.plant_model import PlantModelSessionState
    from backend_api.http.services.plant_model_chat_service import (
        _session_state_from_dict,
        _session_state_to_dict,
    )

    original = PlantModelSessionState(
        draft_count=2,
        pipeline_stage=5,
        pipeline_context={"status": "awaiting_hitl", "proposal": {"control_objective": "x"}},
    )
    restored = _session_state_from_dict(_session_state_to_dict(original))
    assert restored.pipeline_stage == 5
    assert restored.pipeline_context["proposal"] == {"control_objective": "x"}


def test_old_session_dicts_without_pipeline_fields_still_load():
    from backend_api.http.services.plant_model_chat_service import _session_state_from_dict

    restored = _session_state_from_dict({"draft_count": 1, "latest_draft": None})
    assert restored.pipeline_stage == 1 and restored.pipeline_context == {}


def test_plain_stage1_response_serializes_without_pipeline_fields():
    from backend_api.http.schemas.plant_model import PlantModelChatResponse, PlantModelSessionState

    payload = PlantModelChatResponse(
        reply="hi", status="continue", session_state=PlantModelSessionState()
    ).model_dump()
    assert payload["pipeline_stage"] is None and payload["pipeline_status"] is None


def test_plant_model_service_uses_the_canonical_agent():
    from backend_api.http.services import plant_model_service

    assert plant_model_service.PlantModelAgent.__module__ == "backend_core.AgentPlant.agent"


def test_canonical_agent_constructs_from_its_module_root_prompts(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    from backend_core.AgentPlant.agent import PlantModelAgent

    agent = PlantModelAgent(model="gpt-4o-mini")
    assert agent._system_prompt.strip()
    assert agent.reset_conversation_state() is None


def test_canonical_agent_sandbox_repair_returns_a_draft_never_complete(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    from backend_core.AgentPlant.agent import PlantModelAgent

    agent = PlantModelAgent(model="gpt-4o-mini")
    fixed_code = "import numpy as np\n\ndef dynamics(t, x, u):\n    return np.zeros_like(x)\n"
    replies = iter([
        '{"status": "complete", "reply": "fixed", "system_name": "Fixed", "python_code": %s}'
        % __import__("json").dumps(fixed_code),
        '{"states": ["x"]}',  # metadata call: any reply; the agent falls back deterministically
    ])
    agent.invoke_llm = lambda system_prompt, user_prompt: (next(replies), {})

    reply, draft = agent.repair_dynamics_from_sandbox(
        system_name="Broken", python_code="def dynamics(t, x, u):\n    return x\n", sandbox_error="NameError"
    )
    assert draft is not None and draft["python_code"] == fixed_code
    assert agent._draft_count == 1
    assert "fixed" in reply or draft["system_name"] == "Fixed"


def test_session_context_carries_current_gate_payload_for_reload(fake_llm_service, stage1_complete):
    resp = _chat(user_message="finish")
    stored = resp.session_state.pipeline_context
    assert stored["payload"] == resp.pipeline_payload
    assert stored["payload"]["kind"] == "trim"
