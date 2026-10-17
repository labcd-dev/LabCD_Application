# Assignment — AgentPlant Stage 4: State and input constraints

**Owner:** AgentPlant / controls backend developer  
**Module root:** `backend_core/AgentPlant/stages/`  
**Mock file:** `stage4_constraints.py` (`propose_constraints`)  
**Conversational turn:** `stage4_constraints.py` (`constraints_turn`), prompt in `stage4_constraints.yaml`  
**HITL gate:** `orchestrator.py` `_stage4`; actions `confirm` and `edit`; chat turns via `user_message`; payload `kind: "constraints"`  
**Reference:** `backend_core/AgentPlant/GUIDE.md` (Core Invariant 6: one focused question per turn), `backend_core/AgentAdaptive/prompts/clarifier_agent_prompt.yaml` (the `continue`/`complete` pattern this stage reuses), `backend_core/AgentMPC/mpc/config.py` (where limits are finally enforced)

---

## 1. Replace the unbounded short-circuit with a real judgment

### Current state
`propose_constraints()` returns `{"bounded": False, "state_bounds": None, "input_bounds": None, "notes": "[MOCK] short-circuited to unbounded — …"}` with no question asked.

The scaffolding is real:

- `stage4_constraints.yaml` loads through `labcd_agents.PromptLibrary`, the same mechanism as Stage 1.
- `constraints_turn` sends a user message to the LLM and expects `{"status": "continue"|"complete", "reply", "state_bounds", "input_bounds"}`.
- A `complete` reply is validated with `check_bounds`: correct length, each pair `[lower|null, upper|null]`, `lower <= upper`. A contradiction is reported to the user in the chat, and the proposal is left unchanged.
- The HITL card (`frontend/src/components/pipeline/ConstraintsHitlCard.tsx`) shows the current bounds and a single confirm button. Limits are entered in the chat, not in a form.

Because the mock never asks, the LLM path only runs when the user types about limits. A user who never mentions limits gets unbounded, with no chance to be asked.

### Tasks
- [ ] Make the stage ask. On entry, the first question should be about actuator or state limits, by name (for example, "Is there a maximum voltage on the motor?"). Never use "x1" or "u1" when a name exists.
- [ ] Accept "no limits" in one turn. Do not walk the user through a checklist.
- [ ] Collect bounds per state and per input. Use `null` for an unbounded side and never invent a limit the user did not give.
- [ ] Keep the contradiction check. On contradiction, ask again rather than passing bad bounds downstream.
- [ ] Decide whether `complete` should advance without a confirm click. The current contract waits for confirm.
- [ ] Unit tests for the no-limits fast path, partial bounds (one side only), multi-variable bounds, and a contradiction.
- [ ] Confirm the questions always use the real variable names from `metadata`.

### Acceptance
- "No limits" completes in one turn.
- Partial bounds leave every other side `null`, and nothing is invented.
- Every question names a real state or input.
- A contradiction never reaches Stage 5.

### Out of scope for this item
- Enforcing bounds inside any control-design module. AgentMPC enforces its own constraints. This stage only records them.
- Soft constraints and penalty weights.
- Changing the HITL card's visual design. The chat remains the editing surface.
