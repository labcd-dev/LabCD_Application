import queue
import threading
import traceback as _tb
from typing import Any, Dict

import streamlit as st

from frontend_streamlit.ga_agent_ui.ga_agent_utils import (
    LLM_MODELS,
    WEB_SEARCH_MODEL_OPTIONS,
    DEFAULT_OBJECTIVES,
    display_logo_home,
    empty_plot_data,
    get_available_case_studies,
    load_case_study_safe,
)
from backend_api.MuloDesigner.GaAgent.src.callbacks import register_callback, unregister_callback
from backend_api.MuloDesigner.GaAgent.ga_handler_agent import run_ga_handler
from backend_api.MuloDesigner.design_controller import MuloControllerDesigner


# -- Public entry-point --------------------------------------------------------

def display_home_page(run_by_ga_agent_ui: bool = True) -> None:
    """Display the home page with a ChatGPT-like interface."""
    if run_by_ga_agent_ui:
        display_logo_home()

        st.markdown(
            "<h1 style='text-align:center;margin-bottom:2px;'>GA-Agent</h1>"
            "<p style='text-align:center;color:gray;margin-top:0;'>"
            "LLM-Enhanced Genetic Algorithm for PID controller design"
            "</p>",
            unsafe_allow_html=True,
        )
        st.markdown("---")

    # -- Case-study selector ---------------------------------------------------
    if run_by_ga_agent_ui:
        case_studies = get_available_case_studies()
    else:
        case_studies = list(DEFAULT_OBJECTIVES.keys())

    if not case_studies:
        st.error(
            "No case studies found in `case_studies/json/`. "
            "Please add at least one JSON file."
        )
        return


    selected_cs: str = st.selectbox(
        "ðŸ“‚ Case Study",
        case_studies,
        key="home_case_study",
        help="Select the dynamical system to design a controller for.",
    )

    if run_by_ga_agent_ui:
        # Load the chosen case study to prefill the chat prompt
        case_data: Dict[str, Any] = load_case_study_safe(selected_cs)
        control_objective: str = case_data.get(
            "control_objective", "Design a stable controller"
        )
    else:
        controller_data = load_case_study_safe(selected_cs, run_by_mulo_designer=True)
        case_data = {}
        control_objective: str = DEFAULT_OBJECTIVES.get(selected_cs, "")

    # -- Advanced Settings -----------------------------------------------------
    with st.expander("âš™ï¸ Advanced Settings", expanded=False):
        col_l, col_r = st.columns(2)

        with col_l:
            llm_model: str = st.selectbox(
                "LLM Model",
                LLM_MODELS,
                index=0,  # "mock" first
                key="adv_llm_model",
                help="Language model used to propose GA configurations.",
            )
            max_attempts: int = st.number_input(
                "Max Attempts",
                min_value=1,
                max_value=20,
                value=5,
                step=1,
                key="adv_max_attempts",
                help="Maximum number of LLMâ€“GA iterations.",
            )
            buffer_size: int = st.number_input(
                "History Buffer Size",
                min_value=1,
                max_value=10,
                value=3,
                step=1,
                key="adv_buffer_size",
                help="Number of past attempts included in the LLM context.",
            )

            if not run_by_ga_agent_ui:
                enable_web_search = st.checkbox("ðŸ” Do you want to search online too?", value=False)

                if enable_web_search:
                    web_search_model = st.selectbox("Web Search Model (web_search_model)", WEB_SEARCH_MODEL_OPTIONS,
                                                    index=0)
                else:
                    web_search_model = None
            else:
                web_search_model = None

        user_input: str | None = st.text_area(
            label="Control Objective Statement (control_objective)",
            value=DEFAULT_OBJECTIVES.get(selected_cs, ""),
            width="stretch"
        )

        with col_r:
            max_wall_clock: float = st.number_input(
                "Max Wall Clock (s)",
                min_value=10.0,
                max_value=7_200.0,
                value=120.0,
                step=10.0,
                key="adv_wall_clock",
                help="Hard time budget for the entire experiment.",
            )
            max_cost_budget: float = st.number_input(
                "Max Cost Budget ($)",
                min_value=0.001,
                max_value=10.0,
                value=1.0,
                step=0.01,
                format="%.3f",
                key="adv_cost_budget",
                help="Hard LLM token-cost budget (USD).",
            )
            prompt_variant: str = st.selectbox(
                "Prompt Variant",
                ["elaborate", "concise"],
                key="adv_prompt_variant",
                help="Verbosity level of the prompt sent to the LLM.",
            )

    # # -- Chat input (pinned to bottom by Streamlit) ----------------------------
    st.markdown(
        "<p style='color:gray;font-size:0.9rem;margin-bottom:4px;'>"
        "âœï¸  Review or edit the control objective, then press <b>Enter</b> to start."
        "</p>",
        unsafe_allow_html=True,
    )
    # -- Chat input (pinned to bottom by Streamlit) --------------------------------
    # st.markdown(
    #     "<p style='color:gray;font-size:0.9rem;margin-bottom:4px;'>"
    #     "âœï¸  Review or edit the control objective, then press the button to start."
    #     "</p>",
    #     unsafe_allow_html=True,
    # )
    #
    # user_input_text = st.text_area(
    #     "Control Objective",
    #     value=control_objective,
    #     height=25,
    #     key="home_control_objective",
    #     label_visibility="collapsed"
    # )
    #
    # if st.button("ðŸš€ Start Experiment", type="primary", use_container_width=True):
    #     user_input = user_input_text
    # print(controller_data["system"])

    # -- Launch experiment on submit -------------------------------------------
    if not run_by_ga_agent_ui:
        st.markdown('<div id="red_btn"></div>', unsafe_allow_html=True)
    if st.button("ðŸ› ï¸ Initialize Controller Designer Profile", use_container_width=True) and user_input is not None:
        if run_by_ga_agent_ui:
            case_study_file = st.session_state.get("home_case_study", selected_cs)
        else:
            case_study_file = ""

        # Retrieve widget values from session_state (most reliable after submit)
        run_config: Dict[str, Any] = {
            "case_study_file": case_study_file,
            "case_data": case_data,
            "seed": 42,
            "control_objective": user_input.strip() or control_objective,
            "llm_model": st.session_state.get("adv_llm_model", llm_model),
            'web_search_model': web_search_model,
            "max_attempts": int(st.session_state.get("adv_max_attempts", max_attempts)),
            "buffer_size": int(st.session_state.get("adv_buffer_size", buffer_size)),
            "max_wall_clock": float(st.session_state.get("adv_wall_clock", max_wall_clock)),
            "max_cost_budget": float(
                st.session_state.get("adv_cost_budget", max_cost_budget)
            ),
            "prompt_variant": st.session_state.get("adv_prompt_variant", prompt_variant),
        }

        # Initialise shared state
        event_queue: queue.Queue = queue.Queue()
        st.session_state.event_queue = event_queue
        st.session_state.plot_data = empty_plot_data()
        st.session_state.run_config = run_config
        st.session_state.run_complete = False
        st.session_state.final_state = None
        st.session_state.pop("run_error", None)
        st.session_state.pop("run_error_tb", None)

        if run_by_ga_agent_ui:
            run_worker_ui(run_config)
        else:
            with st.spinner("Pre Processing some parameters..."):
                designer_instance = MuloControllerDesigner(
                    run_config=run_config,
                    controller_structure=controller_data["controller"],
                    system_identification=controller_data["system"],
                    trimming_result=controller_data["trimming"],
                    equation=controller_data["equation"],
                )

                # Persist engine state context
                st.session_state["designer"] = designer_instance

                # Advance stage and clear screen
                st.session_state["mulo_designer_stage"] = "edit_case_study"
                st.rerun()
        st.rerun()



def run_worker_ui(run_worker: callable = None) -> None:
    run_config = st.session_state["run_config"]
    event_queue: queue.Queue = st.session_state["event_queue"]

    # Start background worker thread
    if run_worker is None:
        thread = threading.Thread(
            target=_run_experiment_worker,
            args=(run_config, event_queue),
            daemon=True,
            name=f"ga-worker-{run_config['case_study_file']}",
        )
    else:
        thread = threading.Thread(
            target=run_worker,
            args=(st.session_state["designer"], event_queue),
            daemon=True,
            name=f"ga-worker",
        )

    thread.start()
    st.session_state.run_thread = thread

    # Navigate to project page immediately
    st.session_state.page = "project"
    st.rerun()


# -- Background worker ---------------------------------------------------------

def _run_experiment_worker(
    run_config: Dict[str, Any],
    event_queue: queue.Queue,
) -> None:
    """
    Runs inside a daemon thread.
    1. Registers a progress callback with the thread-local registry.
    2. Calls run_ga_handler (blocking).
    3. Emits 'run_complete' or 'run_error' when finished.
    """

    def _push(event: Dict[str, Any]) -> None:
        """Non-blocking put; silently drop if queue is unexpectedly full."""
        try:
            event_queue.put_nowait(event)
        except Exception:
            pass

    register_callback(_push)
    try:
        final_state = run_ga_handler(
            case_study_file=run_config["case_study_file"],
            tuning_specs=None,          # use case-study defaults
            llm_model=run_config["llm_model"],
            seed=42,
            run_id=1,
            max_attempts=run_config["max_attempts"],
            max_wall_clock=run_config["max_wall_clock"],
            max_cost_budget=run_config["max_cost_budget"],
            prompt_variant=run_config["prompt_variant"],
            buffer_size=run_config["buffer_size"],
            control_objective=run_config.get("control_objective"),  # â† new param
        )
        _push({"event_type": "run_complete", "final_state": final_state})
    except Exception as exc:
        _push({
            "event_type": "run_error",
            "error": str(exc),
            "traceback": _tb.format_exc(),
        })
    finally:
        unregister_callback()

