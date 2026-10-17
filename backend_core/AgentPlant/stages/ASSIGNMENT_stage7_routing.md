# Assignment — AgentPlant Stage 7: Routing to downstream modules

**Owner:** AgentPlant backend developer, coordinating with the AgentMPC and AgentAdaptive owners on what "applicable" means for their modules  
**Module root:** `backend_core/AgentPlant/stages/`  
**Mock file:** `stage7_routing.py` (`route_plant`)  
**Prompt (not loaded by the mock):** `stage7_routing.yaml`  
**Frontend consumer:** `frontend/src/components/HitlModuleSelector.tsx` (filters `MODULES` with `moduleAllowedByRouting` in `frontend/src/components/pipeline/pipelineState.ts`), `frontend/src/components/pipeline/RoutingSummaryCard.tsx`  
**Reference:** `backend_core/AgentMPC/mpc/config.py` (horizon and `dt_mpc` bounds), `backend_core/AgentMPC/ASSIGNMENT.md` §2 (oversized `dt_mpc`), `backend_core/AgentAdaptive/ASSIGNMENT.md` §2 (infinite relative-degree hang)

---

## 1. Replace the placeholder with a real per-module judgment

### Current state
`route_plant` ignores its inputs and returns:

- `applicable` = `{"mpc": True, "adaptive": True, "silo": True, "mulo": False, "pid_tuner": None, "lqr": None}`
- `mpc_applicable` = `True`, `adaptive_applicable` = `True` (derived from `applicable`)
- `rationale` = `"[MOCK] always true/true for now — …"`

The output shape is extensible. Adding a module means adding a key to `applicable`, with no schema change. `null` means "not evaluated yet". The frontend keeps a module whose key is missing or `null`, and hides only a module set to `false`.

`mulo: False` is taken from the spec's worked example. It is not the result of any analysis. In the mock, the MULO option is therefore hidden in the UI. Confirm this before the mock is used for anything.

`stage7_routing.yaml` contains the prompt for the real judgment. The mock does not load it, and the orchestrator never calls an LLM during routing (a test asserts this).

### Tasks
- [ ] Load `stage7_routing.yaml` and make the real judgment. The LLM is the point of this stage: it handles borderline cases such as "underactuated but still stabilizable". Do not replace it with a fixed rule table.
- [ ] Give the model the documented preconditions for each module, from each module's own code and ASSIGNMENT.md. Do not write the preconditions into the prompt by hand.
- [ ] Keep the flat keys (`mpc_applicable`, `adaptive_applicable`) and the `applicable` dict in sync. Validate the reply, and on a mismatch ask again using the repair pattern `agent.py` already uses for its JSON.
- [ ] Leave modules without preconditions as `null`. Never guess a boolean for an unevaluated module.
- [ ] Route around known limitations, and say so in the rationale:
  - Adaptive, relative degree: a plant whose output is not influenced by any input (undefined or infinite relative degree) must be routed away from Adaptive, with that reason named. See `backend_core/AgentAdaptive/ASSIGNMENT.md` §2.
  - MPC, oversized `dt_mpc`: see `backend_core/AgentMPC/ASSIGNMENT.md` §2. Revisit this rule once that bug is fixed.
- [ ] Unit tests for MPC-only, Adaptive-only, both, and the infinite-relative-degree case (routed away from Adaptive, with the reason in the rationale).
- [ ] Decide what the real `mulo` and `silo` values should be. Document the decision, and remove the mock's `mulo: False`.

### Acceptance
- The output comes from Stage 1–6 context, not a constant. Changing the plant changes the routing.
- The infinite-relative-degree example is routed away from Adaptive, with the reason named.
- The frontend hides only modules explicitly set to `false`. A `null` module stays visible.
- Adding a module id requires no schema change.

### Out of scope for this item
- Fixing the underlying AgentMPC and AgentAdaptive bugs. This stage only routes around their current limitations.
- Implementing PID Tuner or LQR. Their routing is `null` until those modules exist.
- The `PreLaunchModal` pre-fill (optional, not part of this item).
