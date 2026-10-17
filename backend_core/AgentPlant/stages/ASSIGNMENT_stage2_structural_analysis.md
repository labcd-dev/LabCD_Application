# Assignment — AgentPlant Stage 2: Structural analysis

**Owner:** AgentPlant / controls backend developer  
**Module root:** `backend_core/AgentPlant/stages/`  
**Mock file:** `stage2_analysis.py` (`run_structural_analysis`)  
**Wired by:** `orchestrator.py` (`PlantPipelineOrchestrator.start`), runs automatically after Stage 1 with no HITL gate  
**Reference:** `backend_core/AgentMPC/mpc/jacobian.py`, `backend_core/plant_compiler.py`, `backend_api/PlantModelChat/plant_tools/sandbox.py`

---

## 1. Replace the mock with a real linearization and rank analysis

### Current state
`run_structural_analysis(metadata)` returns a fixed dict, with no computation:

- `controllability`, `observability`, `stabilizability` are hardcoded to `"controllable"`, `"observable"`, `"stabilizable"`.
- `actuation` is hardcoded to `"fullyactuated"`, whatever `len(inputs)` is.
- `linearization_point` is `{"x0": zeros(n_states), "u0": zeros(n_inputs)}`.
- `notes` is `"[MOCK] placeholder — real node should return A, B, C, D and rank-based tests, not hardcoded strings."`

The chat trace label is `"Structural analysis (mock)"`. The reply line is `"Checked controllability/observability — looks fine. Moving to trim conditions."`. Both are written as mock output, so the user is told the checks ran when they did not.

The result is stored in `metadata["analysis"]` after the pipeline finishes. Nothing downstream consumes it yet except the Stage 5 prompt, which uses it as context.

### Tasks
- [ ] Linearize `dynamics(t, x, u)` about a nominal point. Reuse `finite_diff_jacobian` in `backend_core/AgentMPC/mpc/jacobian.py` (line 32) for A and B. Do not hand-derive Jacobians.
- [ ] Decide and document the nominal point. Stage 2 currently runs before Stage 3, so it linearizes at the origin. Decide whether it should re-run once Stage 3 provides `x0`/`u_ff`. If it re-runs, the Stage 3 gate has to read the new result, and the order of gates has to be stated explicitly.
- [ ] Controllability: rank of the Kalman matrix `[B, AB, …, A^(n-1)B]` against `n_states`.
- [ ] Observability: rank of the observability matrix with `C` from `metadata["outputs"]`. Map each output name to its row of the state vector.
- [ ] Stabilizability: PBH test on any uncontrollable modes. This is weaker than controllability, so the uncontrollable part must be shown to be stable.
- [ ] Actuation classification from `rank(B)` relative to `n_states`: `underactuated`, `fullyactuated`, `overactuated`.
- [ ] Guard singular or ill-conditioned `A`/`B` and return a user-facing failure, not a raw `LinAlgError`. `verify_dynamics` (`backend_core/plant_compiler.py`, line 457) numerically checks Stage 1 `state_equations` against `dynamics()`. It does not check the Jacobian, so a separate finiteness check is still needed.
- [ ] Run the new code under the same sandboxing used for the Stage 1 smoke test. The Euler probe is `_euler_integrate` (`backend_api/PlantModelChat/plant_tools/sandbox.py`, line 260) and `smoke_test_dynamics` is at line 489. Never `exec` the user's `dynamics()` outside that sandbox.
- [ ] Unit tests for: the DC motor (controllable, observable, fullyactuated), a deliberately uncontrollable plant (report the offending state by name), and a MIMO plant.
- [ ] Remove the `"[MOCK] …"` strings from the output once the real code replaces them.

### Acceptance
- Output is computed from `dynamics()` and `metadata`, not hardcoded. Changing the plant changes the result.
- The DC motor reports controllable, observable, fullyactuated.
- The uncontrollable example reports non-controllable and names the state.
- Singular or non-finite Jacobians produce a readable message in the trace, not a traceback.
- The reply text states what was actually checked.

### Out of scope for this item
- Nonlinear (global) controllability analysis. This stage is linearized and local only, and the output must say so.
- Changes to what Stage 3 or Stage 4 do with the result.
- Frontend rendering of the analysis. This is an optional follow-up.
