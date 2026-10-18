"""Runs a plant through stages 1-7 in the terminal and saves the json files.

    python backend_core/AgentPlant/run_pipeline_cli.py
    python backend_core/AgentPlant/run_pipeline_cli.py --plant my_plant.json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

# so the imports below work from any folder
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# load the api key from .env
try:
    from labcd_agents import ensure_env_loaded
    env_file = REPO_ROOT / ".env"
    ensure_env_loaded(str(env_file) if env_file.is_file() else None)
except ImportError:
    pass

from backend_core.AgentPlant.agent import PlantModelAgent
from backend_core.AgentPlant.stages.orchestrator import PlantPipelineOrchestrator, build_final_metadata

DEFAULT_MODEL = os.getenv("LABCD_DEMO_MODEL", "gpt-4o-mini")

# what stages 2-6 add to the metadata
STAGE6_KEYS = ["analysis", "trim", "constraints", "control_objective", "uncertainty", "disturbance"]

HELP = """  c / confirm          accept
  confirm {json}       accept with new values
  edit {json}          change the values and stay here
  anything else        chat with the stage (4-6)
  quit                 bye"""


def make_plant(data):
    # the pipeline can't start without metadata
    if not isinstance(data.get("metadata"), dict):
        print("no metadata in this plant, can't continue")
        sys.exit(1)
    return {
        "system_name": data.get("system_name"),
        "python_code": data.get("python_code"),
        "metadata": data["metadata"],
    }


def chat_stage1(agent, ask=input):
    # just chat until the agent says the model is ready
    history = []
    print("Describe your system (quit to leave).")
    while True:
        message = ask("\nYou > ").strip()
        if message in ("quit", "exit"):
            sys.exit(0)
        if message == "":
            continue

        reply, result = agent.step(list(history), message)
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        print("\nAgent > " + reply)

        if result is not None:
            return make_plant(result)


def parse_gate_input(text):
    # returns (message, action, edit)
    text = text.strip()
    first_word, _, rest = text.partition(" ")
    first_word = first_word.lower()

    if first_word in ("quit", "exit"):
        sys.exit(0)

    if first_word in ("confirm", "c", "edit"):
        action = "confirm"
        if first_word == "edit":
            action = "edit"
        edit = None
        if rest.strip() != "":
            edit = json.loads(rest)  # bad json -> ValueError, run_gates handles it
        return "", action, edit

    # not a command so it's a chat message
    return text, None, None


def show_turn(state, turn):
    print("\n[stage " + str(state.stage) + "] " + turn.reply)
    if turn.steps:
        print("steps: " + ", ".join(turn.steps))
    if state.status != "done":
        print(json.dumps(state.proposal, indent=2, ensure_ascii=False))
        print(HELP)


def safe_name(plant):
    # "Cart Pole" -> cart_pole
    name = re.sub(r"[^A-Za-z0-9]+", "_", plant["system_name"] or "").strip("_").lower()
    if name == "":
        name = "plant"
    return name


def file_name_for_stage(plant, stage):
    return safe_name(plant) + "_for_stage" + str(stage) + ".json"


def ask_to_continue(state, plant, out_dir, ask):
    # a stage just finished and state.stage is the next one
    next_stage = state.stage
    print("\nstage " + str(next_stage - 1) + " is done.")
    answer = ask("go to stage " + str(next_stage) + " or stop and save the json? (enter = go on, s = stop) > ")
    answer = answer.strip().lower()

    if answer in ("quit", "exit"):
        sys.exit(0)
    if answer in ("s", "stop"):
        save_json(out_dir / file_name_for_stage(plant, next_stage), plant_with_results(plant, state.data))
        sys.exit(0)


def run_gates(orchestrator, state, turn, plant, out_dir, ask=input):
    # keep answering the stages until stage 7 is done
    ask_to_continue(state, plant, out_dir, ask)  # stage 2 runs by itself, so ask right away
    show_turn(state, turn)
    while state.status != "done":
        old_stage = state.stage
        try:
            text = ask("\nstage " + str(state.stage) + " > ")
            message, action, edit = parse_gate_input(text)
            state, turn = orchestrator.step(state, message, action, edit)
        except ValueError as error:
            # bad json or bad values, stay on the same stage
            print("\n! " + str(error))
            continue

        if state.stage > old_stage:
            ask_to_continue(state, plant, out_dir, ask)
        show_turn(state, turn)
    return state


def plant_with_results(plant, data):
    # stage 1 metadata + whatever stages finished so far
    metadata = dict(plant["metadata"])
    for key in STAGE6_KEYS:
        if key in data:
            metadata[key] = data[key]
    result = {
        "system_name": plant["system_name"],
        "python_code": plant["python_code"],
        "metadata": metadata,
    }
    if "trim" in data:
        result["pre_launch"] = {"initial_state": data["trim"]["x0"]}
    return result


def plant_after_stage7(state):
    return {
        "system_name": state.plant["system_name"],
        "python_code": state.plant["python_code"],
        "metadata": build_final_metadata(state),
    }


def show_adaptive_verdict(routing):
    # stage 7 already ran, this just says what it found
    check = routing["adaptive_check"]
    verdicts = {True: "True (it fits)", False: "False (it doesn't fit)", None: "not evaluated"}
    print("\nAdaptive: " + verdicts[check["launchable"]])
    print(check["reason"])
    for method, report in check["methods"].items():
        if report["ok"]:
            print("  " + method + ": ok")
        else:
            print("  " + method + ": no - " + "; ".join(report["reasons"]))
    for warning in check["warnings"]:
        print("  warning: " + warning)


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print("saved " + str(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--plant", help="plant json, skips stage 1")
    # default is next to the repo, not the current folder (it can be a read-only one)
    parser.add_argument("--out-dir", default=str(REPO_ROOT / "pipeline_out"))
    args = parser.parse_args()

    # so special characters don't crash the print on windows
    sys.stdout.reconfigure(encoding="utf-8")

    agent = PlantModelAgent(model=args.model)

    if args.plant:
        with open(args.plant, encoding="utf-8") as file:
            plant = make_plant(json.load(file))
    else:
        plant = chat_stage1(agent)

    # the agent is also the llm for the stages
    orchestrator = PlantPipelineOrchestrator(agent)
    out_dir = Path(args.out_dir)
    state, turn = orchestrator.start(plant)
    state = run_gates(orchestrator, state, turn, plant, out_dir)

    # made it to the end: show the adaptive verdict and save both files
    show_adaptive_verdict(state.data["routing"])
    print("\nrouting: " + json.dumps(state.data["routing"]["applicable"]))
    save_json(out_dir / file_name_for_stage(plant, 7), plant_with_results(plant, state.data))
    save_json(out_dir / (safe_name(plant) + "_after_stage7.json"), plant_after_stage7(state))


if __name__ == "__main__":
    main()
