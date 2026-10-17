"""Shared state types for the AgentPlant pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

PipelineStatus = Literal["running", "awaiting_hitl", "done"]


@dataclass
class PlantPipelineState:
    """Everything the pipeline needs between HTTP calls.

    Serialized into ``PlantModelSessionState.pipeline_context`` so the frontend's
    existing session-state round-trip carries it.
    """

    stage: int = 1  # 1 = not started; 2..7 while the pipeline runs
    status: PipelineStatus = "running"
    plant: dict[str, Any] | None = None  # Stage-1 snapshot: system_name, python_code, metadata
    proposal: dict[str, Any] | None = None  # payload currently waiting on the HITL gate
    data: dict[str, Any] = field(default_factory=dict)  # confirmed outputs of each stage
    dialogue: list[dict[str, str]] = field(default_factory=list)  # chat turns of the current stage

    @property
    def in_progress(self) -> bool:
        """True while a HITL gate or conversational stage is waiting on the user."""
        return 2 <= self.stage <= 6

    def to_context(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "plant": self.plant,
            "proposal": self.proposal,
            "data": self.data,
            "dialogue": self.dialogue,
        }

    @classmethod
    def from_session(cls, stage: int | None, context: dict[str, Any] | None) -> "PlantPipelineState":
        ctx = context or {}
        return cls(
            stage=stage or 1,
            status=ctx.get("status", "running"),
            plant=ctx.get("plant"),
            proposal=ctx.get("proposal"),
            data=dict(ctx.get("data") or {}),
            dialogue=list(ctx.get("dialogue") or []),
        )


@dataclass
class PipelineTurn:
    """What one orchestrator call produced for the user."""

    reply: str
    steps: list[str] = field(default_factory=list)  # trace labels shown in the chat trace
