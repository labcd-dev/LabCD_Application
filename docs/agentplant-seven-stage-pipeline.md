# AgentPlant Seven-Stage Pipeline

AgentPlant turns a natural-language description of a dynamical system into a runnable `dynamics(t, x, u)` function and structured metadata. The pipeline then takes that confirmed plant through seven stages, each of which adds information needed to design a controller. Its output feeds the control-design modules (`AgentMPC`, `AgentAdaptive`, and later PID Tuner and LQR).

This document describes what is implemented as of this change, why it is shaped the way it is, and how to extend it. The per-stage hand-off documents, which describe the work still to do in each mocked stage, live next to the code in `backend_core/AgentPlant/stages/ASSIGNMENT_*.md`.

## At a glance

```
Stage 1  Plant dynamics            chat, unchanged            (continue / draft / complete)
   │ complete
   ▼
Stage 2  Structural analysis       automatic     [MOCK]
Stage 3  Trim                      HITL gate     [MOCK]       accept / edit
Stage 4  State & input bounds      HITL gate     [MOCK judgment, real chat]
Stage 5  Control objective         HITL gate     real LLM     accept / edit / chat
Stage 6  Uncertainty & disturbance HITL gate     shallow clone, chat
Stage 7  Routing                   automatic     [MOCK]
   │ done
   ▼
Module selector (filtered by routing)  →  PreLaunch  →  AgentMPC / AgentAdaptive
```

Stage 1 is the conversational plant builder that already existed. The pipeline begins when Stage 1 reports `complete`, and each later chat turn is routed to the pipeline until it finishes.

## Stage reference

| Stage | Name | Implementation | Gate | Payload `kind` | Owner brief |
|---|---|---|---|---|---|
| 1 | Plant dynamics | Real (existing) | Chat | — | — |
| 2 | Structural analysis | Mock | None | — | `ASSIGNMENT_stage2_structural_analysis.md` |
| 3 | Trim | Mock | Accept / edit | `trim` | `ASSIGNMENT_stage3_trim.md` |
| 4 | State & input constraints | Mock judgment, real chat contract | Accept / edit, plus chat | `constraints` | `ASSIGNMENT_stage4_constraints.md` |
| 5 | Control objective | Real LLM agent | Accept / edit, plus chat | `control_objective` | — |
| 6 | Uncertainty & disturbance | Shallow clone of the AgentAdaptive clarifier | Chat, then confirm | `uncertainty` | `ASSIGNMENT_stage6_uncertainty_clarifier.md` |
| 7 | Routing | Mock | None | `routing` | `ASSIGNMENT_stage7_routing.md` |

Stages 2 and 7 never ask the user anything. Stage 5 is the only stage whose main output is written by a real model during the pipeline. Stage 6 is a deliberately narrow pre-screen. The full clarifier still runs later, inside AgentAdaptive's own job.

## Lifecycle

1. The user builds a plant with Stage 1 as before. The live status fields (`continue`, `draft`, `complete`) keep their Stage 1 meaning.
2. When Stage 1 completes with usable metadata, `plant_model_service` hands off to `start_pipeline`. The orchestrator runs Stage 2, then opens the Stage 3 gate. The response has `status: "complete"` and `pipeline_stage: 3`, `pipeline_status: "awaiting_hitl"`.
3. Each later request carries `session_state` back. While `pipeline_stage` is 2–6 the request goes to `run_pipeline_turn`, and Stage 1 is not invoked.
4. At each gate the user can **confirm** the proposal, **edit** it (the gate stays open), or in Stages 4–6 type in chat. Confirming advances the stage.
5. Stage 6 confirms only once the clarifier reports it has what it needs. Confirming then runs Stage 7 automatically and sets `pipeline_status: "done"`, `pipeline_stage: 7`.
6. On `done`, `final_result.metadata` holds the merged metadata (see below), and the conversation's `latest_draft` is updated to match, so artifact and sidebar code sees the complete plant.

Once the pipeline is `done`, a new chat message is handled by Stage 1 again and resets the pipeline (see "Known limitations").

## HTTP contract

All pipeline traffic uses the existing `POST /plant-model/chat`. No new endpoint was added.

### Request additions

| Field | Type | Meaning |
|---|---|---|
| `pipeline_action` | `"confirm" \| "edit" \| null` | `confirm` accepts the current proposal, applying `pipeline_edit` first if present, and advances. `edit` applies `pipeline_edit` and keeps the gate open. |
| `pipeline_edit` | object \| null | Stage-specific values, described below. |

Ordinary chat messages in Stages 4–6 use `user_message` with no `pipeline_action`.

### Response additions

| Field | Type | Meaning |
|---|---|---|
| `pipeline_stage` | int \| null | Current stage. `null` for plain Stage 1 turns. |
| `pipeline_status` | `"running" \| "awaiting_hitl" \| "done" \| null` | `running` is defined but not emitted. Transitions complete within one request. |
| `pipeline_payload` | object \| null | What the current gate shows. See the payload shapes below. |

`status`, `final_result`, and `reply` keep their meaning. While the pipeline is in progress, `final_result` holds the Stage 1 plant, and it is replaced with merged metadata only on `done`.

### Session state

`session_state` gains two fields, both round-tripped through the existing persistence:

- `pipeline_stage: int` (default 1)
- `pipeline_context: object`, with this shape:

```json
{
  "status": "awaiting_hitl",
  "plant": { "system_name": "...", "python_code": "...", "metadata": { } },
  "proposal": { },
  "data": { "analysis": { }, "trim": { }, "constraints": { }, "control_objective": "...", "uncertainty": [ ], "disturbance": [ ], "routing": { } },
  "dialogue": [ { "role": "user", "content": "..." } ],
  "payload": { "stage": 3, "kind": "trim", "proposal": { } }
}
```

`payload` duplicates the current gate's payload so that a reloaded conversation can redraw its gate without the frontend repeating the stage-to-kind mapping.

### Stored message kinds

Each stored message row has a nullable `kind` column, `plant_model_messages.kind`, added by `_migrate_plant_model_messages` in `db/session.py`. The migration is idempotent. `NULL` is a plain chat turn.

| Stored kind | Row | Meaning |
|---|---|---|
| `hitl_selection` | user | A gate click, Confirm System, or a typed answer to an open Stage 4–6 question. Its content is the trace label that was shown, for example `Accepted trim point`. |
| `stage_note` | assistant | A reply produced while the pipeline is active. |

`message_kinds()` in `plant_pipeline_service.py` decides both kinds. The conversation detail returns `kind` on each entry of `messages`. Unknown stored values are read as plain chat.

### Payload shapes

| `kind` | Stage | `proposal` contents |
|---|---|---|
| `trim` | 3 | `{ x0: number[], u_ff: number[], source: string }`. `source` is `"[MOCK] …"` until the user edits, then `"user"`. |
| `constraints` | 4 | `{ bounded: bool, state_bounds: [[lo\|null, hi\|null], …] \| null, input_bounds: … \| null, notes: string }` |
| `control_objective` | 5 | `{ control_objective: string }` |
| `uncertainty` | 6 | `{ ready: bool, question: string \| null, uncertainty: [{state, expr}], disturbance: [{state, expr}], summary: string \| null }` |
| `routing` | 7 (on `done`) | `{ routing: { mpc_applicable, adaptive_applicable, applicable: {…}, rationale } }` |

### Stage-specific `pipeline_edit` values

- Stage 3: `{ x0?: number[], u_ff?: number[] }`. Lengths must match `states` and `inputs`.
- Stage 4: `{ state_bounds?: [[lo, hi], …], input_bounds?: [[lo, hi], …] }`. Each pair needs `lower <= upper`, and `null` means unbounded on that side.
- Stage 5: `{ control_objective: string }`. Must be non-empty.
- Stage 6: `{ uncertainty?: [{state, expr}], disturbance?: [{state, expr}] }`. Each `state` must be a name in the plant.

Invalid edits raise `ValueError`, which the router returns as **HTTP 400** with the message. The gate does not move.

### Final metadata

On `done`, `final_result.metadata` is the Stage 1 metadata (unchanged, including `complexity`) plus:

- Flat keys: `control_objective`, `uncertainty`, `disturbance`, `mpc_applicable`, `adaptive_applicable`. These names are relied on by other systems and must not change.
- Sub-objects: `analysis`, `trim`, `constraints`, `routing`.

No Stage 1 key is overwritten. `build_final_metadata` in `orchestrator.py` enforces this by construction.

## Backend layout

```
backend_api/http/
  routers/plant_model.py                   ValueError → 400; stores pipeline clicks as "Confirmed"/"Edited"
  schemas/plant_model.py                   request/response/session fields
  services/plant_model_service.py          run_plant_model_chat: routes Stage 1 vs pipeline
  services/plant_pipeline_service.py       start_pipeline, run_pipeline_turn, response building
  services/plant_model_chat_service.py     session (de)serialization (pipeline fields persist)

backend_core/AgentPlant/
  agent.py                                 Stage 1 (canonical); repair_dynamics_from_sandbox
  plant_model_agent.yaml                   Stage 1 prompts (module root, flat)
  plant_model_metadata.yaml
  stages/
    orchestrator.py                        PlantPipelineOrchestrator, build_final_metadata
    pipeline_types.py                      PlantPipelineState, PipelineTurn
    common.py                              prompt loading, template rendering, JSON turns, vector checks
    stage2_analysis.py                     [MOCK]
    stage3_trim.py                         [MOCK] + edit validation
    stage4_constraints.py + .yaml          [MOCK] judgment + chat turn
    stage5_objective.py + .yaml            LLM drafting and revision
    stage6_uncertainty.py + clarifier yaml shallow clone + relay
    stage7_routing.py + .yaml              [MOCK] routing; yaml is the prompt for the real judgment
```

`backend_api/PlantModelChat/` is superseded, and its module docstring says so. It still provides `plant_tools` (sandbox smoke test, RAG, web search), so the package cannot be deleted yet.

### Responsibilities

- **Orchestrator** owns the stage state machine. It does not call the Stage 1 agent, and it does not know about HTTP. Each gate is a method (`_stage3` … `_stage6`) that takes `(state, user_message, action, edit)` and returns `(state, PipelineTurn)`.
- **Service adapter** (`plant_pipeline_service.py`) turns an orchestrator result into a response, sums token usage across the Stage 1 call and the pipeline calls, and copies merged metadata into `latest_draft` on `done`.
- **Stage modules** are pure functions except for the ones that take an `llm` argument. Mock stages are labelled `[MOCK]` in their output strings, so a reader of a stored conversation can see which parts are placeholders.

### Prompts

Every prompt is loaded with `labcd_agents.PromptLibrary` from `backend_core/AgentPlant/stages/`, the same mechanism Stage 1 uses. Each YAML has a `system_prompt` and a `user_prompt_template` with `{{placeholders}}`. Stages 4–6 expect the JSON shapes described in their YAML files. A reply that does not parse falls back to a safe default: a repeat question for Stages 4 and 6, or "couldn't revise" for Stage 5.

Stage 6's prompt is a line-by-line copy of `backend_core/AgentAdaptive/prompts/clarifier_agent_prompt.yaml` with its `references` handling removed. The original is not modified.

## Frontend

### Files

```
frontend/src/api/types.ts                        pipeline types and response fields
frontend/src/api/endpoints.ts                    pipeline_action / pipeline_edit request fields
frontend/src/components/AgentPlantChat.tsx       stage state, gate rendering, transcript
frontend/src/components/HitlModuleSelector.tsx   filters modules by routing
frontend/src/components/pipeline/
  pipelineState.ts          routing eligibility, session restore, transcript labels
  PipelineGate.tsx          chooses the card for payload.kind; reports each resolution
  PipelineCardShell.tsx     shared HITL chrome
  TrimHitlCard.tsx          Stage 3
  ConstraintsHitlCard.tsx   Stage 4 (bounds are entered in chat)
  ControlObjectiveHitlCard  Stage 5 (30 s countdown, pencil edit)
  UncertaintyHitlCard.tsx   Stage 6
  RoutingSummaryCard.tsx    Stage 7 summary before the module selector
  HitlTraceRow.tsx          muted inline record of a HITL choice
```

### Gate ordering

`AgentPlantChat` renders the first of these that applies, in order:

1. `pipeline` is active (`status !== "done"`): `PipelineGate`.
2. `pipeline` is `done` and the summary is unacknowledged: `RoutingSummaryCard`.
3. `isComplete || showHitl`: `HitlModuleSelector`, filtered by routing.
4. Otherwise: the "Confirm System & Select Controller" button, which calls `forceComplete`.

The pipeline gate takes priority over the module selector. Without this, a Stage 1 "Confirm" click would flash the selector before the pipeline's first gate arrives.

### Transcript behavior

- **HITL choices are trace rows, not bubbles.** When a gate resolves, `runPipelineAction` appends a `Turn` with `variant: "trace"`, rendered by `HitlTraceRow`. The label describes what the user did (for example `Accepted trim point`, `Auto-accepted objective after 30 s`, `Set trim to x0 = [1, 0]`). Trace rows carry no avatar and no message actions.
- **Trace rows are display-only.** They use role `assistant` so that resend and edit logic never selects them, and `historyOf()` strips them from every history sent to the server. The server never sees them as conversation content.
- **Free text answers an open question as a trace row.** While a Stage 4, 5, or 6 gate is open and no file is attached, the composer message is recorded as a trace row, not a user bubble.
- **Confirm System is a trace row** (`Confirmed system — <name>`), not a "Complete" bubble.
- **Stage lines are stage notes.** Any assistant reply produced while the pipeline is active is a `stage_note`: plain text in the same thread, with no action footer (copy, feedback, menu, timestamp). Only `chat` turns keep the footer.
- **The COMPLETE pill is gone.** The status pill is shown only for `continue` and `draft`. Stage progress is shown by the gate itself.
- **Reload keeps the same display.** Each stored row carries its kind (see "Stored message kinds"), so a reopened conversation shows the same trace lines, stage notes, and bubbles as the live session. Rows stored before kinds existed fall back to matching the old click labels.

### Countdown behavior

`ControlObjectiveHitlCard` starts a 30 second countdown. It pauses while the user is editing or while a request is in flight. Hovering the timer reveals ✕, and clicking it cancels the countdown for good. When the countdown reaches zero, it calls `onConfirm("timeout")`, which becomes the `Auto-accepted …` trace row. A new draft restarts the countdown.

### Routing filter

`HitlModuleSelector` keeps a module unless `routing.applicable[key] === false`. Missing or `null` values keep the module visible, so a module that has not been evaluated is never hidden by mistake.

| Module id | Routing key |
|---|---|
| `siloDesign` | `silo` |
| `muloDesign` | `mulo` |
| `adaptiveDesign` | `adaptive` |
| `mpcDesign` | `mpc` |

Adding a module means adding a key to `applicable`. No schema change is needed.

## Testing

### Backend

```bash
PYTHONPATH=. python -m pytest Test/test_agentplant_pipeline.py
```

The suite has 56 tests and uses a scripted fake LLM that answers each stage based on a marker in its system prompt. It covers:

- every gate's accept and edit paths, and the validation errors
- Stage 4 contradictions and unparseable replies
- Stage 6 reference stripping and unknown-state rejection
- metadata merge (Stage 1 keys preserved, flat keys present)
- service routing: Stage 1 is not re-entered mid-pipeline; a Stage 1 completion without metadata skips the pipeline
- session persistence round-trip, including old session dicts without pipeline fields
- the repoint: the service uses the canonical agent, which constructs from the module root
- the ported sandbox repair

Message kinds and the migration (15 tests):

```bash
PYTHONPATH=. python -m pytest Test/test_plant_message_kinds.py
```

Broader suite, from the repository root:

```bash
PYTHONPATH=. python -m pytest Test backend_core/AgentMPC/tests --ignore=Test/test_adaptive_mpc_integration.py
```

Two failures reproduce on the unmodified repository (`test_credits_routes_registered`, `test_report_pdf`). `test_adaptive_mpc_integration.py` fails at collection there too, because it expects an environment variable.

### Frontend

The repository has no frontend test runner. The checks run for this work were:

```bash
cd frontend && npx tsc -b && npx vite build
npx oxlint src/components/pipeline src/components/AgentPlantChat.tsx
```

Lint reports the same 7 warnings as before the work, all pre-existing. For the pipeline components, the following were also run as one-off checks outside the repository:

- label and restore mapping: 9 cases
- trace row and objective gate markup, server-rendered
- the countdown card in jsdom: it auto-accepts once with `"timeout"`, and hover followed by ✕ cancels it for good

These checks are not kept in the repository. Transcript behavior in `AgentPlantChat` (pill removal, history filtering, free-text routing) has been checked by reading and type-checking only. A browser run is the outstanding check.

## Extending the pipeline

### Replacing a mock

1. Read the stage's `ASSIGNMENT_*.md`. It lists the tasks and acceptance criteria.
2. Keep the function signatures in the stage module. The orchestrator depends only on them.
3. Remove the `[MOCK]` strings from output once the real code produces the value.
4. Update the stage's tests in `Test/test_agentplant_pipeline.py` and keep the `proposal` shape stable, because the frontend card reads it.

### Adding a stage

1. Add a module under `stages/` with a proposal function and, for a gate, an edit validator.
2. Add a branch to `PlantPipelineOrchestrator.step` and an `_enter_stage` case.
3. Add a `kind` to `PAYLOAD_KIND_BY_STAGE` and a card for it, then a case in `PipelineGate`.
4. Add a `traceLabelFor` case so the transcript records the choice.
5. Add the stage's keys to `build_final_metadata` without touching Stage 1 keys.

### Adding a downstream module

Add a key to `applicable` in Stage 7's output, and add a row to `ROUTING_KEY_BY_MODULE` in `pipelineState.ts`. Stage 7 should emit `null` until the module's preconditions are actually evaluated.

## Known limitations and open decisions

- **Stage 7 mock routes MULO off** (`mulo: false`), taken from the spec's worked example. The MULO option is hidden in the UI until a real routing decision exists.
- **Re-running the pipeline:** after `done`, a new chat message re-enters Stage 1, which resets the pipeline. The user must confirm the system again to start Stages 2–7 over.
- **Free text is recorded as a trace row whenever a Stage 4–6 gate is open**, including text that is really a conversational question the user asked back. The current rule is simple but imprecise.
- **Stage 1 messages during a gate go to Stages 4–6.** A change to the plant typed while a gate is open does not reach Stage 1.
- **`final_result` during the pipeline is the Stage 1 plant.** Code that reads `final_result` before `done` sees Stage 1 metadata only.
- **The "Set bounds" affordance in Stage 4 is the chat.** The card has no form, so a user has to type limits in words.
- **Stage 6 requires explicit confirmation** after the clarifier reports `complete`, while the spec's worked example advanced automatically.
- **Pre-launch x0 pre-fill from Stage 3 is not implemented.** `PreLaunchModal` still defaults `x0` to zeros.
- **Token usage** is summed across the Stage 1 call and the pipeline calls, but the pipeline's LLM calls are not yet attributed to a stage.

## Glossary

- **Gate (HITL):** a point where the pipeline waits for the user. Stages 3–6 have gates. Stages 2 and 7 never do.
- **Proposal:** what a gate is showing, in the `proposal` field of its payload.
- **Trace row:** a muted, bubble-less transcript line recording a HITL choice.
- **Shallow clone:** a copy of an existing prompt with part of its scope removed. Stage 6 is one.
- **[MOCK]:** a placeholder value or behavior, marked in the output strings so it is visible in stored conversations.
