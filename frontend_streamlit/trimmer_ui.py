import streamlit as st
import numpy as np
import json
import logging
from datetime import datetime
import os
import re
import threading
import queue
import time

from backend_api.Trimmer.build_graph import build_workflow_graph, run_trimmer_workflow
from backend_api.Trimmer.functionalNodes.create_controller_graph import Plotter
from backend_api.Trimmer.pdf_generator import generate_pdf_report
from backend_api.Trimmer.services.human_input import (
    HumanInputRequired,
    normalize_human_answer,
    parse_prompt_options,
)
from backend_api.Trimmer.workflow_helpers import build_trimmer_initial_state, finalize_trimmer_run
from backend_api.Trimmer.agenticNodes.agents import Agents

from frontend_streamlit.st_utils import import_css_styling, show_upload_box, render_logs, make_serializable


# =============================================================================
# 🚀 THREAD WORKERS (Background Execution)
# =============================================================================
def trimmer_worker(graph, initial_state, q):
    """Runs the Trimmer workflow synchronously on a background thread using the wrapper."""

    config = {"configurable": {"thread_id": "1"}}
    summary = run_trimmer_workflow(graph, initial_state, q, config)
    import pprint
    pprint.pprint(summary)

    # Route the queue messages based on the standardized wrapper output
    if summary["error"] != "":
        return
    elif summary["flag"] == "human_input":
        q.put({"type": "human_input", "content": summary["pending_request"], "summary": summary})
    elif summary["success"]:
        q.put({"type": "done", "summary": summary})
    else:
        q.put({"type": "error", "content": summary["error"], "summary": summary})


def trimmer_session_state():
    if "trimmer_step" not in st.session_state:
        st.session_state.trimmer_step = "upload"
        st.session_state.trimmer_last_progress_point = 0
        st.session_state.trim_status_text = ""
        st.session_state.pending_request = {}
        st.session_state.ui_inputs = {}
        st.session_state.artifacts = {}
        st.session_state.trimmer_logs = []
        st.session_state.plot_generated = False
        st.session_state.final_values = {}

    if "file_content" not in st.session_state:
        st.session_state.file_content = ""
    if "file_name" not in st.session_state:
        st.session_state.file_name = ""
    # Threading queues and flags
    if "trim_queue" not in st.session_state:
        st.session_state.trim_queue = queue.Queue()
    if "trim_thread_running" not in st.session_state:
        st.session_state.trim_thread_running = False
        st.session_state.model = "gpt_os-120b"
        st.session_state.uploaded_file = None
        st.session_state.start_btn = None


def process_to_running(file_content_exist = False):
    try:
        if not file_content_exist:
            st.session_state.file_content = st.session_state.uploaded_file.read().decode("utf-8")
            st.session_state.file_name = os.path.splitext(st.session_state.uploaded_file.name)[0]

        # Activate both workflows
        st.session_state.trimmer_step = "processing"

        # Reset progress markers and thread flags
        st.session_state.trimmer_last_progress_point = 0
        st.session_state.trim_thread_running = False

        st.rerun()
    except UnicodeDecodeError:
        st.error("Error reading file. Please ensure it's a valid text file.")


def run_app():
    # =============================================================================
    # ðŸŽ¨ THEME-AWARE CSS
    # =============================================================================
    if __name__ == "__main__":
        import_css_styling()

    # =============================================================================
    # ðŸš€ SESSION STATE INITIALIZATION
    # =============================================================================
    if __name__ == "__main__":
        trimmer_session_state()

    if __name__ == "__main__":
        st.title("Control Designer Pro - Trimmer Workspace")
        st.set_page_config(page_title="Control Designer Pro", layout="wide")
    upload_placeholder = st.empty()

    # =============================================================================
    # ðŸ“ STEP 1: SINGLE FILE UPLOAD
    # =============================================================================
    if st.session_state.trimmer_step == "upload":

        with upload_placeholder.container():
            if __name__ == "__main__":
                options = ["gpt-oss-120b", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o"]
                show_upload_box(options)
                st.session_state.start_btn = st.button("âš¡ Start Processing", use_container_width=True)
                if st.session_state.start_btn and st.session_state.uploaded_file:
                    process_to_running()


        if __name__ == "__main__":
            st.markdown('<div class="footer">Control Designer Pro â€¢ Built with Streamlit â€¢ Powered by LangGraph</div>',
                        unsafe_allow_html=True)


    base_dir = os.path.dirname(os.path.abspath(__file__))

    if st.session_state.trimmer_step == "operating_conditions":
        with upload_placeholder.container():
            state_inputs = st.session_state.states_inputs
            st.title("ðŸ”¢ Specify Operating Point")
            st.markdown(
                "Select parameters from the list below to apply conditions to, then assign a valid floating-point number to each."
            )

            # Use checkboxes for multiple selection with preselection
            if state_inputs:
                selected_params = []
                cols = st.columns(len(state_inputs))  # One column per checkbox

                for idx, param in enumerate(state_inputs):
                    with cols[idx]:
                        # Check if param is already in trimming_params
                        is_checked = param in st.session_state.trimming_params
                        if st.checkbox(param, key=f"checkbox_{param}", value=is_checked):
                            selected_params.append(param)

                # Update session state with selected parameters
                st.session_state.trimming_params = selected_params
            else:
                st.warning("âš  No parameters available in state_inputs. Please add parameters first.")

            current_keys = st.session_state.trimming_params

            st.divider()
            st.subheader("ðŸ”§ Operating Conditions")
            st.markdown("Assign Floating Point Values to each operating parameter")

            parsed_values = {}
            has_errors = False

            if current_keys:
                col1, col2 = st.columns([1, 2])
                for i, key in enumerate(current_keys):
                    with col1:
                        st.markdown(f"**`{key}`**", help=f"Key index {i + 1}")
                    with col2:
                        user_val = st.text_input(
                            label=f"Value for {key}",
                            value="0.0",
                            key=f"input_val_{key}_{i}",
                            label_visibility="collapsed"
                        ).strip()

                        try:
                            parsed_values[key] = float(user_val)
                        except ValueError:
                            has_errors = True

            submit_disabled = has_errors or len(current_keys) == 0

            st.markdown('<div id="tune-btn-marker"></div>', unsafe_allow_html=True)
            if st.button("ðŸš€ Start Trimming Process", type="primary", disabled=submit_disabled, width='stretch'):
                st.session_state.trimming_params = parsed_values
                st.session_state.trimmer_step = "processing"
                st.rerun()

            if not current_keys:
                st.warning("âš  Please select at least one parameter to generate inputs.")
            elif has_errors:
                st.error(f"âŒ Invalid floating-point number entered.")

    if st.session_state.trimmer_step == "processing":
        upload_placeholder.empty()

        st.subheader("ðŸ” Running Trimmer Logic...")
        trim_tab1, trim_tab2 = st.tabs(["ðŸ“Š Process", "ðŸ“‹ Activity Log"])

        with trim_tab1:
            st.progress(st.session_state.get("trimmer_last_progress_point", 0))
            trim_status = st.empty()
            if "trim_status_text" in st.session_state:
                st.info(st.session_state.trim_status_text)
        with trim_tab2:
            trim_logs = st.container()
            render_logs(trim_logs, st.session_state.trimmer_logs)

        if "trimmer_graph" not in st.session_state:
            trim_status.info("âš™ï¸ Initializing Trimmer graph...")
            session_timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            log_dir = os.path.join(base_dir, "logs")
            os.makedirs(log_dir, exist_ok=True)

            logging.basicConfig(filename=os.path.join(log_dir, f"session_langraph_{session_timestamp}.log"),
                                level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
            st.session_state.logger = logging.getLogger(__name__)
            st.session_state.trimmer_graph = build_workflow_graph(st.session_state.model)

    # Phase 2: Human in the loop
    elif st.session_state.trimmer_step == "human_input":
        pending = st.session_state.pending_request
        col_right = st.empty()

        with st.form("human_input_form", clear_on_submit=False):
            st.subheader("â¸ï¸ Trimmer Input Required")
            prompt = (pending.get("prompt") or "").strip()
            if prompt:
                st.code(prompt)

            options = parse_prompt_options(prompt)
            if options:
                answer = st.radio("Select an option", options, index=0, key=f"answer_{pending['key']}")
                submitted = st.form_submit_button("Continue Trimmer Workflow")
            else:
                answer = st.text_input("Your input (numbers only)", value=str(pending.get("default", "1")),
                                       key=f"answer_{pending['key']}")
                submitted = st.form_submit_button("Continue Trimmer Workflow")
                if submitted:
                    try:
                        float(answer)
                    except ValueError:
                        st.warning("âš ï¸ Please enter a valid number!")
                        submitted = False

        if submitted:
            st.session_state.ui_inputs[pending["key"]] = normalize_human_answer(prompt, answer)
            st.session_state.pending_request = None
            st.session_state.trimmer_step = "processing"
            st.session_state.trim_thread_running = False # Reset thread flag to start again
            st.rerun()

    # Phase 3: Review Results
    elif st.session_state.trimmer_step == "review":
        st.subheader("âœ… Trimmer Workflow Complete")
        artifacts = st.session_state.artifacts

        trim_tab1, trim_tab2, trim_tab3 = st.tabs(["ðŸ“Š Final Result", "âš™ï¸ Time Response", "ðŸ“‹ Log History"])

        with trim_tab3:
            render_logs(st.container(), st.session_state.trimmer_logs)

        with trim_tab1:
            st.success("Results successfully generated")
            with st.expander("ðŸ” View Raw JSON Output"):
                st.json(make_serializable(artifacts.get("result", {})))

        with trim_tab2:
            if artifacts.get("pdf_file"):
                if st.button("ðŸ“ˆ Generate Time Response Plot", use_container_width=True):
                    with st.spinner("Generating visualization..."):
                        try:
                            x_e = np.array(artifacts['result']['equilibrium']['x_e'])
                            u_e = np.array(artifacts['result']['equilibrium']['u_e'])
                            plotter = Plotter(artifacts['config']['system_f'], artifacts['config']['params'],
                                              x_e, u_e)
                            plot_file = os.path.join(artifacts["output_dir"],
                                                     f"{st.session_state.file_name}_response_langraph.png")

                            plotter.plot_time_response(np.linspace(0, 50, 1000),
                                                       x_e + 0.01 * np.random.randn(len(x_e)),
                                                       artifacts['config']['state_vars'], save_path=plot_file)
                            # st.image(plot_file, caption="Time Response Simulation")
                            st.session_state.plot_generated = True
                        except Exception as e:
                            st.error(f"Failed to generate plot: {e}")
                if st.session_state.get("plot_generated", False):
                    plot_file = os.path.join(artifacts["output_dir"],
                                             f"{st.session_state.file_name}_response_langraph.png")
                    if os.path.exists(plot_file):
                        st.image(plot_file, caption="Time Response Simulation")

    # -------------------------------------------------------------------------
    # âš™ï¸ CONCURRENT EXECUTION BRIDGE (Main Thread UI Polling)
    # -------------------------------------------------------------------------
    if st.session_state.trimmer_step == "processing":

        # 2. Start Trimmer Background Thread
        if not st.session_state.trim_thread_running:
            initial_state = build_trimmer_initial_state(
                st.session_state.trimming_params,
                st.session_state.file_content,
                st.session_state.logger,
                st.session_state.ui_inputs or {},
            )
            st.session_state.trim_thread_running = True
            threading.Thread(
                target=trimmer_worker,
                args=(st.session_state.trimmer_graph, initial_state, st.session_state.trim_queue),
                daemon=True
            ).start()

        # 4. Poll Trimmer Queue
        while not st.session_state.trim_queue.empty():
            msg = st.session_state.trim_queue.get()
            if msg["type"] == "stream":
                mode, content = msg["mode"], msg["content"]
                if mode == "values":
                    st.session_state.final_values = content
                elif mode == "updates" and list(content.keys())[0] == "__interrupt__":
                    trim_status.warning("â¸ï¸ Trimmer: Waiting for input...")
                elif mode == "custom":
                    if "log_history" in content:
                        st.session_state.trimmer_logs.append(content)
                    elif "progress" in content:
                        st.session_state.trimmer_last_progress_point = content["progress"]
                        st.session_state.trim_status_text = content["text"]
            elif msg["type"] == "human_input":
                st.session_state.trim_thread_running = False
                st.session_state.pending_request = msg["content"]
                st.session_state.trimmer_step = "human_input"
            elif msg["type"] == "done":
                st.session_state.trim_thread_running = False
                # Fast I/O and processing executed synchronously on the main thread after completion
                try:
                    output_dir = os.path.join(base_dir, "results")
                    st.session_state.artifacts = finalize_trimmer_run(
                        st.session_state.final_values,
                        st.session_state.file_name,
                        output_dir,
                    )
                    result = st.session_state.artifacts["result"]

                    if "error" in result:
                        st.error(f"Workflow Error: {result['error']}")
                    else:
                        st.session_state.trimmer_step = "review"
                except Exception as e:
                    trim_status.error(f"Post-processing Error: {e}")
            elif msg["type"] == "error":
                st.session_state.trim_thread_running = False
                print(msg)
                trim_status.error(f"Trimmer Error: {msg['content']}")
            st.rerun()

        # 5. Continuous UI Update Loop
        # If either thread is still running, briefly sleep to avoid maxing out CPU, then rerun
        if st.session_state.trim_thread_running:
            time.sleep(0.1)
            st.rerun()

    # if st.session_state.trimmer_step == "review" and st.session_state.recommender_step in ["comparison", "review"]:
    #     st.markdown("<hr>", unsafe_allow_html=True)
    #     col1, col2, col3 = st.columns([1, 8, 1])  # Clean proportions centering the UI
    #
    #     with col2:
    #         artifacts = st.session_state.get("artifacts", {})
    #         pdf_path = artifacts.get("pdf_file")
    #
    #         pdf_exists = pdf_path and os.path.exists(pdf_path)
    #
    #         if st.button("âš™ï¸ Generate Final PDF Report", use_container_width=True, type="primary"):
    #             with st.spinner("Generating PDF layout and compiling elements..."):
    #                 state_snapshot = st.session_state.recommender_graph.get_state(st.session_state.rec_config).values
    #                 controller_graph = state_snapshot["controller_graph"]
    #                 controller_json = state_snapshot["controller_json"]
    #                 system_identification = state_snapshot["system_identification"]
    #
    #                 result = artifacts.get("result", {})
    #                 config = artifacts.get("config", {})
    #
    #                 narratives_agent = Agents(model_name=st.session_state.model)
    #                 narratives = narratives_agent.generate_narratives(result, config, system_identification, controller_json)
    #                 # print(narratives)
    #
    #                 response_graph = os.path.join(artifacts["output_dir"],f"{st.session_state.file_name}_response_langraph.png")
    #
    #                 generate_pdf_report(artifacts["result"], artifacts["config"], controller_graph, response_graph, pdf_path, narratives)
    #                 st.rerun()
    #         if pdf_exists:
    #             with open(pdf_path, "rb") as file:
    #                 st.download_button(
    #                     label="ðŸ“¥ Download PDF Report",
    #                     data=file,
    #                     file_name=os.path.basename(pdf_path),
    #                     mime="application/pdf",
    #                     use_container_width=True,
    #                     type="primary"
    #                 )

