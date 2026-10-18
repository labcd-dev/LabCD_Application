"""Page to try the Stage 7 Adaptive check on a plant JSON.

    streamlit run frontend_streamlit/routing_ui.py
"""

import json
import os
import sys

import streamlit as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend_core.AgentPlant.stages.stage7_adaptive_check import plant_metadata_from_json
from backend_core.AgentPlant.stages.stage7_routing import route_plant

def _plain(text):
    return str(text or "").replace("\\", "\\\\").replace("*", "\\*").replace("$", "\\$")


def _load_plant(raw):
    st.session_state.pop("routing_result", None)
    try:
        st.session_state.routing_plant = plant_metadata_from_json(raw)
        st.session_state.routing_error = None
    except ValueError as exc:
        st.session_state.routing_plant = None
        st.session_state.routing_error = str(exc)


def _render_input():
    text = st.text_area("Plant JSON (plant agent output, final_result or artifact)", height=200, key="routing_text")
    if st.button("Read", key="routing_read_paste", disabled=not text.strip()):
        _load_plant(text)


def _render_plant(metadata, initial_state):
    st.subheader("Plant")
    st.markdown("States: %s · Inputs: %s · Outputs: %s" % (
        ", ".join(metadata.get("states") or []), ", ".join(metadata.get("inputs") or []),
        ", ".join(metadata.get("outputs") or [])))
    with st.expander("State equations"):
        for state, equation in zip(metadata.get("states") or [], metadata.get("state_equations") or []):
            st.code("d%s/dt = %s" % (state, equation), language=None)
    states = metadata.get("states") or []
    defaults = initial_state if initial_state and len(initial_state) == len(states) else [0.0] * len(states)
    st.markdown("**Trim point x0**")
    columns = st.columns(max(len(states), 1))
    return [col.number_input(name, value=float(value), format="%g", key="routing_x0_%s" % name)
            for col, name, value in zip(columns, states, defaults)]


def _render_adaptive(check):
    if check["launchable"] is True:
        st.success("Adaptive: True")
    elif check["launchable"] is False:
        st.error("Adaptive: False")
    else:
        st.warning("Adaptive: not evaluated")
    st.caption(_plain(check["reason"]))
    for name, report in check["methods"].items():
        label = "%s: %s" % (name, "ok" if report["ok"] else "not applicable")
        with st.expander(label, expanded=not report["ok"] and not check["launchable"]):
            for reason in report["reasons"] or ["All preconditions are met."]:
                st.markdown("- " + _plain(reason))
    if check["relative_degrees"]:
        st.markdown("Relative degrees: %s" % ", ".join("undefined" if d is None else str(d)
                                                       for d in check["relative_degrees"]))
    for warning in check["warnings"]:
        st.warning(_plain(warning))


def run_app():
    st.title("Stage 7 routing: Adaptive check")
    _render_input()
    if st.session_state.get("routing_error"):
        st.error("This JSON cannot be used: " + st.session_state.routing_error)
    if not st.session_state.get("routing_plant"):
        return

    metadata, initial_state = st.session_state.routing_plant
    x0 = _render_plant(metadata, initial_state)
    if st.button("Check the plant", type="primary", key="routing_check"):
        st.session_state.routing_result = route_plant(metadata, {"trim": {"x0": x0}})

    routing = st.session_state.get("routing_result")
    if routing:
        _render_adaptive(routing["adaptive_check"])
        with st.expander("Full routing output"):
            st.code(json.dumps(routing["applicable"], indent=2), language="json")


if __name__ == "__main__":
    st.set_page_config(page_title="Stage 7 routing", layout="wide")
    run_app()
