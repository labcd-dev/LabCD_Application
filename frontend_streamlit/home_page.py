import streamlit as st

import frontend_streamlit.trimmer_ui as trimmer_ui
import frontend_streamlit.recommender_ui as recommender_ui
from frontend_streamlit.home_page_style import import_home_page_css_style
from frontend_streamlit.silo_designer_ui import display_logo, main
from frontend_streamlit.regularizer_ui import define_upload_session_states, show_upload_box_with_llm

st.set_page_config(
    page_title="LabCD - Control Design",
    page_icon="assets/logo.svg",
    layout="wide",
    initial_sidebar_state="expanded"
)

error = ""

# Initialize all session states
if not "global_step" in st.session_state:
    st.session_state.global_step = "upload"
if "selected_pipeline" not in st.session_state:
    st.session_state.selected_pipeline = None
recommender_ui.recommender_session_state()
trimmer_ui.trimmer_session_state()
define_upload_session_states()

recommender_ui.import_css_styling()
import_home_page_css_style()

display_logo()

setup_placeholder = st.empty()

# --- SETUP UI BLOCK ---
# --- SETUP UI BLOCK ---
if st.session_state.get("page", "home") == "home" and st.session_state.global_step == "upload":
    with setup_placeholder.container():
        if st.session_state.selected_pipeline == "muloDesign":
            llm_options = [#"gpt-oss-120b",
                           "gpt-4o", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]
        else:
            llm_options = [#"gpt-oss-120b",
                           "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4o", "gpt-4o-mini"]

        file_is_ready = show_upload_box_with_llm(llm_options)

        # 2. If the function returns True (file uploaded), show success and the Start button
        if file_is_ready:
            if st.session_state.human_intervention:
                st.session_state.human_intervention = False
                st.session_state.change_applied = False
                st.session_state.stage = "processing"
                st.rerun()
            setup_placeholder.empty()

            if st.session_state.selected_pipeline == "muloDesign":
                st.session_state.global_step = "recommender"
                recommender_ui.process_to_running(True)
            elif st.session_state.selected_pipeline == "siloDesign":
                setup_placeholder.empty()
                st.session_state.global_step = "siloDesign"

        if st.session_state.stage == "upload":
            col1, col2 = st.columns(2)

            with col1:
                st.markdown('<div id="tune-btn-marker"></div>', unsafe_allow_html=True)
                if st.button("🎛️ Single Loop Control Design", use_container_width=True):
                    st.session_state.selected_pipeline = "siloDesign"
                    st.rerun()

            with col2:
                st.markdown('<div id="design-btn-marker"></div>', unsafe_allow_html=True)
                if st.button("💡 Multi Loop Control Design", use_container_width=True):
                    st.session_state.selected_pipeline = "muloDesign"
                    st.rerun()

            if st.session_state.selected_pipeline != None:
                # --- NEW: User Prompt Input ---
                user_prompt = st.text_area(
                    "📝 Design Instructions (Optional)",
                    placeholder="e.g., Prioritize PID tuning algorithms, explore cascaded loops, or define MIMO architectures..."
                )

                st.markdown('<div id="blue_btn"></div>', unsafe_allow_html=True)
                # st.markdown('<div id="design-btn-marker"></div>', unsafe_allow_html=True)
                if st.button("⚡️ Start Process", type="primary",
                             use_container_width=True) and st.session_state.uploaded_file is not None:
                    # --- NEW: Save the user prompt to session state before processing ---
                    st.session_state.user_prompt = user_prompt

                    st.session_state.stage = "processing"
                    st.session_state.edit_mode = False
                    st.rerun()
                    # if st.session_state.selected_pipeline == "muloDesign":
                    #     st.session_state.stage = "processing"
                    #     st.session_state.edit_mode = False
                    #     st.rerun()
                    # elif st.session_state.selected_pipeline == "siloDesign":
                    #     setup_placeholder.empty()
                    #     st.session_state.global_step = "siloDesign"


# --- 3. Fill container safely ---
ui_container = st.container()

if 'ui_container' in locals():
    with ui_container:
        if st.session_state.global_step == "recommender":
            recommender_ui.run_app()
        elif st.session_state.global_step == "trimmer":
            trimmer_ui.run_app()
        elif st.session_state.global_step == "siloDesign":
            main()

else:
    if st.session_state.global_step == "recommender":
        recommender_ui.run_app()
    elif st.session_state.global_step == "trimmer":
        trimmer_ui.run_app()
    elif st.session_state.global_step == "siloDesign":
        main()

if error != "":
    st.warning(error)

st.divider()
st.markdown(
    """
    <div style='text-align: center; color: #6c757d;'>
        🎛️ AI-Powered Control System Design Studio | Agentic + GA Optimization | Powered by Streamlit
    </div>
    """,
    unsafe_allow_html=True
)