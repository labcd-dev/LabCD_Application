"""PlantPipelineOrchestrator: drives Stages 2-7 once Stage 1 completes.

Stage 1 (the chat that produces the plant) is NOT handled here. It stays in
``run_plant_model_chat`` so the live path is not duplicated.

Each HITL gate takes ``action``:
- ``"edit"``: apply ``edit`` to the proposal and keep the gate open.
- ``"confirm"``: accept the proposal (with ``edit`` applied first, if given) and advance.
Stages 4, 5 and 6 also accept plain ``user_message`` turns through the LLM.
"""

from __future__ import annotations

from typing import Any, Optional

from backend_core.AgentPlant.stages import stage2_analysis as s2
from backend_core.AgentPlant.stages import stage3_trim as s3
from backend_core.AgentPlant.stages import stage4_constraints as s4
from backend_core.AgentPlant.stages import stage5_objective as s5
from backend_core.AgentPlant.stages import stage6_uncertainty as s6
from backend_core.AgentPlant.stages import stage7_routing as s7
from backend_core.AgentPlant.stages.pipeline_types import PipelineTurn, PlantPipelineState

FLAT_KEYS_FROM_ROUTING = ("mpc_applicable", "adaptive_applicable")
STAGE6_CONFIRM_HINT = "Answer my question first, then confirm."


class PlantPipelineOrchestrator:
    """``llm`` is any object with ``invoke_llm(system_prompt=, user_prompt=) -> (text, usage)``."""

    def __init__(self, llm: Any) -> None:
        self._llm = llm

    # ------------------------------------------------------------------ entry
    def start(self, plant: dict[str, Any]) -> tuple[PlantPipelineState, PipelineTurn]:
        """Run Stage 2 automatically, then open the Stage 3 gate."""
        state = PlantPipelineState(stage=2, plant=plant)
        state.data["analysis"] = s2.run_structural_analysis(plant["metadata"])
        return self._enter_stage(state, 3, prefix=s2.TRACE_NOTE, steps=[s2.TRACE_LABEL])

    # ---------------------------------------------------------------- turns
    def step(
        self,
        state: PlantPipelineState,
        user_message: str,
        action: Optional[str],
        edit: Optional[dict[str, Any]],
    ) -> tuple[PlantPipelineState, PipelineTurn]:
        if not state.in_progress:
            raise ValueError("No pipeline stage is waiting for input.")
        edit = edit or {}
        handlers = {3: self._stage3, 4: self._stage4, 5: self._stage5, 6: self._stage6}
        return handlers[state.stage](state, user_message, action, edit)

    # --------------------------------------------------------------- stage 3
    def _stage3(self, state, user_message, action, edit):
        metadata = state.plant["metadata"]
        if action == "edit":
            state.proposal = s3.apply_trim_edit(state.proposal, edit, metadata)
            return state, PipelineTurn(reply="Updated the trim values. Accept when ready.")
        if action == "confirm":
            state.data["trim"] = s3.apply_trim_edit(state.proposal, edit, metadata) if edit else state.proposal
            return self._enter_stage(state, 4, steps=[s3.TRACE_LABEL])
        return state, PipelineTurn(reply="Accept or edit the trim values to continue.")

    # --------------------------------------------------------------- stage 4
    def _stage4(self, state, user_message, action, edit):
        metadata = state.plant["metadata"]
        if action == "edit":
            state.proposal = s4.apply_constraints_edit(state.proposal, edit, metadata)
            return state, PipelineTurn(reply="Updated the bounds. Confirm when ready.")
        if action == "confirm":
            state.data["constraints"] = (
                s4.apply_constraints_edit(state.proposal, edit, metadata) if edit else state.proposal
            )
            return self._enter_stage(state, 5, steps=[s4.TRACE_LABEL])
        if user_message:
            return self._stage4_chat(state, metadata, user_message)
        return state, PipelineTurn(reply="Confirm the bounds, or tell me which limits apply.")

    def _stage4_chat(self, state, metadata, user_message):
        turn = s4.constraints_turn(self._llm, metadata, state.dialogue, user_message)
        state.dialogue += [{"role": "user", "content": user_message}, {"role": "assistant", "content": turn["reply"]}]
        reply = turn["reply"]
        if turn["status"] == "complete" and turn["edit"]:
            try:
                state.proposal = s4.apply_constraints_edit(state.proposal, turn["edit"], metadata)
            except ValueError as exc:
                reply = f"{reply}\n\nThose bounds don't work: {exc}. Please restate them."
        return state, PipelineTurn(reply=reply)

    # --------------------------------------------------------------- stage 5
    def _stage5(self, state, user_message, action, edit):
        if action == "edit":
            state.proposal = {"control_objective": _require_text(edit.get("control_objective"))}
            return state, PipelineTurn(reply="Updated the objective. Accept when ready.")
        if action == "confirm":
            text = _require_text(edit.get("control_objective") or state.proposal.get("control_objective"))
            state.data["control_objective"] = text
            return self._enter_stage(state, 6, steps=[s5.TRACE_LABEL])
        if user_message:
            revised = s5.draft_control_objective(
                self._llm,
                state.plant["metadata"],
                state.data,
                current_text=state.proposal.get("control_objective"),
                revision_request=user_message,
            )
            if revised:
                state.proposal = {"control_objective": revised}
                return state, PipelineTurn(reply="Here's the revised objective. Accept it or edit it.")
            return state, PipelineTurn(reply="I couldn't revise that. Could you rephrase what you want?")
        return state, PipelineTurn(reply="Accept or edit the objective to continue.")

    # --------------------------------------------------------------- stage 6
    def _stage6(self, state, user_message, action, edit):
        metadata = state.plant["metadata"]
        if action == "edit":
            return self._stage6_edit(state, edit, metadata)
        if action == "confirm":
            if not state.proposal.get("ready"):
                return state, PipelineTurn(reply=STAGE6_CONFIRM_HINT)
            state.data["uncertainty"] = state.proposal["uncertainty"]
            state.data["disturbance"] = state.proposal["disturbance"]
            return self._finish_with_routing(state)
        if user_message:
            turn = s6.clarifier_turn(self._llm, metadata, state.dialogue, user_message)
            state.dialogue += [{"role": "user", "content": user_message}, {"role": "assistant", "content": turn["reply"]}]
            state.proposal = _stage6_proposal(turn)
            return state, PipelineTurn(reply=turn["reply"], steps=[s6.TRACE_LABEL])
        return state, PipelineTurn(reply=STAGE6_CONFIRM_HINT)

    def _stage6_edit(self, state, edit, metadata):
        if not state.proposal.get("ready"):
            return state, PipelineTurn(reply=STAGE6_CONFIRM_HINT)
        states = list(metadata.get("states") or [])
        proposal = dict(state.proposal)
        for key in ("uncertainty", "disturbance"):
            if key in edit:
                cleaned = s6.clean_terms(edit[key], states)
                if cleaned is None:
                    raise ValueError(f"{key} names a state that does not exist on this plant")
                proposal[key] = cleaned
        state.proposal = proposal
        return state, PipelineTurn(reply="Updated the uncertainty and disturbance terms. Confirm when ready.")

    def _finish_with_routing(self, state):
        state.data["routing"] = s7.route_plant(state.plant["metadata"], state.data)
        state.stage = 7
        state.status = "done"
        state.proposal = None
        state.dialogue = []
        return state, PipelineTurn(reply="Routing checked. Choose a control module to continue.", steps=[s7.TRACE_LABEL])

    # ----------------------------------------------------------- helpers
    def _enter_stage(self, state, stage, *, prefix="", steps=None):
        """Put ``stage`` on the HITL gate and build its opening proposal."""
        metadata = state.plant["metadata"]
        state.stage = stage
        state.status = "awaiting_hitl"
        state.dialogue = []
        steps = list(steps or [])
        if stage == 3:
            state.proposal = s3.propose_trim(metadata)
            text = "Proposed trim point. Accept it or edit the values."
        elif stage == 4:
            state.proposal = s4.propose_constraints()
            text = "Checked the operating point. Are there any state or input limits I should respect?"
        elif stage == 5:
            draft = s5.draft_control_objective(self._llm, metadata, state.data)
            state.proposal = {"control_objective": draft or ""}
            text = "Drafted the control objective. Accept it or edit it."
            steps.append(s5.TRACE_LABEL)
        else:  # stage 6
            turn = s6.clarifier_turn(self._llm, metadata, [], None)
            state.proposal = _stage6_proposal(turn)
            text = turn["reply"]
            steps.append(s6.TRACE_LABEL)
        return state, PipelineTurn(reply=_join(prefix, text), steps=steps)


def build_final_metadata(state: PlantPipelineState) -> dict[str, Any]:
    """Stage-1 metadata with the Stage 2-7 outputs merged in (no Stage-1 key is overwritten)."""
    data = state.data
    meta = dict(state.plant["metadata"])
    meta["analysis"] = data["analysis"]
    meta["trim"] = data["trim"]
    meta["constraints"] = data["constraints"]
    meta["control_objective"] = data["control_objective"]
    meta["uncertainty"] = data["uncertainty"]
    meta["disturbance"] = data["disturbance"]
    meta["routing"] = data["routing"]
    for key in FLAT_KEYS_FROM_ROUTING:
        meta[key] = data["routing"][key]
    return meta


def _stage6_proposal(turn: dict[str, Any]) -> dict[str, Any]:
    if turn["status"] == "complete":
        return {
            "ready": True,
            "question": None,
            "uncertainty": turn["uncertainty"],
            "disturbance": turn["disturbance"],
            "summary": turn["reply"],
        }
    return {"ready": False, "question": turn["reply"], "uncertainty": [], "disturbance": [], "summary": None}


def _require_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("The control objective can't be empty.")
    return text


def _join(prefix: str, text: str) -> str:
    return f"{prefix}\n\n{text}" if prefix else text
