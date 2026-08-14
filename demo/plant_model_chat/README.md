# LabCD Plant-Model Agent — Streamlit Demo

Standalone demo of [`labcd_agents`](../../packages/labcd_agents) with the
plant-model prompt in `prompts/plant_model_agent.yaml`.

## Behaviour

The model **always** returns one JSON object with one of three statuses:

| status | meaning |
|--------|---------|
| `continue` | Early chat — one clarifying question in `reply` |
| `draft` | Plant is known — propose real `python_code` + short note; user can edit or accept |
| `complete` | User accepted (or max drafts reached) — final model |

Product rule: once the system is identifiable, the agent **sketches draft
dynamics code** (with labelled assumptions) and iterates until the user says
finish / looks good / etc., or a max-draft limit is hit. It does not endlessly
walk a checklist with canned questions.

No hardcoded user-facing strings are returned by the agent. Display text
comes from the model's `reply` / code fields (or raw model text if JSON
repair fails).

## Setup

```bash
pip install -e "packages/labcd_agents[openai]"   # or [groq] / [all]
pip install -r demo/plant_model_chat/requirements.txt
export OPENAI_API_KEY=sk-...                     # or provider-specific key
```

## Run

```bash
streamlit run demo/plant_model_chat/app.py
```

## Sidebar controls

- **Min. user turns before auto-complete** — soft floor (explicit accept always wins)
- **Max drafts before auto-accept** — after N drafts, the latest is locked in

## Files

```
demo/plant_model_chat/
├── README.md
├── requirements.txt
├── agent.py                 # continue / draft / complete parsing + draft counter
├── app.py                   # Streamlit UI
└── prompts/
    └── plant_model_agent.yaml
```
