# Assignment — AgentPlant Stage 3: Trim (initial conditions and feedforward input)

**Owner:** AgentPlant / controls backend developer  
**Module root:** `backend_core/AgentPlant/stages/`  
**Mock file:** `stage3_trim.py` (`propose_trim`, `apply_trim_edit`)  
**HITL gate:** `orchestrator.py` `_stage3`; actions `confirm` and `edit`; payload `kind: "trim"`  
**Reference:** `backend_core/AgentMPC/mpc/jacobian.py` (for the Newton Jacobian), `frontend/src/components/PreLaunchModal.tsx` (`inferNumStates` / `getStateNames`)

---

## 1. Solve for a real trim point

### Current state
`propose_trim(metadata)` returns zeros:

- `x0 = [0.0] * len(states)`
- `u_ff = [0.0] * len(inputs)`
- `source = "[MOCK] zeros — real agent should solve f(x0,u0)=0 for a user-specified operating point"`

The HITL gate works. `confirm` accepts the proposal, or accepts it with `pipeline_edit` applied first. `edit` applies `pipeline_edit` and keeps the gate open. `apply_trim_edit` validates each vector: right length, every entry finite. It raises `ValueError`, which the router turns into HTTP 400. A user edit sets `source` to `"user"`.

The proposal is the only thing the user sees. Nothing checks whether `f(x0, u_ff) ≈ 0`. On a gravity-loaded plant the zeros are wrong, and the user has no signal that they are.

### Tasks
- [ ] Solve `f(x_trim, u_trim) = 0` with a damped Newton iteration. Use the Stage 2 Jacobian, not a new one.
- [ ] When the user gave no preference, use the solver result. When the user gave `x0` or `u_ff`, use theirs. Do not override a user value with a solver result.
- [ ] Handle "no equilibrium near the search region" by saying so and returning no point. Never return a value that is not an equilibrium and label it as one.
- [ ] Keep `x0` and `u_ff` ordered 1:1 with `metadata["states"]` and `metadata["inputs"]`. `check_vector` in `common.py` already enforces the length.
- [ ] Record the residual `||f(x_trim, u_trim)||` in the proposal so the UI can show it.
- [ ] Keep the accept/edit gate exactly as it is. Only the proposal content changes.
- [ ] Unit tests for an equilibrium at the origin (spring-mass-damper style, expect ~0), a gravity-loaded plant (expect a nonzero `u_ff` with residual ≈ 0), and a plant with no equilibrium.
- [ ] Remove `MOCK_SOURCE` once the real solver writes `source`.

### Acceptance
- A spring-mass-damper returns x0 and u_ff near zero without any user input.
- A gravity-loaded plant returns a nonzero `u_ff`, and its residual is below the solver tolerance.
- The gate still blocks Stage 4 until the user accepts or edits.
- Edits are validated the same way as today.

### Out of scope for this item
- Trajectory optimization or a schedule of trim points.
- The Stage 4 logic.
- The orchestrator's stage ordering, beyond what the output shape requires.
- The optional pre-fill of `PreLaunchModal`'s `Initial State x0` from this result. It is listed as optional in the pipeline spec and is not done in this change.
