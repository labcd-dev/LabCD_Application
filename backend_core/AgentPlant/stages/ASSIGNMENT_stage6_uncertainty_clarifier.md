# Assignment — AgentPlant Stage 6: Uncertainty and disturbance screening (shallow clone)

**Owner:** Whoever owns `backend_core/AgentAdaptive/prompts/clarifier_agent_prompt.yaml`. This is an explicit hand-off to the AgentAdaptive team, not a generic task.  
**Module root:** `backend_core/AgentPlant/stages/`  
**Shallow clone:** `stage6_uncertainty_clarifier.yaml`  
**Relay:** `stage6_uncertainty.py` (`clarifier_turn`, `clean_terms`)  
**HITL gate:** `orchestrator.py` `_stage6`; actions `confirm` and `edit`; chat turns via `user_message`; payload `kind: "uncertainty"`  
**Original (not changed):** `backend_core/AgentAdaptive/prompts/clarifier_agent_prompt.yaml`, `backend_core/AgentAdaptive/agents/clarifier.py`

---

## 1. Decide how the shallow clone relates to the real clarifier

### Current state
This is **not** a request to redesign the clarifier. `AgentAdaptive` already runs the full clarifier as its own `clarifying` job stage when a design job starts. The stage-6 copy here is an earlier, narrower pre-screen at the Plant level. Its job is to give Stage 7 an early signal. It does not replace the original, and nothing in AgentAdaptive has changed.

What the clone is:

- A line-by-line copy of the original prompt with the `references` handling removed. The original has 105 lines. The clone has 68, and every removed line was part of the reference-signal rules (point 4, the first-reply rule in point 5, the `references` keys in the JSON shapes, and the `references` entries in the examples). The two sentences that introduced the reference input were also changed. Every other line matches the original.
- The Python relay reads only `dynamics.uncertainty` and `dynamics.disturbance`. It rebuilds its output from those two keys, so a `references` key the model emits is dropped, not forwarded.
- `clean_terms` rejects any term whose `state` is not in `metadata["states"]`. Such a reply becomes a clarifying question, not a completion.
- The stage has a conversational contract. Each turn is `continue` (one question) or `complete` (the two lists). The HITL gate shows the question, and the user confirms only after the model reports `complete`.

### Tasks
- [ ] Review the clone against the original, line by line, and confirm that nothing was removed beyond the `references` material. The clone was produced by line-range edits with boundary assertions, which is reproducible, but a human should still read it.
- [ ] Confirm that the Python side can never re-emit a `references` key. `clarifier_turn` builds its return value from scratch, so this holds by construction. Add a test that feeds a `references` key in and checks it is absent from the output.
- [ ] Decide the long-term relationship between this upstream copy and the real clarifier. The options are:
  - (a) Seed `AdaptiveJobCreateRequest.system_spec` (`backend_api/http/schemas/adaptive.py`, line 51) with `dynamics.uncertainty` and `dynamics.disturbance`, so the real clarifier does not re-ask from zero.
  - (b) Collapse to one shared pass, so there is only one clarifier.
  Whichever is chosen, write it down. Do not leave two silently diverging copies as a permanent state.
- [ ] Decide whether the clone should track the original. If the original changes, this copy goes stale. Either sync it on a schedule or record that it is a snapshot.

### Acceptance
- AgentAdaptive's own `clarifying` stage behaves exactly as before. No file under `backend_core/AgentAdaptive/` is modified by this work.
- The `references`-free contract holds in the prompt, in `clean_terms`, and in the output, and a test covers the output.
- The relationship chosen in task 3 is written in this file, with the reason.

### Out of scope for this item
- AgentAdaptive's designer, tuner, and diagnoser agents.
- Stage 7's routing logic.
- Adding reference-signal handling anywhere in AgentPlant. Reference signals belong to the AgentAdaptive stage, not the Plant stage.
