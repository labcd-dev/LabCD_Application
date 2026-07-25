import streamlit as st
from pathlib import Path
import textwrap
import numpy as np
from plotly.subplots import make_subplots
import plotly.graph_objects as go
import plotly.express as px
import pandas as pd

from backend_api.SiloDesigner.config import (
    build_design_config,
    get_default_param_ranges,
    get_default_param_ranges_for_all,
)


CSS_STYLES = """
<style>
    .main-header {
        font-size: 3.5rem;
        font-weight: bold;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
    }
    .status-running {
        color: #28a745;
        font-weight: bold;
    }
    .status-complete {
        color: #007bff;
        font-weight: bold;
    }
    .status-error {
        color: #dc3545;
        font-weight: bold;
    }
    .metric-card {
        background-color: #f8f9fa;
        padding: 1rem;
        border-radius: 0.5rem;
        border-left: 4px solid #1f77b4;
        margin: 0.5rem 0;
    }
    .agent-response {
        background-color: #e9ecef;
        padding: 1rem;
        border-radius: 0.5rem;
        margin: 0.5rem 0;
        font-family: monospace;
        font-size: 0.9rem;
    }
    .section-header {
        font-size: 1.5rem;
        font-weight: bold;
        color: #ff7f0e;
        margin-top: 1.5rem;
        margin-bottom: 1rem;
    }
    .session-item {
        padding: 0.5rem;
        margin: 0.25rem 0;
        border-radius: 0.25rem;
        cursor: pointer;
        transition: background-color 0.2s;
    }
    .session-item:hover {
        background-color: #f0f0f0;
    }
    .session-item-active {
        background-color: #e3f2fd;
        border-left: 3px solid #1f77b4;
    }
    .speech-bubble-user {
        background-color: #e3f2fd;
        border-radius: 18px;
        padding: 15px 20px;
        margin: 10px 0;
        position: relative;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .speech-bubble-assistant {
        background-color: #f5f5f5;
        border-radius: 18px;
        padding: 15px 20px;
        margin: 10px 0;
        position: relative;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        border-left: 4px solid #1f77b4;
    }
    .file-preview {
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 10px;
        margin-top: 10px;
    }
</style>
"""




def display_logo():
    """Display logo on home page"""
    # Load logo from file
    logo_path = Path("assets/logo.svg")

    if logo_path.exists():
        with open(logo_path, 'r') as f:
            logo_svg = f.read()
        # Ensure the SVG scales with container width while keeping aspect ratio
        logo_svg = logo_svg.replace('<svg', '<svg style="width:100%; height:auto; max-width:200px;"')
    else:
        # Fallback to default logo if file doesn't exist
        logo_svg = """
        <svg style="width:100%; height:auto; max-width:200px;" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <circle cx="100" cy="100" r="80" fill="#1f77b4" opacity="0.2"/>
            <circle cx="100" cy="100" r="60" fill="#1f77b4" opacity="0.4"/>
            <circle cx="100" cy="100" r="40" fill="#1f77b4" opacity="0.6"/>
            <text x="100" y="110" font-size="48" font-weight="bold" 
                  text-anchor="middle" fill="#1f77b4">🎛️</text>
        </svg>
        """

    html_content = textwrap.dedent(f"""
        <div style='text-align: center; margin: 2rem 0;'>
            <div style='max-width: 160px; margin: 0 auto;'>
                {logo_svg}
            </div>
            <h2 style='color: #1f77b4; margin-top: 1rem;'>Welcome to Lab of Control Design</h1>
        </div>
    """).strip()

    # De-indent all lines to avoid Markdown code-block parsing
    lines = html_content.splitlines()
    html_content = '\n'.join(line.lstrip() for line in lines)

    st.markdown(
        html_content,
        unsafe_allow_html=True
    )


def create_advanced_settings(llm_model = None):
    """Create advanced settings UI (extracted from sidebar logic)"""

    if "__name__" == "__main__":
        # LLM Model selection
        st.subheader("LLM Model")
        llm_model = st.selectbox(
            "Model",
            ["gpt-oss-120b", "llama-3.3-70b", "deepseek-r1-distill-llama-70b", "gpt-4o", "gpt-4o-mini"],
            index=0,
            key="adv_llm_model"
        )

    # Controllers selection
    st.subheader("Controllers")
    available_controllers = ["P", "PI", "PD", "PID", "FSF"]
    selected_controllers_unsorted = st.multiselect(
        "Select Controllers",
        available_controllers,
        default=["PID", "FSF"],
        key="adv_controllers"
    )
    selected_controllers = sorted(selected_controllers_unsorted, key=lambda x: available_controllers.index(x))

    # Design parameters
    st.subheader("Design Parameters")
    col1, col2 = st.columns(2)
    with col1:
        max_scenarios = st.slider("Max Scenarios", 1, 5, 2, key="adv_scenarios")
        seed = st.number_input("Random Seed", 1, 10000, 42, key="adv_seed")
    with col2:
        max_iter = st.slider("Max Iterations", 5, 30, 20, key="adv_iter")
        max_tries = st.slider("Max Tries for Juror", 0, 10, 0, key="adv_tries")

    # Target metrics
    st.subheader("Target Performance")
    col1, col2, col3 = st.columns(3)
    with col1:
        target_mse = st.number_input("Target MSE", 0.01, 1.0, 0.15, format="%.3f", key="adv_mse")
    with col2:
        target_settling = st.number_input("Settling Time (s)", 0.5, 10.0, 3.5, key="adv_settling")
    with col3:
        target_overshoot = st.number_input("Overshoot (%)", 0.0, 50.0, 0.0, key="adv_overshoot")

    # Simulation params
    st.subheader("Simulation Parameters")
    col1, col2 = st.columns(2)
    with col1:
        dt = st.number_input("Sample Time (dt)", 0.001, 1.0, 0.01, format="%.3f", key="adv_dt")
        target = st.number_input("Target Setpoint", -100.0, 100.0, 0.0, format="%.2f", key="adv_target")
        input_channel = st.number_input("Input Channel", 0, 10, 0, step=1, key="adv_input_ch")
    with col2:
        max_time = st.number_input("Max Simulation Time (s)", 0.1, 100.0, 5.0, format="%.1f", key="adv_max_time")
        num_inputs = st.number_input("Number of Inputs", 1, 10, 1, step=1, key="adv_num_inputs")
        output_channel = st.number_input("Output Channel", 0, 10, 0, step=1, key="adv_output_ch")

    # Control limits
    st.subheader("Control Limits")
    col1, col2 = st.columns(2)
    with col1:
        min_ctrl = st.number_input("Min Control Input", -100.0, 0.0, -10.0, format="%.2f", key="adv_min_ctrl")
    with col2:
        max_ctrl = st.number_input("Max Control Input", 0.0, 100.0, 10.0, format="%.2f", key="adv_max_ctrl")

    # Custom system params
    st.subheader("Custom System Parameters")
    # matlab_func_name = st.text_input("MATLAB Function Name", "dynamics", key="adv_matlab_func")
    num_states = st.number_input("Number of States", 1, 20, 4, step=1, key="adv_num_states")
    trim_values_str = st.text_input("Trim Values (comma-separated, e.g., 0.0,0.0)", "0.0", key="adv_trim_values")
    trim_values = [float(v.strip()) for v in trim_values_str.split(',') if v.strip()]

    # Custom Parameter Ranges
    st.subheader("Custom Parameter Ranges")
    custom_param_ranges = {}
    default_ranges = _get_default_param_ranges_for_all()

    pid_controllers_selected = any(c in ["P", "PI", "PD", "PID"] for c in selected_controllers)
    if pid_controllers_selected and st.checkbox("Customize PID-like gains (Kp, Ki, Kd)", key="custom_toggle_pid"):
        with st.expander("PID-like Parameter Ranges", expanded=True):
            unified_ranges = {}
            col_min, col_max = st.columns(2)
            with col_min:
                kp_min = st.number_input("Kp Min", value=0.0, step=0.1, format="%.1f", key="pid_Kp_min")
            with col_max:
                kp_max = st.number_input("Kp Max", value=200.0, step=0.1, format="%.1f", key="pid_Kp_max")
            unified_ranges["Kp"] = [kp_min, kp_max]

            if any(c in ["PI", "PID"] for c in selected_controllers):
                col_min, col_max = st.columns(2)
                with col_min:
                    ki_min = st.number_input("Ki Min", value=0.0, step=0.1, format="%.1f", key="pid_Ki_min")
                with col_max:
                    ki_max = st.number_input("Ki Max", value=50.0, step=0.1, format="%.1f", key="pid_Ki_max")
                unified_ranges["Ki"] = [ki_min, ki_max]

            if any(c in ["PD", "PID"] for c in selected_controllers):
                col_min, col_max = st.columns(2)
                with col_min:
                    kd_min = st.number_input("Kd Min", value=0.0, step=0.1, format="%.1f", key="pid_Kd_min")
                with col_max:
                    kd_max = st.number_input("Kd Max", value=100.0, step=0.1, format="%.1f", key="pid_Kd_max")
                unified_ranges["Kd"] = [kd_min, kd_max]

            for controller in selected_controllers:
                if controller in ["P", "PI", "PD", "PID"]:
                    controller_ranges = {}
                    if "Kp" in unified_ranges:
                        controller_ranges["Kp"] = unified_ranges["Kp"]
                    if controller == "PI" and "Ki" in unified_ranges:
                        controller_ranges["Ki"] = unified_ranges["Ki"]
                    if controller == "PD" and "Kd" in unified_ranges:
                        controller_ranges["Kd"] = unified_ranges["Kd"]
                    if controller == "PID" and "Ki" in unified_ranges and "Kd" in unified_ranges:
                        controller_ranges["Ki"] = unified_ranges["Ki"]
                        controller_ranges["Kd"] = unified_ranges["Kd"]
                    if controller_ranges:
                        custom_param_ranges[controller] = controller_ranges

    if "FSF" in selected_controllers and st.checkbox("Customize FSF gains", key="custom_toggle_fsf"):
        with st.expander("FSF Parameter Ranges", expanded=True):
            fsf_ranges = {}
            for i in range(num_states):
                param_name = f"K{i + 1}"
                default_min, default_max = -50.0, 50.0
                col_min, col_max = st.columns(2)
                with col_min:
                    min_val = st.number_input(f"{param_name} Min", value=default_min, step=0.1,
                                              format="%.1f", key=f"fsf_{param_name}_min")
                with col_max:
                    max_val = st.number_input(f"{param_name} Max", value=default_max, step=0.1,
                                              format="%.1f", key=f"fsf_{param_name}_max")
                fsf_ranges[param_name] = [min_val, max_val]
            if fsf_ranges:
                custom_param_ranges["FSF"] = fsf_ranges

    param_ranges = custom_param_ranges if custom_param_ranges else None

    # Scenario Configurations
    st.subheader("Scenario Configurations")
    custom_scenarios = []
    for i in range(1, max_scenarios + 1):
        with st.expander(f"Scenario {i} (ID: {chr(64 + i)})", expanded=(i == 1)):
            col_sc1, col_sc2, col_sc3 = st.columns(3)
            with col_sc1:
                ic_range = st.slider(f"Initial condition range", -2.0, 2.0, (-1.0, 1.0), key=f"adv_ic_range_{i}")
            with col_sc2:
                randomness_level = st.slider("Measurement noise level", 0.0, 0.5, 0.0, key=f"adv_rand_{i}")
            with col_sc3:
                disturbance_level = st.slider("Input disturbance level", 0.0, 2.0, 0.0, key=f"adv_dist_{i}")
            custom_scenarios.append({
                'id': chr(64 + i),
                'initial_condition_range': ic_range,
                'randomness_level': randomness_level,
                'disturbance_level': disturbance_level,
            })

    # NEW: GA Configuration
    st.divider()
    st.subheader("🧬 Genetic Algorithm (GA) Settings")
    enable_ga = st.checkbox("Enable GA Optimization", value=False, key="enable_ga_checkbox",
                            help="Run GA optimization alongside agentic workflow for comparison")

    ga_config = None
    if enable_ga:
        with st.expander("GA Configuration", expanded=True):
            col1, col2 = st.columns(2)
            with col1:
                ga_population = st.slider("Population Size", 10, 100, 50, key="ga_population")
                ga_generations = st.slider("Generations", 20, 200, 100, key="ga_generations")
                ga_parents = st.slider("Parents Mating", 2, 20, 10, key="ga_parents")
            with col2:
                ga_keep_parents = st.slider("Keep Parents", 0, 10, 2, key="ga_keep_parents")
                ga_crossover_prob = st.slider("Crossover Probability", 0.0, 1.0, 0.8, step=0.05, key="ga_crossover")
                ga_mutation_prob = st.slider("Mutation Probability", 0.0, 1.0, 0.1, step=0.05, key="ga_mutation")

            ga_eval_runs = st.slider("Evaluation Runs (Monte Carlo)", 5, 50, 10, key="ga_eval_runs",
                                     help="Number of Monte Carlo runs for fitness evaluation")

            # Optimization weights
            st.markdown("**Optimization Weights**")
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                w_mse = st.number_input("MSE Weight", 0.0, 10.0, 1.0, step=0.1, key="ga_w_mse")
            with col2:
                w_settling = st.number_input("Settling Weight", 0.0, 1.0, 0.1, step=0.01, key="ga_w_settling")
            with col3:
                w_overshoot = st.number_input("Overshoot Weight", 0.0, 1.0, 0.01, step=0.001, key="ga_w_overshoot")
            with col4:
                w_control = st.number_input("Control Effort Weight", 0.0, 0.01, 0.001, step=0.0001,
                                            format="%.4f", key="ga_w_control")

            ga_config = {
                'num_generations': ga_generations,
                'population_size': ga_population,
                'num_parents_mating': ga_parents,
                'keep_parents': ga_keep_parents,
                'crossover_probability': ga_crossover_prob,
                'mutation_probability': ga_mutation_prob,
                'mutation_num_genes': 1,
                'random_seed': seed,
                'num_evaluation_runs': ga_eval_runs,
                'weights': {
                    'mse': w_mse,
                    'settling_time': w_settling,
                    'overshoot': w_overshoot,
                    'control_effort': w_control
                }
            }

    return {
        'llm_model': llm_model,
        'controllers': selected_controllers if selected_controllers else None,
        'max_scenarios': max_scenarios,
        'max_iter': max_iter,
        'seed': seed,
        'max_tries': max_tries,
        'target_metrics': {
            'mse': target_mse,
            'settling_time': target_settling,
            'overshoot': target_overshoot,
            'max_iterations': max_iter
        },
        'dt': dt,
        'max_time': max_time,
        'target': target,
        'num_inputs': num_inputs,
        'input_channel': input_channel,
        'output_channel': output_channel,
        'min_ctrl': min_ctrl,
        'max_ctrl': max_ctrl,
        'matlab_func_name': "dynamics",
        'num_states': num_states if num_states != 4 else None,
        'trim_values': trim_values if len(trim_values) == num_inputs else None,
        'param_ranges': param_ranges,
        'custom_scenarios': custom_scenarios if custom_scenarios else None,
        'enable_ga': enable_ga,
        'ga_config': ga_config
    }


def _get_default_param_ranges_for_all():
    return get_default_param_ranges_for_all()


def _get_default_param_ranges(controller_type, system=None):
    return get_default_param_ranges(controller_type, system)


def build_config_from_session():
    """Build configuration from session state"""

    # Get advanced settings if available
    if 'temp_config' in st.session_state and st.session_state.temp_config:
        base_config = st.session_state.temp_config
    else:
        base_config = None

    return build_design_config(
        base_config,
        custom_dynamics_path=st.session_state.get('custom_dynamics_path'),
        file_type=st.session_state.get('file_type', 'Python (.py)'),
        control_objective=st.session_state.get('control_objective', ''),
        file_content=st.session_state.get('file_content'),
    )


def display_time_response():
    """Display latest system response with interactive gain sliders and GA comparison"""

    # Initialize session state for gains if not present
    if 'manual_gains' not in st.session_state:
        st.session_state.manual_gains = {}
    if 'optimal_gains' not in st.session_state:
        st.session_state.optimal_gains = {}
    if 'test_mode' not in st.session_state:
        st.session_state.test_mode = False
    if 'ga_results' not in st.session_state:
        st.session_state.ga_results = {}

    # Get latest gains and controller type from monitor
    latest_controller_type = None
    latest_gains = {}
    current_system = None

    if st.session_state.monitor.state_history:
        latest_state = st.session_state.monitor.state_history[-1]['state']
        latest_controller_type = latest_state.get('controller_type', None)

        if latest_state.get('current_params'):
            latest_gains = {k: v for k, v in latest_state['current_params'].items()
                            if k != 'reasoning'}

        current_system = latest_state.get('system', None)

    # Scenario selection
    selected_scenario = None
    if 'scenarios' in st.session_state and st.session_state.scenarios:
        scenario_options = [f"Scenario {s['id']} ({s['initial_condition_range']})" for s in st.session_state.scenarios]
        selected_scenario_idx = st.selectbox(
            "Select Scenario for Design/Tuning",
            options=range(len(st.session_state.scenarios)),
            format_func=lambda i: scenario_options[i],
            index=0
        )
        selected_scenario = st.session_state.scenarios[selected_scenario_idx]
        st.markdown(f"**Selected:** {scenario_options[selected_scenario_idx]}")

    # Create columns for sliders and plot
    col1, col2 = st.columns([1, 3])

    with col1:
        st.markdown("**🎚️ Gain Controls**")

        # Show status
        if st.session_state.monitor.is_running:
            st.info("🔒 Sliders locked during optimization")
        else:
            st.success("✅ Optimization complete - sliders active")

            if latest_gains and not st.session_state.optimal_gains:
                st.session_state.optimal_gains = latest_gains.copy()

        # Display current controller type
        if latest_controller_type:
            st.markdown(f"**Controller:** {latest_controller_type}")

            # Get parameter ranges
            param_ranges = {}
            if current_system and hasattr(current_system, 'get_control_param_schema'):
                try:
                    schema = current_system.get_control_param_schema(latest_controller_type)
                    param_ranges = {k: [v["min"], v["max"]] for k, v in schema.items()}
                except:
                    param_ranges = _get_default_param_ranges(latest_controller_type, current_system)
            else:
                param_ranges = _get_default_param_ranges(latest_controller_type, current_system)

            # Create sliders for each gain
            updated_gains = {}
            for param_name in sorted(latest_gains.keys()):
                if param_name == 'reasoning':
                    continue

                param_range = param_ranges.get(param_name, [0.0, 100.0])

                if st.session_state.test_mode and param_name in st.session_state.manual_gains:
                    current_value = st.session_state.manual_gains[param_name]
                else:
                    current_value = latest_gains[param_name]

                optimal_marker = ""
                if param_name in st.session_state.optimal_gains:
                    optimal_val = st.session_state.optimal_gains[param_name]
                    if abs(current_value - optimal_val) > 0.01:
                        optimal_marker = f" (Optimal: {optimal_val:.2f})"

                new_value = st.slider(
                    f"{param_name}{optimal_marker}",
                    min_value=float(param_range[0]),
                    max_value=float(param_range[1]),
                    value=float(current_value),
                    step=0.01,
                    disabled=st.session_state.monitor.is_running,
                    key=f"gain_slider_{param_name}"
                )

                updated_gains[param_name] = new_value

            # Add control buttons
            if not st.session_state.monitor.is_running and latest_gains:
                st.divider()

                col_btn1, col_btn2 = st.columns(2)

                with col_btn1:
                    if st.button("🎯 Reset to Optimal", width='stretch',
                                 disabled=not st.session_state.optimal_gains):
                        st.session_state.manual_gains = st.session_state.optimal_gains.copy()
                        st.session_state.test_mode = True
                        st.rerun()

                with col_btn2:
                    if st.button("🧪 Test Current", width='stretch'):
                        st.session_state.manual_gains = updated_gains
                        st.session_state.test_mode = True
                        st.rerun()

                if st.session_state.test_mode:
                    st.info("📊 Showing response with manual gains")

                    if st.session_state.optimal_gains:
                        st.markdown("**Δ from optimal:**")
                        for param_name in sorted(updated_gains.keys()):
                            if param_name in st.session_state.optimal_gains:
                                diff = updated_gains[param_name] - st.session_state.optimal_gains[param_name]
                                if abs(diff) > 0.01:
                                    st.markdown(f"- {param_name}: {diff:+.2f}")

                # NEW: Show GA results if available
                if st.session_state.ga_results.get('status') == 'complete':
                    st.divider()
                    st.markdown("**🧬 GA Results**")
                    ga_params = st.session_state.ga_results.get('best_params', {})
                    for param_name, param_value in ga_params.items():
                        st.markdown(f"- {param_name}: {param_value:.2f}")

    with col2:
        if st.session_state.monitor.state_history:
            _plot_system_response(
                st.session_state.monitor.state_history,
                test_gains=st.session_state.manual_gains if st.session_state.test_mode else None,
                latest_controller_type=latest_controller_type,
                selected_scenario=selected_scenario,
                ga_results=st.session_state.ga_results if st.session_state.ga_results.get(
                    'status') == 'complete' else None
            )
        else:
            st.info("No simulation data available yet. Start the design process to see results.")




def _plot_system_response(state_history, test_gains=None, latest_controller_type=None, selected_scenario=None,
                          ga_results=None):
    """Plot system response comparing optimal vs manual gains vs GA with same initial conditions"""
    from plotly.subplots import make_subplots
    import plotly.graph_objects as go

    if not state_history:
        st.info("No simulation data available yet. Start the design process to see results.")
        return

    # Extract from final state
    final_state = state_history[-1]['state']
    target = final_state.get('target', 0.0)
    dt = final_state.get('dt', 0.01)
    max_time = final_state.get('max_time', 5.0)

    latest_results = final_state.get('results') or {}
    optimal_params = {k: v for k, v in final_state.get('current_params', {}).items() if k != 'reasoning'}
    latest_system = final_state.get('system')
    latest_simulator = final_state.get('simulator')
    latest_controller_type = final_state.get('controller_type', latest_controller_type)

    # Fallback to session_state
    if latest_simulator is None and hasattr(st.session_state, 'current_simulator'):
        latest_simulator = st.session_state.current_simulator
    if latest_system is None and hasattr(st.session_state, 'current_system'):
        latest_system = st.session_state.current_system
    if not latest_controller_type and hasattr(st.session_state, 'current_controller_type'):
        latest_controller_type = st.session_state.current_controller_type

    # Fix simulator's internal system reference if needed
    if latest_simulator and hasattr(latest_simulator, 'system') and latest_simulator.system is None:
        if latest_system:
            latest_simulator.system = latest_system

    if not latest_simulator or not optimal_params:
        st.info("No simulation data available yet.")
        return

    # Set controller type
    if latest_controller_type:
        latest_simulator.controller_type = latest_controller_type

    # Set selected scenario on simulator
    if selected_scenario:
        latest_simulator.set_scenario(selected_scenario)
        latest_system = latest_simulator.system
        scenario_str = f" | Scenario {selected_scenario['id']}"
    else:
        default_scenario = {'initial_condition_range': (-1.0, 1.0), 'randomness_level': 0.0, 'disturbance_level': 0.0}
        latest_simulator.set_scenario(default_scenario)
        latest_system = latest_simulator.system
        scenario_str = ""

    # Generate fixed initial condition
    initial_state = np.zeros(latest_system.num_states)
    ic_min, ic_max = latest_system.initial_condition_range

    rng = np.random.default_rng(seed=state_history[0]['state']['seed'])
    fixed_ic_value = rng.uniform(ic_min, ic_max)
    # print("seed")
    # print(state_history[0]['state']['seed'])
    # print("fixed_ic_value")
    # print(fixed_ic_value)

    initial_state[latest_system.output_channel] = fixed_ic_value

    # Run simulation with optimal parameters
    try:
        optimal_result = latest_simulator.evaluate_parameters(optimal_params, initial_state=initial_state)

        if not optimal_result['success']:
            st.error(f"❌ Optimal simulation failed: {optimal_result.get('error', 'Unknown')}")
            return

        optimal_trajectory = optimal_result['trajectory']
        optimal_control = optimal_result['control_signals']

    except Exception as e:
        st.error(f"❌ Optimal simulation error: {e}")
        return

    # Run simulation with test gains if provided
    test_trajectory = None
    test_control = None

    if test_gains:
        try:
            test_result = latest_simulator.evaluate_parameters(test_gains, initial_state=initial_state)

            if test_result['success']:
                test_trajectory = test_result['trajectory']
                test_control = test_result['control_signals']
            else:
                st.warning(f"⚠️ Test simulation failed: {test_result.get('error', 'Unknown')}")
        except Exception as test_e:
            st.error(f"❌ Test simulation error: {test_e}")

    # NEW: Run simulation with GA parameters if available
    ga_trajectory = None
    ga_control = None

    if ga_results and ga_results.get('best_params'):
        try:
            ga_params = ga_results['best_params']
            ga_result = latest_simulator.evaluate_parameters(ga_params, initial_state=initial_state)

            if ga_result['success']:
                ga_trajectory = ga_result['trajectory']
                ga_control = ga_result['control_signals']
        except Exception as ga_e:
            st.warning(f"⚠️ GA simulation error: {ga_e}")

    # Create time points
    expected_steps = int(max_time / dt) + 1
    time_points = np.arange(0, max_time + dt, dt)[:expected_steps]

    # Create subplot with 2 rows
    fig = make_subplots(
        rows=2, cols=1,
        subplot_titles=['System Response', 'Control Input'],
        vertical_spacing=0.15
    )

    # Plot optimal trajectory
    if optimal_trajectory is not None and len(optimal_trajectory) > 0:
        traj_time = time_points[:len(optimal_trajectory)]
        fig.add_trace(
            go.Scatter(x=traj_time, y=optimal_trajectory,
                       mode='lines', name='Agentic (Optimal)',
                       line=dict(color='rgb(255, 99, 132)', width=2)),
            row=1, col=1
        )

    # Plot test trajectory if available
    if test_trajectory is not None and len(test_trajectory) > 0:
        test_traj_time = time_points[:len(test_trajectory)]
        fig.add_trace(
            go.Scatter(x=test_traj_time, y=test_trajectory,
                       mode='lines', name='Manual Test',
                       line=dict(color='rgb(54, 162, 235)', width=2, dash='dash')),
            row=1, col=1
        )

    # NEW: Plot GA trajectory if available
    if ga_trajectory is not None and len(ga_trajectory) > 0:
        ga_traj_time = time_points[:len(ga_trajectory)]
        fig.add_trace(
            go.Scatter(x=ga_traj_time, y=ga_trajectory,
                       mode='lines', name='GA Optimized',
                       line=dict(color='rgb(75, 192, 192)', width=2.5, dash='dot')),
            row=1, col=1
        )

    # Add reference line at target
    fig.add_hline(y=target, line_dash="dash", line_color="green",
                  row=1, col=1, annotation_text="Target")

    # Plot optimal control signals
    if optimal_control is not None and len(optimal_control) > 0:
        ctrl_time = time_points[:len(optimal_control)]
        fig.add_trace(
            go.Scatter(x=ctrl_time, y=optimal_control,
                       mode='lines', name='Agentic Control',
                       line=dict(color='rgb(255, 159, 64)', width=2)),
            row=2, col=1
        )

    # Plot test control signals if available
    if test_control is not None and len(test_control) > 0:
        test_ctrl_time = time_points[:len(test_control)]
        fig.add_trace(
            go.Scatter(x=test_ctrl_time, y=test_control,
                       mode='lines', name='Manual Control',
                       line=dict(color='rgb(153, 102, 255)', width=2, dash='dash')),
            row=2, col=1
        )

    # NEW: Plot GA control signals if available
    if ga_control is not None and len(ga_control) > 0:
        ga_ctrl_time = time_points[:len(ga_control)]
        fig.add_trace(
            go.Scatter(x=ga_ctrl_time, y=ga_control,
                       mode='lines', name='GA Control',
                       line=dict(color='rgb(255, 205, 86)', width=2.5, dash='dot')),
            row=2, col=1
        )

    # Format title
    ic_str = f"IC: x[{latest_system.output_channel}]={fixed_ic_value:.3f} (fixed from range {latest_system.initial_condition_range})"

    if test_gains:
        gains_str = ', '.join([f"{k}:{v:.2f}" for k, v in test_gains.items()])
        title_text = f"Controller: {latest_controller_type} | Test Gains: {gains_str} | {ic_str}{scenario_str}"
    else:
        gains_str = ', '.join([f"{k}:{v:.2f}" for k, v in optimal_params.items()])
        title_text = f"Controller: {latest_controller_type} | Optimized Gains: {gains_str} | {ic_str}{scenario_str}"

    # NEW: Add GA info to title if available
    if ga_results:
        ga_gains_str = ', '.join([f"{k}:{v:.2f}" for k, v in ga_results['best_params'].items()])
        title_text += f" | GA: {ga_gains_str}"

    fig.update_layout(
        height=700,
        showlegend=True,
        title_text=title_text
    )

    fig.update_xaxes(title_text="Time (s)", row=1, col=1)
    fig.update_xaxes(title_text="Time (s)", row=2, col=1)
    fig.update_yaxes(title_text="Output", row=1, col=1)
    fig.update_yaxes(title_text="Control Signal", row=2, col=1)

    st.plotly_chart(fig, width='stretch')


def display_progress_feed():
    """Display real-time progress feed"""
    progress_container = st.container()

    if st.session_state.monitor.progress_history:
        for update in st.session_state.monitor.progress_history[-10:]:
            with progress_container:
                st.text(f"[{update['timestamp']}] {update['message']}")


def display_metrics_plots():
    """Display performance plots with GA comparison"""
    if st.session_state.monitor.state_history:
        # Extract performance data from agentic workflow
        mse_values = []
        settling_times = []
        overshoots = []
        iterations = []

        global_step = 0
        last_metrics = None

        for entry in st.session_state.monitor.state_history:
            state = entry['state']
            if state.get('results') and state['results'].get('metrics'):
                metrics = state['results']['metrics']
                metrics_tuple = tuple((k, v) for k, v in sorted(metrics.items()))

                if metrics_tuple == last_metrics:
                    continue

                last_metrics = metrics_tuple
                global_step += 1
                iterations.append(global_step)
                mse_values.append(np.nan if not np.isfinite(metrics.get('mse', np.inf)) else metrics.get('mse'))
                settling_time = metrics.get('settling_time', np.inf)
                settling_times.append(np.nan if not np.isfinite(settling_time) else settling_time)
                overshoots.append(metrics.get('overshoot', 0))

        if iterations:
            target_metrics = st.session_state.saved_config.get('target_metrics', {})
            target_mse = target_metrics.get('mse', 0.15)
            target_settling = target_metrics.get('settling_time', 3.5)
            target_overshoot = target_metrics.get('overshoot', 0.0)

            # Create 2x2 subplot
            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=['MSE Progress', 'Settling Time', 'Overshoot', 'Performance Summary']
            )

            # MSE plot
            fig.add_trace(
                go.Scatter(x=iterations, y=mse_values, mode='lines+markers',
                           name='Agentic MSE', line=dict(color='rgb(255, 99, 132)'), showlegend=True),
                row=1, col=1
            )
            fig.add_hline(y=target_mse, line_dash="dash", line_color="red",
                          annotation_text=f"Target: {target_mse:.3f}", row=1, col=1)

            # NEW: Add GA MSE reference if available
            if st.session_state.ga_results.get('status') == 'complete':
                ga_mse = st.session_state.ga_results['final_metrics'].get('mse', float('inf'))
                if np.isfinite(ga_mse):
                    fig.add_hline(y=ga_mse, line_dash="dot", line_color="rgb(75, 192, 192)",
                                  annotation_text=f"GA: {ga_mse:.3f}", row=1, col=1)

            # Settling time plot
            fig.add_trace(
                go.Scatter(x=iterations, y=settling_times, mode='lines+markers',
                           name='Agentic Settling', line=dict(color='rgb(255, 99, 132)'), showlegend=True),
                row=1, col=2
            )
            fig.add_hline(y=target_settling, line_dash="dash", line_color="red",
                          annotation_text=f"Target: {target_settling:.2f}s", row=1, col=2)

            # NEW: Add GA settling time reference
            if st.session_state.ga_results.get('status') == 'complete':
                ga_settling = st.session_state.ga_results['final_metrics'].get('settling_time', float('inf'))
                if np.isfinite(ga_settling):
                    fig.add_hline(y=ga_settling, line_dash="dot", line_color="rgb(75, 192, 192)",
                                  annotation_text=f"GA: {ga_settling:.2f}s", row=1, col=2)

            # Overshoot plot
            fig.add_trace(
                go.Scatter(x=iterations, y=overshoots, mode='lines+markers',
                           name='Agentic Overshoot', line=dict(color='rgb(255, 159, 64)'), showlegend=True),
                row=2, col=1
            )
            fig.add_hline(y=target_overshoot, line_dash="dash", line_color="red",
                          annotation_text=f"Target: {target_overshoot:.1f}%", row=2, col=1)

            # NEW: Add GA overshoot reference
            if st.session_state.ga_results.get('status') == 'complete':
                ga_overshoot = st.session_state.ga_results['final_metrics'].get('overshoot', 0)
                fig.add_hline(y=ga_overshoot, line_dash="dot", line_color="rgb(75, 192, 192)",
                              annotation_text=f"GA: {ga_overshoot:.1f}%", row=2, col=1)

            # Performance summary (grouped bar chart)
            if mse_values and settling_times and overshoots:
                categories = ['MSE', 'Settling Time', 'Overshoot']
                agentic_values = [mse_values[-1], settling_times[-1], overshoots[-1]]
                target_values = [target_mse, target_settling, target_overshoot]

                fig.add_trace(
                    go.Bar(x=categories, y=agentic_values, name='Agentic',
                           marker_color='rgb(255, 99, 132)'),
                    row=2, col=2
                )
                fig.add_trace(
                    go.Bar(x=categories, y=target_values, name='Target',
                           marker_color='red'),
                    row=2, col=2
                )

                # NEW: Add GA bars if available
                if st.session_state.ga_results.get('status') == 'complete':
                    ga_values = [
                        st.session_state.ga_results['final_metrics'].get('mse', 0),
                        st.session_state.ga_results['final_metrics'].get('settling_time', 0),
                        st.session_state.ga_results['final_metrics'].get('overshoot', 0)
                    ]
                    fig.add_trace(
                        go.Bar(x=categories, y=ga_values, name='GA',
                               marker_color='rgb(75, 192, 192)'),
                        row=2, col=2
                    )

            fig.update_layout(height=600, showlegend=True, barmode='group')
            fig.update_xaxes(title_text="Global Step", row=1, col=1)
            fig.update_xaxes(title_text="Global Step", row=1, col=2)
            fig.update_xaxes(title_text="Global Step", row=2, col=1)
            fig.update_yaxes(title_text="MSE", row=1, col=1)
            fig.update_yaxes(title_text="Time (s)", row=1, col=2)
            fig.update_yaxes(title_text="Percent (%)", row=2, col=1)
            fig.update_yaxes(title_text="Value", row=2, col=2)

            st.plotly_chart(fig, width='stretch')
    else:
        st.info("No metrics data available yet. Start the design process to see progress.")


def display_llm_responses():
    """Display recent LLM responses"""
    if st.session_state.monitor.llm_responses:
        # Show last 10 responses
        for response in st.session_state.monitor.llm_responses[-10:]:
            with st.expander(f"[{response['timestamp']}] {response['agent']}", expanded=False):
                st.text(f"Prompt: {response['prompt']}")
                st.code(response['response'], language='json')


def display_current_metrics():
    """Display current design metrics"""
    if st.session_state.monitor.current_state:
        state = st.session_state.monitor.current_state

        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Iteration", state.get('iteration', 0))

        with col2:
            st.metric("Scenario Level", state.get('scenario_level', 0))

        with col3:
            # Fixed: Better handling of controller type
            controller_type = state.get('controller_type', None)
            if controller_type:
                current_controller = controller_type
            else:
                controller_idx = state.get('current_controller_index', 0)
                controllers = state.get('controllers_list', [])
                current_controller = controllers[controller_idx] if controllers and controller_idx < len(
                    controllers) else 'Unknown'
            st.metric("Current Controller", current_controller)

        with col4:
            if state.get('results') and state['results'].get('metrics'):
                mse = state['results']['metrics'].get('mse', float('inf'))
                if mse != float('inf'):
                    st.metric("Current MSE", f"{mse:.4f}")
                else:
                    st.metric("Current MSE", "∞")

        # NEW: Simulation parameters display (unchanged)
        st.divider()
        st.subheader("Simulation Configuration")

        # FIXED: Get min_ctrl and max_ctrl from saved_config if not in state
        saved_config = st.session_state.get('saved_config', {})
        min_ctrl = state.get('min_ctrl', saved_config.get('min_ctrl', -10.0))
        max_ctrl = state.get('max_ctrl', saved_config.get('max_ctrl', 10.0))

        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric("Sample Time (dt)", f"{state.get('dt', 0.01):.3f} s")
            st.metric("Target Setpoint", f"{state.get('target', 0.0):.2f}")
            st.metric("Min Control", f"{min_ctrl:.2f}")  # FIXED
        with col2:
            st.metric("Max Time", f"{state.get('max_time', 5.0):.1f} s")
            st.metric("Input Channel", state.get('input_channel', 0))
            st.metric("Max Control", f"{max_ctrl:.2f}")  # FIXED
        with col3:
            st.metric("Number of Inputs", state.get('num_inputs', 1))
            st.metric("Output Channel", state.get('output_channel', 0))

        # NEW: Computational Profiling Section
        st.divider()
        st.subheader("🖥️ Computational Profiling")
        monitor = st.session_state.monitor
        if monitor.scenario_metrics_history:
            # Cumulative totals
            total_tokens_in = sum(m['metrics']['tokens_in'] for m in monitor.scenario_metrics_history)
            total_tokens_out = sum(m['metrics']['tokens_out'] for m in monitor.scenario_metrics_history)
            total_time = sum(m['metrics']['time'] for m in monitor.scenario_metrics_history)
            total_cost = sum(m['metrics']['cost'] for m in monitor.scenario_metrics_history)

            col_cum1, col_cum2, col_cum3, col_cum4 = st.columns(4)
            with col_cum1:
                st.metric("Total Tokens In", total_tokens_in)
            with col_cum2:
                st.metric("Total Tokens Out", total_tokens_out)
            with col_cum3:
                st.metric("Total Time", f"{total_time:.1f}s")
            with col_cum4:
                st.metric("Total Cost", f"${total_cost:.4f}")

            # Per-scenario table
            st.subheader("Per-Scenario Breakdown")
            scenario_data = []
            for entry in monitor.scenario_metrics_history:
                m = entry['metrics']
                scenario_data.append({
                    'Level': entry['scenario_level'],
                    'Tokens In': m['tokens_in'],
                    'Tokens Out': m['tokens_out'],
                    'Time (s)': f"{m['time']:.1f}",
                    'Cost ($)': f"${m['cost']:.4f}"
                })
            st.table(scenario_data)
        else:
            st.info("No profiling data yet. Run a scenario to see metrics.")


def display_gains_plot():
    """Display parameter/gains history"""
    if st.session_state.monitor.state_history:
        params_history = {}
        global_step = 0
        last_metrics = None

        for entry in st.session_state.monitor.state_history:
            state = entry['state']
            if state.get('results') and state['results'].get('metrics'):
                metrics = state['results']['metrics']
                metrics_tuple = tuple((k, v) for k, v in sorted(metrics.items()))

                if metrics_tuple == last_metrics:
                    continue

                last_metrics = metrics_tuple
                global_step += 1

                if state.get('current_params'):
                    for param_name, param_value in state['current_params'].items():
                        if param_name != 'reasoning':
                            if param_name not in params_history:
                                params_history[param_name] = {'x': [], 'y': []}
                            params_history[param_name]['x'].append(global_step)
                            params_history[param_name]['y'].append(param_value)

        if params_history:
            fig = go.Figure()
            colors = px.colors.qualitative.Plotly

            for idx, param_name in enumerate(params_history.keys()):
                data = params_history[param_name]
                fig.add_trace(
                    go.Scatter(x=data['x'], y=data['y'],
                               mode='lines+markers', name=f"Agentic {param_name}",
                               line=dict(color=colors[idx % len(colors)]))
                )

            # NEW: Add GA final values as horizontal lines
            if st.session_state.ga_results.get('status') == 'complete':
                ga_params = st.session_state.ga_results.get('best_params', {})
                for idx, (param_name, param_value) in enumerate(ga_params.items()):
                    fig.add_hline(
                        y=param_value,
                        line_dash="dot",
                        line_color=colors[idx % len(colors)],
                        annotation_text=f"GA {param_name}: {param_value:.2f}"
                    )

            fig.update_layout(
                title="Parameters History (Agentic vs GA)",
                xaxis_title="Global Step",
                yaxis_title="Parameter Value",
                height=500,
                showlegend=True
            )

            st.plotly_chart(fig, width='stretch')


def display_ga_results():
    """Display GA optimization results"""
    if not st.session_state.ga_results:
        st.info("No GA results available. Enable GA in Advanced Settings to run genetic algorithm optimization.")
        return

    status = st.session_state.ga_results.get('status')

    if status == 'running':
        st.info("🧬 GA optimization is currently running... Please wait.")

    elif status == 'complete':
        st.success("✅ GA optimization completed successfully!")

        # Display best parameters
        st.subheader("Optimal Parameters")
        best_params = st.session_state.ga_results.get('best_params', {})
        cols = st.columns(len(best_params))
        for idx, (param, value) in enumerate(best_params.items()):
            with cols[idx]:
                st.metric(param, f"{value:.4f}")

        # Display final metrics
        st.subheader("Performance Metrics")
        final_metrics = st.session_state.ga_results.get('final_metrics', {})
        metric_cols = st.columns(4)
        with metric_cols[0]:
            st.metric("MSE", f"{final_metrics.get('mse', 0):.4f}")
        with metric_cols[1]:
            st.metric("Settling Time", f"{final_metrics.get('settling_time', 0):.2f}s")
        with metric_cols[2]:
            st.metric("Overshoot", f"{final_metrics.get('overshoot', 0):.2f}%")
        with metric_cols[3]:
            stable = final_metrics.get('stable', False)
            st.metric("Stable", "✓" if stable else "✗")

        # Plot optimization history
        st.subheader("Optimization History")
        history = st.session_state.ga_results.get('history', {})
        if history and 'generation' in history:
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=history['generation'],
                y=history['best_fitness'],
                mode='lines+markers',
                name='Best Cost',
                line=dict(color='blue', width=2)
            ))
            fig.add_trace(go.Scatter(
                x=history['generation'],
                y=history['mean_fitness'],
                mode='lines',
                name='Mean Cost',
                line=dict(color='red', width=1.5, dash='dash')
            ))
            fig.update_layout(
                title="GA Cost Evolution",
                xaxis_title="Generation",
                yaxis_title="Cost",
                height=400
            )
            st.plotly_chart(fig, width='stretch')

        # Display comparison with agentic if available
        if st.session_state.monitor.state_history:
            st.subheader("Comparison: GA vs Agentic")

            # Get final agentic metrics
            final_state = st.session_state.monitor.state_history[-1]['state']
            if final_state.get('results') and final_state['results'].get('metrics'):
                agentic_metrics = final_state['results']['metrics']

                comparison_data = {
                    'Metric': ['MSE', 'Settling Time', 'Overshoot'],
                    'GA': [
                        final_metrics.get('mse', 0),
                        final_metrics.get('settling_time', 0),
                        final_metrics.get('overshoot', 0)
                    ],
                    'Agentic': [
                        agentic_metrics.get('mse', 0),
                        agentic_metrics.get('settling_time', 0),
                        agentic_metrics.get('overshoot', 0)
                    ]
                }

                import pandas as pd
                df = pd.DataFrame(comparison_data)
                st.dataframe(df, width='stretch')

                # Bar chart comparison
                fig_comp = go.Figure()
                fig_comp.add_trace(go.Bar(
                    x=comparison_data['Metric'],
                    y=comparison_data['GA'],
                    name='GA',
                    marker_color='rgb(75, 192, 192)'
                ))
                fig_comp.add_trace(go.Bar(
                    x=comparison_data['Metric'],
                    y=comparison_data['Agentic'],
                    name='Agentic',
                    marker_color='rgb(255, 99, 132)'
                ))
                fig_comp.update_layout(
                    title="Performance Comparison",
                    barmode='group',
                    height=400
                )
                st.plotly_chart(fig_comp, width='stretch')

    elif status == 'error':
        st.error("❌ GA optimization failed!")
        error_msg = st.session_state.ga_results.get('error', 'Unknown error')
        st.error(f"Error: {error_msg}")

        if st.session_state.ga_results.get('traceback'):
            with st.expander("Show Traceback"):
                st.code(st.session_state.ga_results['traceback'])
