import streamlit as st
from pathlib import Path
import textwrap
import threading
import os
import json
from datetime import datetime
import time

# from app_auth import ensure_user_session, init_managers
from backend_api.SiloDesigner.app import (DesignMonitor, DummyMonitor, process_objective, get_serializable_monitor_state,
                                           run_design_with_monitoring, run_ga_optimization, DummySessionManager)
from backend_api.SiloDesigner.src.controllers import initialize_state
from frontend_streamlit.silo_designer_st_utls import (display_logo, create_advanced_settings, build_config_from_session,
                                                      display_time_response, CSS_STYLES, display_llm_responses, display_ga_results,
                                                      display_gains_plot, display_metrics_plots, display_current_metrics, display_progress_feed,
                                                      display_best_controller_report)


st.set_page_config(
    page_title="Control System Designer",
    page_icon="ðŸŽ›ï¸",
    layout="wide",
    initial_sidebar_state="expanded"
)
st.markdown(CSS_STYLES, unsafe_allow_html=True)


def define_session_states():
    # init_managers()
    # ensure_user_session()

    if 'session_manager' not in st.session_state:
        st.session_state.session_manager = DummySessionManager()

    # --- ADD THIS FIX FOR USER_ID ---
    if 'user_id' not in st.session_state:
        st.session_state.user_id = "local_developer_id"

    if 'current_session_id' not in st.session_state:
        st.session_state.current_session_id = None

    if 'monitor' not in st.session_state:
        st.session_state.monitor = DesignMonitor()

    if 'design_thread' not in st.session_state:
        st.session_state.design_thread = None

    if 'design_results' not in st.session_state:
        st.session_state.design_results = []

    if 'page' not in st.session_state:
        st.session_state.page = 'home'

    if 'show_advanced_settings' not in st.session_state:
        st.session_state.show_advanced_settings = False

    if 'pending_objective' not in st.session_state:
        st.session_state.pending_objective = None

    if 'pending_file' not in st.session_state:
        st.session_state.pending_file = None

    if 'design_auto_started' not in st.session_state:
        st.session_state.design_auto_started = False

    # NEW: GA-related session state
    if 'ga_results' not in st.session_state:
        st.session_state.ga_results = {}

    if 'ga_thread' not in st.session_state:
        st.session_state.ga_thread = None


def load_current_session():
    """Load current session data into streamlit state"""
    session_data = st.session_state.session_manager.load_session(
        st.session_state.user_id,
        st.session_state.current_session_id
    )

    if session_data:
        st.session_state.chat_history = session_data.get('chat_history', [])
        st.session_state.control_objective = session_data.get('control_objective', '')
        st.session_state.saved_config = session_data.get('config', {})
        st.session_state.session_survey = session_data.get('survey')

        # Restore monitor state
        monitor_state = session_data.get('monitor_state', {})
        st.session_state.monitor.state_history = monitor_state.get('state_history', [])
        st.session_state.monitor.llm_responses = monitor_state.get('llm_responses', [])
        st.session_state.monitor.current_state = monitor_state.get('current_state', {})
        st.session_state.monitor.progress_history = monitor_state.get('progress_history', [])
        st.session_state.monitor.scenario_metrics_history = monitor_state.get('scenario_metrics_history', [])  # NEW: Restore profiling history

        # Reset manual tuning state for the loaded session
        st.session_state.optimal_gains = {}
        st.session_state.manual_gains = {}
        st.session_state.test_mode = False

        # Load custom dynamics if exists
        dynamics_path = st.session_state.session_manager.load_custom_dynamics(
            st.session_state.user_id,
            st.session_state.current_session_id
        )
        if dynamics_path:
            st.session_state.custom_dynamics_path = dynamics_path
            st.session_state.uploaded_file_name = os.path.basename(dynamics_path).split('_', 1)[-1].replace(".py", "").replace(".m", "")
            # file_extension = dynamics_path.split('.')[-1]
            # st.session_state.file_type = "Python (.py)" if file_extension == "py" else "MATLAB/Octave (.m)"
            st.session_state.file_type = "Python (.py)"

            if 'custom_dynamics_path' not in st.session_state.saved_config:
                st.session_state.saved_config['custom_dynamics_path'] = dynamics_path

        # Recreate non-serializable objects using saved config
        if st.session_state.saved_config:
            try:
                dummy_monitor = DummyMonitor()

                # NEW: Filter out GA-specific keys before passing to initialize_state
                ga_keys = {'enable_ga', 'ga_config'}
                filtered_config = {k: v for k, v in st.session_state.saved_config.items() if k not in ga_keys}

                # Extract simulation parameters from config with defaults
                init_kwargs = {
                    **filtered_config,
                    'dt': st.session_state.saved_config.get('dt', 0.01),
                    'max_time': st.session_state.saved_config.get('max_time', 5.0),
                    'target': st.session_state.saved_config.get('target', 0.0),
                    'num_inputs': st.session_state.saved_config.get('num_inputs', 1),
                    'input_channel': st.session_state.saved_config.get('input_channel', 0),
                    'output_channel': st.session_state.saved_config.get('output_channel', 0),
                    # NEW: Add trim_values, num_states, matlab_func_name, min_ctrl, max_ctrl
                    'trim_values': st.session_state.saved_config.get('trim_values'),
                    'num_states': st.session_state.saved_config.get('num_states'),
                    'matlab_func_name': st.session_state.saved_config.get('matlab_func_name'),
                    'min_ctrl': st.session_state.saved_config.get('min_ctrl', -10.0),
                    'max_ctrl': st.session_state.saved_config.get('max_ctrl', 10.0),
                    'monitor': dummy_monitor
                }

                fresh_state = initialize_state(**init_kwargs)
                if fresh_state.get('simulator') is None:
                    st.error("âŒ Failed to create simulator")
                    return

                simulator = fresh_state.get('simulator')
                system = fresh_state.get('system')

                # Ensure simulator's internal system reference is set
                if simulator and system:
                    if hasattr(simulator, 'system') and simulator.system is None:
                        simulator.system = system

                # Get loaded current state for merging
                loaded_current = st.session_state.monitor.current_state

                # Merge loaded data into fresh state
                merge_keys = ['controller_type', 'current_params', 'results']
                for key in merge_keys:
                    if key in loaded_current:
                        fresh_state[key] = loaded_current[key]

                # Update with fresh objects
                loaded_current['system'] = system
                loaded_current['simulator'] = simulator

                # Store in session_state for direct access
                st.session_state.current_system = system
                st.session_state.current_simulator = simulator
                st.session_state.current_controller_type = loaded_current.get('controller_type')

                # Update last history entry
                if st.session_state.monitor.state_history:
                    last_state = st.session_state.monitor.state_history[-1]['state']
                    last_state['system'] = system
                    last_state['simulator'] = simulator

                    for key in merge_keys:
                        if key in loaded_current:
                            last_state[key] = loaded_current[key]

                # Set controller_type on simulator
                controller_type = loaded_current.get('controller_type')

                if simulator and controller_type:
                    simulator.controller_type = controller_type

                    # Prime the simulator with loaded optimal params
                    if 'current_params' in loaded_current:
                        optimal_params = {k: v for k, v in loaded_current['current_params'].items()
                                          if k != 'reasoning'}

                        try:
                            init_result = simulator.evaluate_parameters(optimal_params)
                            if init_result['success']:
                                fresh_state['results'] = init_result
                                loaded_current['results'] = init_result
                                if st.session_state.monitor.state_history:
                                    last_state['results'] = init_result
                        except Exception as init_e:
                            st.warning(f"âš ï¸ Simulator priming failed: {init_e}")

            except Exception as e:
                st.error(f"âŒ Failed to recreate system/simulator: {e}")
                import traceback
                st.code(traceback.format_exc(), language='python')



def display_home_page():
    """Display the home page with ChatGPT-like interface"""

    col1, col2, col3 = st.columns([1, 2, 1])

    if "__name__" == "__main__":
        with col2:
            _display_home_page()
    else:
        _display_home_page()


def _display_home_page():
    if __name__ == "__main__":
        display_logo()

        st.markdown("<br><br>", unsafe_allow_html=True)

    # Advanced settings toggle
    if st.button("âš™ï¸ Advanced Settings", width='stretch'):
        # for key in st.session_state:
        #     print(key)
        print(st.session_state.pending_file)
        st.session_state.show_advanced_settings = not st.session_state.show_advanced_settings
        st.rerun()

    # Show advanced settings if toggled
    if st.session_state.show_advanced_settings:
        with st.expander("ðŸ”§ Advanced Configuration", expanded=True, width='stretch'):
            print(st.session_state.file_type)
            config = create_advanced_settings(st.session_state.model)
            st.session_state.temp_config = config

    st.markdown("<br>", unsafe_allow_html=True)

    if __name__ == "__main__":
        # File uploader
        st.session_state.uploaded_file = st.file_uploader(
            "ðŸ“Ž Upload Custom Dynamics (Python .py or MATLAB .m)",
            type=["py", "m"],
            key="home_file_upload",
            help="Upload your system dynamics file"
        )

    # Show uploaded file content
    if st.session_state.uploaded_file is not None:
        st.session_state.file_name = st.session_state.uploaded_file.name
        if __name__ != "__main__":
            st.session_state.file_name = st.session_state.file_name.replace(".py", "").replace(".m", "")
        with st.expander(f"ðŸ“„ View: {st.session_state.file_name}", expanded=False):
            file_content = st.session_state.file_content
            st.code(file_content, language='python')

    # MATLAB file inputs
    matlab_func_name = None
    num_states = None
    if st.session_state.uploaded_file and st.session_state.file_name.endswith('.m'):
        matlab_func_name = st.text_input("MATLAB Function Name", "dynamics", key="home_matlab_func")
        num_states = st.number_input("Number of States", 1, 20, 4, step=1, key="home_num_states")

    # Chat input
    user_input = st.chat_input(
        "Describe your control objective and upload dynamics file...",
        key="home_chat_input"
    )

    # Process user input
    if user_input:
        if not st.session_state.uploaded_file:
            st.warning("âš ï¸ Please upload a dynamics file before submitting.")
        else:
            st.session_state.pending_objective = user_input
            st.session_state.pending_file = st.session_state.uploaded_file

            with st.spinner("ðŸ¤” Processing your objective with AI..."):
                refined_objective = process_objective(user_input)

                new_session_id = st.session_state.session_manager.create_session(
                    st.session_state.user_id,
                    title=user_input[:50] + ("..." if len(user_input) > 50 else "")
                )

                st.session_state.current_session_id = new_session_id

                file_extension = st.session_state.uploaded_file.name.split('.')[-1]
                custom_dynamics_path = st.session_state.session_manager.save_custom_dynamics(
                    st.session_state.user_id,
                    new_session_id,
                    st.session_state.uploaded_file.getvalue(),
                    st.session_state.uploaded_file.name
                )

                st.session_state.chat_history = [
                    {"role": "user", "content": user_input},
                    {"role": "assistant", "content": refined_objective}
                ]
                st.session_state.control_objective = refined_objective
                st.session_state.custom_dynamics_path = custom_dynamics_path
                # st.session_state.file_type = "Python (.py)" if file_extension == "py" else "MATLAB/Octave (.m)"
                st.session_state.file_type = "Python (.py)"

                if file_extension == "m":
                    st.session_state.matlab_func_name = matlab_func_name
                    st.session_state.num_states = num_states

                save_current_session()

                st.session_state.monitor = DesignMonitor()
                st.session_state.test_mode = False
                st.session_state.manual_gains = {}
                st.session_state.optimal_gains = {}
                st.session_state.ga_results = {}  # Reset GA results

                st.session_state.design_auto_started = True
                st.session_state.page = 'project'
                st.rerun()


def save_current_session():
    """Save current session data"""
    monitor_state = get_serializable_monitor_state(st.session_state.monitor)

    # Ensure config includes trim_values if available
    if 'saved_config' in st.session_state:
        if 'trim_values' in st.session_state.saved_config:
            # Convert to list for serialization if numpy array
            trim_vals = st.session_state.saved_config['trim_values']
            if hasattr(trim_vals, 'tolist'):
                st.session_state.saved_config['trim_values'] = trim_vals.tolist()

        # NEW: Ensure min_ctrl and max_ctrl are serialized as floats
        if 'min_ctrl' in st.session_state.saved_config:
            st.session_state.saved_config['min_ctrl'] = float(st.session_state.saved_config['min_ctrl'])
        if 'max_ctrl' in st.session_state.saved_config:
            st.session_state.saved_config['max_ctrl'] = float(st.session_state.saved_config['max_ctrl'])

    updates = {
        'chat_history': st.session_state.get('chat_history', []),
        'control_objective': st.session_state.get('control_objective', ''),
        'config': st.session_state.get('saved_config', {}),
        'monitor_state': monitor_state,
    }
    if st.session_state.get('session_survey'):
        updates['survey'] = st.session_state.session_survey
    st.session_state.session_manager.update_session(
        st.session_state.user_id,
        st.session_state.current_session_id,
        updates,
    )


def _display_sidebar_logo(logo_path_str: str, padding_style: str):
    """Helper to load and display the sidebar logo with specific padding and paths."""
    logo_path = Path(logo_path_str)
    if logo_path.exists():
        with open(logo_path, 'r') as f:
            logo_svg = f.read()
        logo_svg = logo_svg.replace('<svg', '<svg style="width:100%; height:auto; max-width:80px;"')
    else:
        # Fallback to default logo (scaled down)
        logo_svg = """
        <svg style="width:100%; height:auto; max-width:80px;" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="#1f77b4" opacity="0.2"/>
            <circle cx="100" cy="100" r="60" fill="#1f77b4" opacity="0.4"/>
            <circle cx="100" cy="100" r="40" fill="#1f77b4" opacity="0.6"/>
            <text x="100" y="110" font-size="24" font-weight="bold" 
                  text-anchor="middle" fill="#1f77b4">ðŸŽ›ï¸</text>
        </svg>
        """

    html_content = textwrap.dedent(f"""
        <div style='text-align: center; padding: {padding_style};'>
            <div style='max-width: 80px; margin: 0 auto;'>
                {logo_svg}
            </div>
        </div>
    """).strip()
    lines = html_content.splitlines()
    html_content = '\n'.join(line.lstrip() for line in lines)
    st.sidebar.markdown(html_content, unsafe_allow_html=True)


def _format_session_title(title: str, max_length: int = 30) -> str:
    """Helper to truncate session titles consistently."""
    return title[:max_length] + ("..." if len(title) > max_length else "")


def _switch_to_session_project(session_id):
    """Helper for the repeated session switching logic in the project sidebar."""
    save_current_session()
    # Reset monitor first
    st.session_state.monitor = DesignMonitor()
    # Load session
    st.session_state.current_session_id = session_id
    load_current_session()
    st.session_state.objective_streamed = True
    st.rerun()

# --- REFACTORED MAIN FUNCTIONS ---

def display_session_sidebar_project():
    """Display improved session sidebar for project page"""

    # Sidebar logo (small version) - at the very top of the sidebar
    _display_sidebar_logo("../assets/logo.svg", "0.5rem 0 1rem 0")

    # Add toggle state
    if 'show_session_actions' not in st.session_state:
        st.session_state.show_session_actions = False

    # Fixed header section
    with st.sidebar.container():
        if st.button("ðŸ  New Project", width='stretch', type="primary"):
            save_current_session()
            st.session_state.page = 'home'
            st.session_state.pending_objective = None
            st.session_state.pending_file = None
            st.session_state.show_advanced_settings = False
            st.session_state.objective_streamed = False
            st.rerun()

        st.divider()

    # Sessions section header with toggle
    col1, col2 = st.sidebar.columns([3, 1])
    with col1:
        st.subheader("ðŸ’¬ Recent Sessions")
    with col2:
        if st.button("âš™ï¸", help="Toggle edit actions"):
            st.session_state.show_session_actions = not st.session_state.show_session_actions
            st.rerun()

    # Scrollable sessions container
    with st.sidebar.container():
        sessions = st.session_state.session_manager.get_all_sessions(st.session_state.user_id)

        if sessions:
            for session in sessions:
                session_id = session['session_id']
                is_active = session_id == st.session_state.current_session_id
                display_title = _format_session_title(session['title'])

                # Session item
                if st.session_state.show_session_actions:
                    col1, col2, col3 = st.columns([6, 1, 1])
                    with col1:
                        if st.button(display_title, key=f"session_{session_id}", width='stretch', disabled=is_active):
                            if not is_active:
                                _switch_to_session_project(session_id)

                    with col2:
                        if st.button("âœï¸", key=f"rename_{session_id}", help="Rename"):
                            st.session_state.renaming_session = session_id

                    with col3:
                        if st.button("ðŸ—‘ï¸", key=f"delete_{session_id}", help="Delete"):
                            if not is_active:
                                st.session_state.session_manager.delete_session(
                                    st.session_state.user_id,
                                    session_id
                                )
                                st.rerun()
                else:
                    # Simple button without actions
                    if st.button(display_title, key=f"session_{session_id}", width='stretch', disabled=is_active):
                        if not is_active:
                            _switch_to_session_project(session_id)

                # Handle rename dialog
                if st.session_state.get('renaming_session') == session_id:
                    new_title = st.sidebar.text_input(
                        "New title:",
                        value=session['title'],
                        key=f"rename_input_{session_id}"
                    )
                    col_ok, col_cancel = st.sidebar.columns(2)
                    with col_ok:
                        if st.button("âœ”", key=f"confirm_rename_{session_id}"):
                            st.session_state.session_manager.rename_session(
                                st.session_state.user_id,
                                session_id,
                                new_title
                            )
                            del st.session_state.renaming_session
                            st.rerun()
                    with col_cancel:
                        if st.button("âœ—", key=f"cancel_rename_{session_id}"):
                            del st.session_state.renaming_session
                            st.rerun()
        else:
            st.sidebar.info("No previous sessions")

    st.sidebar.divider()

    # Export/Import buttons (fixed at bottom)
    st.sidebar.subheader("ðŸ’¾ Backup & Restore")

    col_exp, col_imp = st.sidebar.columns(2)

    with col_exp:
        if st.button("ðŸ“¤ Export", width='stretch'):
            export_data = st.session_state.session_manager.export_session(
                st.session_state.user_id,
                st.session_state.current_session_id
            )
            if export_data:
                st.sidebar.download_button(
                    "â¬‡ï¸ Download",
                    data= json.dumps(export_data, indent=2),
                    file_name=f"session_{st.session_state.current_session_id}.json",
                    mime="application/json",
                    width='stretch'
                )

    with col_imp:
        uploaded_session = st.file_uploader(
            "Import Session",
            type=['json'],
            key="import_session",
            label_visibility="collapsed",
        )
        if uploaded_session:
            try:
                import_data = json.load(uploaded_session)
                new_session_id = st.session_state.session_manager.import_session(
                    st.session_state.user_id,
                    import_data,
                )
                st.session_state.current_session_id = new_session_id
                load_current_session()
                st.sidebar.success("Imported session!")
                st.rerun()
            except Exception as e:
                st.sidebar.error(f"Import failed: {str(e)}")

    st.sidebar.subheader("ðŸ“ Session feedback")
    with st.sidebar.expander("Rate this design session", expanded=False):
        existing = st.session_state.get("session_survey") or {}
        rating = st.slider(
            "Overall satisfaction (1â€“5)",
            1,
            5,
            int(existing.get("rating", 3)),
            key="survey_rating",
        )
        comments = st.text_area(
            "Comments (optional)",
            value=existing.get("comments", ""),
            key="survey_comments",
        )
        if st.button("Save feedback", key="save_survey", width='stretch'):
            st.session_state.session_survey = {
                "rating": rating,
                "comments": comments.strip(),
                "submitted_at": datetime.now().isoformat(),
            }
            save_current_session()
            st.sidebar.success("Feedback saved.")


def display_session_sidebar_home():
    """Display simplified session history sidebar for home page"""

    # Sidebar logo (small version)
    _display_sidebar_logo("assets/logo.svg", "0.5rem 0")

    st.sidebar.title("ðŸ’¬ Session History")

    # Get all sessions
    sessions = st.session_state.session_manager.get_all_sessions(st.session_state.user_id)

    if sessions:
        for session in sessions:
            session_id = session['session_id']
            display_title = _format_session_title(session['title'])

            # Session button
            if st.sidebar.button(display_title, key=f"home_session_{session_id}", width='stretch'):
                # Reset monitor first
                st.session_state.monitor = DesignMonitor()
                st.session_state.test_mode = False
                st.session_state.manual_gains = {}
                st.session_state.optimal_gains = {}
                # Load session and switch to project page
                st.session_state.current_session_id = session_id
                load_current_session()
                st.session_state.page = 'project'
                st.rerun()
    else:
        st.sidebar.info("No previous sessions")


def display_project_page():
    """Display the project page with design results"""

    if 'scenarios' not in st.session_state:
        st.session_state.scenarios = []

    st.markdown("")
    with st.container():
        col1, col2 = st.columns([1, 20])
        with col1:
            st.markdown("ðŸ‘¤")
        with col2:
            st.markdown("**Your Request:**")
            if st.session_state.chat_history:
                st.markdown(
                    f'<div class="speech-bubble-user">{st.session_state.chat_history[0]["content"]}</div>',
                    unsafe_allow_html=True
                )

            if 'uploaded_file_name' in st.session_state:
                with st.expander(f"ðŸ“Ž Uploaded: `{st.session_state.uploaded_file_name}`"):
                    dynamics_path = st.session_state.get('custom_dynamics_path')
                    if dynamics_path and os.path.exists(dynamics_path):
                        with open(dynamics_path, 'r') as f:
                            file_content = f.read()
                            st.code(file_content,
                                    language='python' if dynamics_path.endswith('.py') else 'matlab')

    with st.container():
        col1, col2 = st.columns([1, 20])
        with col1:
            st.markdown("ðŸ•µï¸")
        with col2:
            st.markdown("**Refined Control Objective:**")
            if len(st.session_state.chat_history) > 1:
                if 'objective_streamed' not in st.session_state:
                    st.session_state.objective_streamed = False

                refined_text = st.session_state.chat_history[1]['content']

                if not st.session_state.objective_streamed:
                    placeholder = st.empty()
                    displayed_text = ""
                    for char in refined_text:
                        displayed_text += char
                        placeholder.markdown(
                            f'<div class="speech-bubble-assistant">{displayed_text}</div>',
                            unsafe_allow_html=True
                        )
                        time.sleep(0.01)
                    st.session_state.objective_streamed = True
                else:
                    st.markdown(
                        f'<div class="speech-bubble-assistant">{refined_text}</div>',
                        unsafe_allow_html=True
                    )

    st.markdown("")

    # Auto-trigger design process
    if st.session_state.get('design_auto_started', False) and not st.session_state.monitor.is_running:
        st.session_state.design_auto_started = False
        config = build_config_from_session()
        st.session_state.saved_config = config
        st.session_state.scenarios = config.get('custom_scenarios', [])
        save_current_session()

        st.session_state.test_mode = False
        st.session_state.manual_gains = {}
        st.session_state.optimal_gains = {}

        st.session_state.monitor = DesignMonitor()
        st.session_state.design_thread = threading.Thread(
            target=run_design_with_monitoring,
            args=(config, st.session_state.monitor),
            daemon=True
        )
        st.session_state.design_thread.start()

        # NEW: Start GA optimization if enabled
        if config.get('enable_ga', False) and config.get('ga_config'):
            st.session_state.ga_results = {'status': 'running'}
            st.session_state.ga_thread = threading.Thread(
                target=run_ga_optimization,
                args=(config, st.session_state.ga_results),
                daemon=True
            )
            st.session_state.ga_thread.start()

        st.rerun()

    # Control buttons
    col_btn1, col_btn2, col_btn3 = st.columns(3)
    with col_btn1:
        start_button = st.button("ðŸš€ Start Design Process", type="primary", width='stretch')
    with col_btn2:
        stop_button = st.button("ðŸ›‘ Stop Process", type="secondary", width='stretch')
    with col_btn3:
        # NEW: Show GA status
        if st.session_state.ga_results.get('status') == 'running':
            st.info("ðŸ§¬ GA Running...")
        elif st.session_state.ga_results.get('status') == 'complete':
            st.success("ðŸ§¬ GA Complete")
        elif st.session_state.ga_results.get('status') == 'error':
            st.error("ðŸ§¬ GA Error")

    # Status indicator
    if st.session_state.monitor.is_running:
        st.markdown('<p class="status-running">ðŸ”„ Design process is running...</p>', unsafe_allow_html=True)
    else:
        st.markdown('<p class="status-complete">â¸ï¸ Design process is idle</p>', unsafe_allow_html=True)

    # Tabs for different views
    tabs = st.tabs(["📈 Progress", "📊 Metrics", "🎚 Gains", "⏱️ Time Response",
                    "🕵️ LLM Agents", "🧬 GA Results", "⚙️ Config", "📋 Summary", "🏆 Best Controller"])

    with tabs[0]:  # Progress
        display_progress_feed()

    with tabs[1]:  # Metrics
        display_metrics_plots()

    with tabs[2]:  # Gains
        display_gains_plot()

    with tabs[3]:  # Time Response
        display_time_response()

    with tabs[4]:  # LLM Responses
        display_llm_responses()

    with tabs[5]:  # NEW: GA Results
        display_ga_results()

    with tabs[6]:  # Current Config
        if 'saved_config' in st.session_state:
            st.json(st.session_state.saved_config)

    with tabs[7]:  # Summary
        display_current_metrics()

    with tabs[8]:  # Best Controllers  ← ADD
        display_best_controller_report()

    # Handle start button
    if start_button and not st.session_state.monitor.is_running:
        config = build_config_from_session()
        st.session_state.saved_config = config
        st.session_state.scenarios = config.get('custom_scenarios', [])
        save_current_session()

        st.session_state.test_mode = False
        st.session_state.manual_gains = {}
        st.session_state.optimal_gains = {}

        st.session_state.monitor = DesignMonitor()
        st.session_state.design_thread = threading.Thread(
            target=run_design_with_monitoring,
            args=(config, st.session_state.monitor),
            daemon=True
        )
        st.session_state.design_thread.start()

        # NEW: Start GA if enabled
        if config.get('enable_ga', False) and config.get('ga_config'):
            st.session_state.ga_results = {'status': 'running'}
            st.session_state.ga_thread = threading.Thread(
                target=run_ga_optimization,
                args=(config, st.session_state.ga_results),
                daemon=True
            )
            st.session_state.ga_thread.start()

        st.rerun()

    # Handle stop button
    if stop_button and st.session_state.monitor.is_running:
        st.session_state.monitor.is_running = False
        st.warning("Design process stop requested...")
        st.rerun()

    # Auto-refresh while running
    if st.session_state.monitor.is_running or st.session_state.ga_results.get('status') == 'running':
        save_current_session()
        time.sleep(1)
        st.rerun()


def main():
    """Main Streamlit application with page routing"""
    define_session_states()

    # Determine which page to show
    if st.session_state.page == 'home':
        display_session_sidebar_home()
        display_home_page()
    else:  # project page
        display_session_sidebar_project()
        display_project_page()

    if "__name__" == "__main__":
        # Footer
        st.divider()
        st.markdown(
            """
            <div style='text-align: center; color: #6c757d;'>
                ðŸŽ›ï¸ AI-Powered Control System Design Studio | Agentic + GA Optimization | Powered by Streamlit
            </div>
            """,
            unsafe_allow_html=True
        )


if __name__ == "__main__":
    main()

