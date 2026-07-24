import json

import streamlit as st
import threading
import queue
import time
import os

from backend_api.Recommender.build_graph import build_graph
from backend_api.Recommender.pipeline_handoff import prepare_trimmer_handoff
from backend_api.Recommender.rag.completion import assess_rag_completion

from frontend_streamlit.st_utils import import_css_styling, show_upload_box, render_logs, make_serializable


# =============================================================================
# âš™ï¸ CONFIG & HELPER FUNCTIONS
# =============================================================================
# Make sure to import the wrapper at the top of your file
from backend_api.Recommender.build_graph import build_graph, run_recommender_workflow


def recommender_worker(graph, config, step, graph_input, q):
    """Runs the Recommender workflow synchronously on a background thread using the wrapper."""

    # Execute the wrapper, passing the queue so the UI still streams live updates
    summary = run_recommender_workflow(graph, config, graph_input, q)
    import pprint
    pprint.pprint(summary)

    if summary["success"]:
        # Pass the summary payload into the 'done' message so the main UI thread can access it
        q.put({"type": "done", "step": step, "summary": summary})
    elif summary["success"] and summary["error"] == "":
        # Pass the detailed error payload
        q.put({"type": "error", "content": summary["error"], "summary": summary})

def recommender_session_state():
    if "recommender_step" not in st.session_state:
        st.session_state.recommender_step = "upload"
        st.session_state.recommender_last_progress_point = 0
        st.session_state.recommender_logs = []
        st.session_state.outputs = {}
        st.session_state.rec_status_text = ""
    if "file_content" not in st.session_state:
        st.session_state.file_content = ""
    if "file_name" not in st.session_state:
        st.session_state.file_name = ""
    if "rec_queue" not in st.session_state:
        st.session_state.rec_queue = queue.Queue()
    if "rec_thread_running" not in st.session_state:
        st.session_state.rec_thread_running = False
        st.session_state.rag_model = "gpt-4o"
        st.session_state.rag_option = "OPENAI_WEB_SEARCH"
        st.session_state.rag_error_message = ""
        st.session_state.model = "gpt_os-120b"
        st.session_state.uploaded_file = None
        st.session_state.start_btn = None


def process_to_running(file_content_exist = False):
    try:
        if not file_content_exist:
            st.session_state.file_content = st.session_state.uploaded_file.read().decode("utf-8")
            st.session_state.file_name = os.path.splitext(st.session_state.uploaded_file.name)[0]

        # Activate both workflows
        st.session_state.recommender_step = "initial_run"

        # Reset progress markers and thread flags
        st.session_state.recommender_last_progress_point = 0
        st.session_state.rec_thread_running = False

        st.rerun()
    except UnicodeDecodeError:
        st.error("Error reading file. Please ensure it's a valid text file.")


def start_trimmer(choice = ""):
    st.session_state.global_step = "trimmer"
    st.session_state.trimmer_step = "operating_conditions"

    state_snapshot = st.session_state.recommender_graph.get_state(st.session_state.rec_config).values
    handoff = prepare_trimmer_handoff(state_snapshot, choice or None)

    st.session_state.file_content = handoff["file_content"]
    st.session_state.chosen_controller = handoff["chosen_controller"]
    st.session_state.trimming_params = handoff["trimming_params"]
    st.session_state.states_inputs = handoff["states_inputs"]

    st.rerun()


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
        recommender_session_state()

    if __name__ == "__main__":
        st.title("Control Designer Pro - Recommender Workspace")
        st.set_page_config(page_title="Control Designer Pro", layout="wide")
    upload_placeholder = st.empty()

    # =============================================================================
    # ðŸ“ STEP 1: SINGLE FILE UPLOAD
    # =============================================================================
    if st.session_state.recommender_step == "upload":

        with upload_placeholder.container():
            if __name__ == "__main__":
                options = ["gpt-oss-120b", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o"]
                show_upload_box(options)

                # --- NEW: User Prompt Input ---
                user_prompt = st.text_area(
                    "📝 Design Instructions (Optional)",
                    placeholder="e.g., Prioritize PID controllers over LQR, minimize overshoot..."
                )

                st.session_state.start_btn = st.button("⚡ Start Processing", use_container_width=True)
                if st.session_state.start_btn and st.session_state.uploaded_file:
                    # Save the user's prompt to session state before running
                    st.session_state.user_prompt = user_prompt
                    process_to_running()


        if __name__ == "__main__":
            st.markdown('<div class="footer">Control Designer Pro â€¢ Built with Streamlit â€¢ Powered by LangGraph</div>',
                        unsafe_allow_html=True)

    if st.session_state.recommender_step in ["initial_run", "rag_run"]:

        upload_placeholder.empty()

        status_text = "ðŸ” Running Recommender Logic..." if st.session_state.recommender_step == "initial_run" \
            else "ðŸ§  Enhancing with RAG..."
        st.subheader(status_text)

        if st.session_state.recommender_step in "rag_run":
            state_snapshot = st.session_state.recommender_graph.get_state(st.session_state.rec_config).values
            controller_json = state_snapshot["controller_json"]

            rec_tab1, rec_tab2, rec_tab3 = st.tabs(["ðŸ“Š Final Result", "ðŸ“‹ Activity Log", "ðŸ“œ Json Result"])
            with rec_tab3:
                for key, value in controller_json.items():
                    with st.expander(f"ðŸ” View Raw JSON Output ({key})"):
                        st.json(make_serializable(value))
        else:
            rec_tab1, rec_tab2 = st.tabs(["ðŸ“Š Process", "ðŸ“‹ Activity Log"])

        with rec_tab1:
            # We save progress and text to session state to survive reruns
            st.progress(st.session_state.get("rec_progress", 0))
            rec_status = st.empty()
            if "rec_status_text" in st.session_state:
                st.info(st.session_state.rec_status_text)
        with rec_tab2:
            rec_logs = st.container()
            # Render existing logs on rerun to prevent them from disappearing
            render_logs(rec_logs, st.session_state.recommender_logs)

        if "recommender_graph" not in st.session_state:
            rec_status.info("âš™ï¸ Initializing Recommender graph...")
            st.session_state.recommender_graph = build_graph(st.session_state.model)
            st.session_state.rec_config = {"configurable": {"thread_id": "1"}}

    # Phase 2: Review Initial Output
    elif st.session_state.recommender_step == "review":
        st.subheader("âœ… Recommender Initial Processing Complete")
        rec_tab1, rec_tab2, rec_tab3 = st.tabs(["ðŸ“Š Final Result", "ðŸ“‹ Activity Log", "ðŸ“œ Json Result"])
        with rec_tab3:
            with st.expander("ðŸ” View Raw JSON Output"):
                st.json(make_serializable(st.session_state.recommender_logs[-2]["log_history"]))
        with rec_tab1:
            if st.session_state.rag_error_message != "":
                st.error(st.session_state.rag_error_message)
            col1, col2, col3 = st.columns([1, 3, 1])
            if os.path.exists(f"results/{st.session_state.file_name}_controller_graph_Initial.png"):
                with col2:
                    st.image(f"results/{st.session_state.file_name}_controller_graph_Initial.png",
                             caption="Generated Controller Graph", width='stretch')
            else:
                st.error("âŒ Result image not found on disk.")

            col1, col2 = st.columns(2)
            with col1:
                if st.button("ðŸŽ¯ Satisfied â€“ Start Trimmer", use_container_width=True):
                    start_trimmer()
                options = {"OPENAI_WEB_SEARCH": "Web Search API",
                           "BLOCK_DIAGRAM_SEARCH": "Block Diagram Search"}
                st.session_state.rag_option = st.multiselect(
                    "RAG Model",
                    options=list(options.keys()),
                    format_func=lambda x: options[x],
                    help="""
                        **Web Search API:**  
                        Uses LLM model own web search api for finding texts with useful information inside trusted sources.

                        **Block Diagram Search:**  
                        Searches in scientific sources and looks for block diagrams that may represent your system
                        """
                )

            with col2:
                if st.button("ðŸ§  Continue with RAG Enhancement", use_container_width=True):
                    st.session_state.recommender_graph.update_state(
                        st.session_state.rec_config,
                        {"RAG_decision": {"Flag": st.session_state.rag_option, "Model": st.session_state.rag_model}},
                        as_node="human_review"
                    )
                    st.session_state.recommender_step = "rag_run"
                    st.session_state.rec_thread_running = False  # Allow thread to restart
                    st.rerun()
                st.session_state.rag_model = st.selectbox(
                    "LLM Model",
                    ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o"],
                    index=3,
                    help='Choose a LLM Model to work with.'
                )
        with rec_tab2:
            render_logs(st.container(), st.session_state.recommender_logs)

    # Phase 3: RAG Comparison
    elif st.session_state.recommender_step == "comparison":
        state_snapshot = st.session_state.recommender_graph.get_state(st.session_state.rec_config).values
        controller_graph = state_snapshot["controller_graph"]
        controller_json = state_snapshot["controller_json"]

        st.subheader("ðŸ”¬ Comparison: Initial vs. RAG Enhanced")
        rec_tab1, rec_tab2, rec_tab3 = st.tabs(["ðŸ“Š Final Result", "ðŸ“‹ Activity Log", "ðŸ“œ Json Result"])
        with rec_tab1:
            col1, col2 = st.columns(2)
            colLeft = True
            with col1:
                if os.path.exists(f"results/{st.session_state.file_name}_controller_graph_Initial.png"):
                    st.image(f"results/{st.session_state.file_name}_controller_graph_Initial.png",
                             caption="ðŸ“Œ Original Output",width='stretch')
            for key, value in controller_graph.items():
                col = col2 if colLeft else col1
                with col:
                    if os.path.exists(value) and key != "Initial_controller":
                        st.image(value, caption=f"âœ¨ {key} Enhanced Output", width='stretch')
                        colLeft = not colLeft

            st.markdown("---")
            ops = {key.replace("_controller", ""): key for key in controller_json.keys()}
            choice = st.radio("Which output was more satisfying?", ops.keys(), horizontal=True)
            if st.button("ðŸ’¾ Save Choice - Start Trimmer", width='stretch'):
                start_trimmer(controller_json[ops[choice]])
        with rec_tab3:
            for key, value in controller_json.items():
                with st.expander(f"ðŸ” View Raw JSON Output {key}"):
                    st.json(make_serializable(value))
        with rec_tab2:
            render_logs(st.container(), st.session_state.recommender_logs)

    if (st.session_state.recommender_step in ["initial_run", "rag_run"]):

        # 1. Start Recommender Background Thread
        if not st.session_state.rec_thread_running:
            graph_input = (
                {
                    "equation": st.session_state.file_content,
                    "file_name": st.session_state.file_name,
                    "user_prompt": st.session_state.get("user_prompt", ""),  # <--- NEW: Pass to graph
                    "messages": []
                }
                if st.session_state.recommender_step == "initial_run" else None
            )
            st.session_state.recommender_logs.append({"agent_tag": "ðŸ“.Equation", "log_history": st.session_state.file_content})
            st.session_state.rec_thread_running = True
            threading.Thread(
                target=recommender_worker,
                args=(st.session_state.recommender_graph, st.session_state.rec_config,
                      st.session_state.recommender_step, graph_input, st.session_state.rec_queue),
                daemon=True
            ).start()

        # 3. Poll Recommender Queue
        while not st.session_state.rec_queue.empty():
            msg = st.session_state.rec_queue.get()
            if msg["type"] == "stream":
                mode, content = msg["mode"], msg["content"]
                if mode == "updates" and list(content.keys())[0] == "__interrupt__":
                    rec_status.warning("â¸ï¸ Recommender: Waiting for input...")
                elif mode == "custom":
                    if "log_history" in content:
                        st.session_state.recommender_logs.append(content)
                    elif "progress" in content:
                        st.session_state.rec_progress = content["progress"]
                        st.session_state.rec_status_text = content["text"]
            elif msg["type"] == "done":
                st.session_state.rec_thread_running = False
                if msg["step"] == "initial_run":
                    st.session_state.recommender_step = "review"
                else:
                    rag_status = assess_rag_completion(st.session_state.file_name)
                    st.session_state.rag_error_message = rag_status["error_message"]
                    st.session_state.recommender_step = rag_status["next_step"]
            elif msg["type"] == "error":
                st.session_state.rec_thread_running = False
                rec_status.error(f"Recommender Error: {msg['content']}")
            st.rerun()

        # 5. Continuous UI Update Loop
        # If either thread is still running, briefly sleep to avoid maxing out CPU, then rerun
        if st.session_state.rec_thread_running:
            time.sleep(0.1)
            st.rerun()

