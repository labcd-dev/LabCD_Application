import streamlit as st

from backend_api.common.serialization import is_json_mapping, make_serializable


def import_css_styling():
    st.markdown("""
    <style>
        .main, .stApp { background: linear-gradient(145deg, var(--background-color), var(--secondary-background-color)); }
        h1, h2, h3 { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 600; color: var(--text-color); }
        .stButton > button { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; border: none; border-radius: 12px; padding: 0.6rem 1.5rem; font-weight: 500; letter-spacing: 0.3px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: all 0.2s ease; position: relative !important; overflow: hidden !important; }
        .stButton > button:hover { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); transform: translateY(-2px); }
        .stButton > button::before { content: '' !important; position: absolute !important; top: 0 !important; left: -100% !important; width: 100% !important; height: 100% !important; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent) !important; transition: left 0.5s !important; }
        .stButton > button:hover::before { left: 100% !important; }
        .stTabs [data-baseweb="tab-list"] { gap: 2rem; background: var(--secondary-background-color); padding: 0.5rem 2rem; border-radius: 50px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .stTabs [data-baseweb="tab"] { font-weight: 600; color: var(--text-color); transition: color 0.2s; }
        .stTabs [aria-selected="true"] { color: #1e3c72 !important; border-bottom: 3px solid #2a5298; }
        .stFileUploader { border: 2px dashed color-mix(in srgb, var(--text-color) 30%, transparent); border-radius: 24px; padding: 2rem; background: var(--secondary-background-color); transition: all 0.2s ease; }
        .stFileUploader:hover { border-color: var(--primary-color); transform: translateY(-2px); }
        .stImage img { border-radius: 16px; box-shadow: 0 12px 28px rgba(0,0,0,0.08); border: 1px solid color-mix(in srgb, var(--text-color) 10%, transparent); }
        hr { margin: 1.5rem 0; border: 0; height: 1px; background: linear-gradient(to right, transparent, color-mix(in srgb, var(--text-color) 20%, transparent), transparent); }
        .footer { text-align: center; color: var(--text-color); opacity: 0.6; font-size: 0.8rem; margin-top: 3rem; padding: 1rem; border-top: 1px solid color-mix(in srgb, var(--text-color) 20%, transparent); }
        pre { background: var(--background-color) !important; color: var(--text-color) !important; border-radius: 12px; padding: 1rem; border: 1px solid color-mix(in srgb, var(--text-color) 10%, transparent); }
        div.element-container:has(#upload-row-marker) + div.element-container div[data-testid="stHorizontalBlock"] { gap: 0px !important; }
        div.element-container:has(#upload-selectbox-marker) + div.element-container div[data-testid="stSelectbox"] { margin-top: 15px !important; }
        div.element-container:has(#upload-selectbox-marker) + div.element-container div[data-testid="stSelectbox"] div[data-baseweb="select"] > div { min-height: 70px !important; border-radius: 10px !important; cursor: pointer !important; box-shadow: none !important; }
        div.element-container:has(#upload-selectbox-marker) + div.element-container div[data-testid="stSelectbox"] div[data-baseweb="select"] > div > div:first-child { display: flex !important; padding-left: 16px !important; padding-top: 20px !important; height: 100% !important; font-size: 1.1rem; }
    </style>
    """, unsafe_allow_html=True)


def is_json(s):
    return is_json_mapping(s)


# =============================================================================
# 🧩 HELPER FUNCTION – DISPLAY LOGS
# =============================================================================
def render_logs(container, logs):
    with ((container)):
        if not logs:
            st.info("📋 No activity yet. Actions will appear here as they occur.")
        else:
            for i, log_entry in enumerate(logs):
                log_history = log_entry.get("log_history", "")
                agent_tag = log_entry.get("agent_tag", "System")

                with st.container(border=True):
                    col1, col2 = st.columns([1, 8])
                    with col1:
                        st.markdown(f"**{agent_tag}**")
                    with col2:
                        with st.expander("View Details"):
                            if "Equation" in agent_tag:
                                st.code(log_history)
                            elif "Found Block Diagram" in agent_tag and (log_history.startswith("https") or log_history.startswith("http")):
                                st.image(log_history)
                                st.caption(log_history)
                            elif is_json(log_history):
                                st.json(log_history)
                            else:
                                st.write(log_history)

                if i < len(logs) - 1:
                    st.markdown("<hr style='margin:0.5rem 0;'>", unsafe_allow_html=True)


def render_single_log(container, log_entry):
    """Helper to render one log at a time without re-rendering the whole list."""
    log_history = log_entry.get("log_history", "")
    agent_tag = log_entry.get("agent_tag", "System")
    with container:
        with st.container(border=True):
            col1, col2 = st.columns([1, 8])
            with col1:
                st.markdown(f"**{agent_tag}**")
            with col2:
                with st.expander("View Details"):
                    if agent_tag == "🛠️.Equation":
                        st.code(log_history)
                    elif agent_tag == "🖼️.Found Block Diagram" and (agent_tag.startswith("https") or agent_tag.startswith("http")):
                        st.image(log_history)
                    elif isinstance(log_history, dict):
                        st.json(log_history)
                    else:
                        st.write(log_history)


def show_upload_box(options):
    st.caption("Upload a system defintion file to start:")
    col1, col2 = st.columns([13, 2], gap="xsmall")
    with col1:
        st.session_state.uploaded_file = st.file_uploader("Upload MATLAB (.m) or Python (.py) file", type=["m", "py"],
                                         accept_multiple_files=False)
    with col2:
        st.markdown('<div id="upload-selectbox-marker"></div>', unsafe_allow_html=True)
        st.session_state.model = st.selectbox(
            "LLM Model",
            options,
            index=0,
            help='Choose a LLM Model to work with.'
        )