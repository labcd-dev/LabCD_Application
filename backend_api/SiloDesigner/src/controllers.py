from typing import Dict, List, Optional, TypedDict, Any
import json
import queue
import os
import numpy as np
import time
from datetime import datetime
from pathlib import Path
from langgraph.graph import StateGraph, START, END
from backend_api.SiloDesigner.src.systems import (GeneralDynamicalSystem, BallBeam, InvertedPendulum, DCMotorPositionControl,
                                                   CustomDynamicalSystem, OctaveSISOSystem, create_system)
from backend_api.SiloDesigner.src.simulation import SimulationRunner
from backend_api.SiloDesigner.src.utils import SharedBuffer, log_to_file
from backend_api.SiloDesigner.src.llm_agents import LLMActor, LLMCritic, LLMTerminator, LLMJuror
from backend_api.SiloDesigner.src.utils import generate_scenario_report_json

logs_dir = Path("./.logs")
logs_dir.mkdir(exist_ok=True)
SCEN_HIST = logs_dir / f"scenario_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def _ensure_running(state: Dict) -> None:
    """Abort the design graph immediately when the user requests cancellation."""
    monitor = state.get("monitor")
    if monitor is not None and not getattr(monitor, "is_running", True):
        from backend_api.SiloDesigner.app import DesignCancelledError

        raise DesignCancelledError("Design cancelled by user")


def initialize_state(
    llm_model: str = "deepseek-r1-distill-llama-70b",
    run_id: int = 1,
    seed: int = 42,
    system_name: str = "ball_beam",
    max_scenarios: int = 3,
    max_iter: int = 10,
    controllers: Optional[List[str]] = None,
    start_controller: Optional[str | int] = None,
    custom_scenarios: Optional[List[Dict]] = None,
    start_scenario_level: int = 1,
    param_ranges: Optional[Dict[str, Dict[str, List[float]]]] = None,
    target_metrics: Optional[Dict[str, float]] = None,
    custom_dynamics_path: Optional[str] = None,
    file_type: str = "Python (.py)",
    matlab_func_name: Optional[str] = None,
    num_states: Optional[int] = None,
    monitor: Optional[Any] = None,
    update_queue: Optional[queue.Queue] = None,
    max_tries: int = 0,
    control_objective: str = "Design a stable controller with minimal settling time, overshoot, and steady-state error.",
    dt: float = 0.01,
    max_time: float = 5.0,
    target: float = 0.0,
    num_inputs: int = 1,
    input_channel: int = 0,
    output_channel: int = 0,
    trim_values: Optional[List[float]] = None,
    min_ctrl: float = -10.0,  # NEW
    max_ctrl: float = 10.0,
    file_content: str = None
) -> Dict:

    # System initialization
    # system = create_system(system_name, None, custom_dynamics_path, file_type, matlab_func_name, num_states, num_inputs)
    # System initialization
    system = create_system(system_name, None, custom_dynamics_path, file_type, matlab_func_name, num_states, num_inputs,
                           file_content=file_content)
    # Configure system parameters
    system.dt = dt
    system.max_time = max_time
    system.target = target
    system.num_inputs = num_inputs
    system.input_channel = input_channel
    system.output_channel = output_channel

    # Set trim values (default to zeros if not provided)
    if trim_values is None:
        system.trim_values = np.zeros(num_inputs)
    else:
        if len(trim_values) != num_inputs:
            raise ValueError(f"trim_values length ({len(trim_values)}) must match num_inputs ({num_inputs})")
        system.trim_values = np.array(trim_values)

    # Create simulator with appropriate system class
    if system_name == "custom" and (custom_dynamics_path or file_content is not None):
        if file_type == "MATLAB/Octave (.m)":
            # Local factory function to capture num_inputs and other params
            def octave_factory(scenario=None):
                return OctaveSISOSystem(
                    custom_dynamics_path,
                    matlab_func_name,
                    num_states if num_states else system.num_states,
                    scenario,
                    num_inputs,
                    file_content=file_content  # <--- ADD THIS
                )

            simulator = SimulationRunner(octave_factory)
        else:  # Python file
            # Local factory function to capture num_inputs
            def custom_factory(scenario=None):
                # <--- ADD file_content=file_content BELOW
                return CustomDynamicalSystem(custom_dynamics_path, scenario, num_inputs, file_content=file_content)

            simulator = SimulationRunner(custom_factory)
    elif system_name == "inverted_pendulum":
        simulator = SimulationRunner(InvertedPendulum)
    elif system_name == "dc_motor":
        simulator = SimulationRunner(DCMotorPositionControl)
    elif system_name == "ball_beam":
        simulator = SimulationRunner(BallBeam)
    else:
        simulator = SimulationRunner(DCMotorPositionControl)  # Default

    # Configure simulator with system parameters
    simulator.set_config(
        dt=dt,
        max_time=max_time,
        target=target,
        num_inputs=num_inputs,
        input_channel=input_channel,
        output_channel=output_channel,
        trim_values=np.array(trim_values) if trim_values else np.zeros(num_inputs),
        min_control=min_ctrl,  # NEW (note: using 'min_control' to match attribute naming in systems.py)
        max_control=max_ctrl,  # NEW (note: using 'max_control' to match attribute naming in systems.py)
        seed=seed
    )

    # Default controller list
    default_controllers = ["P", "PI", "PD", "PID", "FSF"]
    controllers_list = controllers if controllers is not None else default_controllers

    # Default parameter ranges if not provided
    default_param_ranges = {
        "P": {"Kp": [10.0, 60.0]},
        "PI": {"Kp": [10.0, 60.0], "Ki": [0.01, 5.0]},
        "PD": {"Kp": [10.0, 60.0], "Kd": [0.01, 5.0]},
        "PID": {"Kp": [10.0, 60.0], "Ki": [0.01, 5.0], "Kd": [0.01, 20.0]},
        "FSF": {"K1": [0.01, 20.0], "K2": [0.01, 30.0], "K3": [0.01, 100.0], "K4": [0.01, 20.0]}
    }
    param_ranges = param_ranges if param_ranges is not None else default_param_ranges

    # Default target metrics if not provided
    default_target_metrics = {
        "mse": 0.2,
        "settling_time": 4.0,
        "overshoot": 0
        # Removed "max_iterations": max_iter to use only max_iter globally
    }
    target_metrics = target_metrics if target_metrics is not None else default_target_metrics

    # Determine starting controller index
    if start_controller is not None:
        if isinstance(start_controller, str):
            try:
                current_controller_index = controllers_list.index(start_controller)
            except ValueError:
                raise ValueError(f"start_controller '{start_controller}' not in controllers list: {controllers_list}")
        else:
            current_controller_index = start_controller
            if not (0 <= current_controller_index < len(controllers_list)):
                raise ValueError(f"start_controller index {current_controller_index} out of range for controllers list")
    else:
        current_controller_index = 0

    # Validate start_scenario_level
    if start_scenario_level < 1:
        raise ValueError("start_scenario_level must be at least 1")
    if custom_scenarios is not None and start_scenario_level > len(custom_scenarios):
        raise ValueError(f"start_scenario_level {start_scenario_level} exceeds number of scenarios {len(custom_scenarios)}")

    return {
        "llm_model": llm_model,
        "run_id": run_id,
        "seed": seed,
        "system": system,
        "system_name": system_name,
        "system_description": system.description,
        "iteration": 0,
        "max_iterations": max_iter,
        "scenario_level": start_scenario_level,
        "max_scenarios": max_scenarios if custom_scenarios is None else len(custom_scenarios),
        "controllers_list": controllers_list,
        "current_controller_index": current_controller_index,
        "buffer": SharedBuffer(),
        "current_params": None,
        "simulator": simulator,
        "results": None,
        "feedback": None,
        "should_continue": True,
        "should_continue_outer": True,
        "scenario": None,
        "controller_type": None,
        "target_metrics": target_metrics,
        "param_ranges": param_ranges,
        "inner_loop_completed": False,
        "redesign_requested": False,
        "all_scenario_history": [],
        "custom_scenarios": custom_scenarios,
        "range_reconsider_count": {},
        "controller_performance": {},
        "scenario_controller_history": {},
        "monitor": monitor,
        "update_queue": update_queue,
        "max_tries": max_tries,
        "control_objective": control_objective,
        "dt": dt,
        "max_time": max_time,
        "target": target,
        "num_inputs": num_inputs,
        "input_channel": input_channel,
        "output_channel": output_channel,
        "trim_values": trim_values,
        "scenario_start_time": None,  # NEW
    }


def suggest_controller(state: Dict) -> Dict:
    _ensure_running(state)
    print(f"\n=== ðŸŽ›ï¸ SELECTING CONTROLLER FOR SCENARIO {state['scenario_level']} ===")
    controller_type = state["controllers_list"][state["current_controller_index"]]
    state["buffer"].system_name = state["system_name"]
    state["buffer"].system_description = state["system_description"]
    state["buffer"].controller_type = controller_type
    state["buffer"].control_objective = state["control_objective"]

    # PRIORITY 1: Use custom param_ranges from state if provided for this controller
    if state.get("param_ranges") and controller_type in state["param_ranges"]:
        param_ranges = state["param_ranges"][controller_type]
        # NEW: If custom ranges are empty dict, treat as not provided and fall through to PRIORITY 2/3
        if not param_ranges:  # Check if {} or empty
            param_ranges = None
            print(f"âš ï¸ Custom parameter ranges for {controller_type} are empty; falling back to defaults")
        else:
            print(f"âœ“ Using CUSTOM parameter ranges for {controller_type}: {param_ranges}")

    # PRIORITY 2: Try to get from system's schema (only if PRIORITY 1 didn't set valid ranges)
    if param_ranges is None and hasattr(state["system"], 'get_control_param_schema'):
        try:
            param_ranges = state["system"].get_control_param_schema(controller_type)
            # Convert schema format to ranges format
            param_ranges = {k: [v["min"], v["max"]] for k, v in param_ranges.items()}
            print(f"âœ“ Using SYSTEM parameter ranges for {controller_type}: {param_ranges}")
        except Exception as e:
            print(f"âš ï¸ Failed to get system parameter ranges: {e}, using defaults")
            param_ranges = None
    else:
        param_ranges = None  # Already set or skipped

    # PRIORITY 3: Fall back to hardcoded defaults (only if still None)
    if param_ranges is None:
        print(f"âš ï¸ Using DEFAULT parameter ranges for {controller_type}")
        if controller_type == "P":
            param_ranges = {"Kp": [10.0, 60.0]}
        elif controller_type == "PI":
            param_ranges = {"Kp": [10.0, 60.0], "Ki": [0.01, 5.0]}
        elif controller_type == "PD":
            param_ranges = {"Kp": [10.0, 60.0], "Kd": [0.01, 5.0]}
        elif controller_type == "PID":
            param_ranges = {"Kp": [10.0, 60.0], "Ki": [0.01, 5.0], "Kd": [0.01, 20.0]}
        elif controller_type == "FSF":
            # For custom systems, get number of states dynamically (auto-populate as per main.py comment)
            if state["system_name"] == "custom" and hasattr(state["system"], 'num_states'):
                num_states = state["system"].num_states
                param_ranges = {f"K{i + 1}": [0.01, 20.0] for i in range(num_states)}  # Auto-populate based on num_states
                print(f"âœ“ Auto-populated FSF ranges for {num_states} states: {param_ranges}")
            else:
                # Hardcoded fallback for known systems (e.g., ball_beam with 4 states)
                param_ranges = {"K1": [0.01, 20.0], "K2": [0.01, 30.0], "K3": [0.01, 100.0], "K4": [0.01, 20.0]}

    # NEW: Final sanity check - ensure param_ranges is never empty after all priorities
    if not param_ranges:
        raise ValueError(f"Failed to populate param_ranges for {controller_type}; check system schema or defaults")

    state["buffer"].param_ranges = param_ranges

    # Initial parameters (midpoint of ranges)
    initial_params = {key: (rng[0] + rng[1]) / 2 for key, rng in param_ranges.items()}
    initial_params["reasoning"] = f"Initial midpoint values for {controller_type}"

    # Define target metrics - also check for custom target_metrics
    if state.get("target_metrics"):
        target_metrics = state["target_metrics"]
        print(f"âœ“ Using CUSTOM target metrics: {target_metrics}")
    else:
        target_metrics = {
            "mse": 0.2,
            "settling_time": 4.0,
            "overshoot": 0,
            "max_iterations": state["max_iterations"]
        }
        print(f"âœ“ Using DEFAULT target metrics: {target_metrics}")

    state["buffer"].clear_history()
    log_to_file(
        f"\n=== CONTROLLER SELECTED ===\nController: {controller_type}\nParams: {json.dumps(initial_params, indent=2)}")
    print(f"Selected Controller: {controller_type} | Initial Params: {initial_params}")

    return {
        "controller_type": controller_type,
        "current_params": initial_params,
        "target_metrics": target_metrics,
        "iteration": 0
    }


def save_scenario_history(state: Dict) -> None:
    scenario_level = state["scenario_level"]
    controller_type = state["controller_type"]
    llm_model = state["llm_model"]
    run_id = state["run_id"]
    seed = state["seed"]
    model_safe = llm_model.replace("/", "_").replace("-", "_")  # Sanitize model name
    filename = f"scenario_{scenario_level}_{controller_type}_{model_safe}_run_{run_id}.json"
    scenario_data = {
        "scenario_level": scenario_level,
        "controller_type": controller_type,
        "seed": seed,
        "history": []
    }
    for entry in state["buffer"].history:
        history_entry = {
            "iteration": entry.get("iteration", 0),
            "params": entry["params"],
            "metrics": entry["metrics"],  # Save the entire metrics dictionary
            "param_ranges": entry["param_ranges"]  # Include parameter ranges
        }
        scenario_data["history"].append(history_entry)

        # NEW: Include metrics in saved JSON
        scenario_data["scenario_metrics"] = (
                state["buffer"].current_scenario_metrics
                or {'tokens_in': 0, 'tokens_out': 0, 'time': 0.0, 'cost': 0.0}
        )

        SCEN_HIST.mkdir(exist_ok=True)
        file_path = SCEN_HIST / filename
        with open(file_path, "w") as f:
            json.dump(scenario_data, f, indent=2)


def design_scenario(state: Dict) -> Dict:
    _ensure_running(state)
    if state["scenario_level"] > state["max_scenarios"]:
        print("ðŸ Exceeded maximum number of scenarios. Terminating workflow.")
        return {"should_continue_outer": False, "scenario": None}

    print(f"\n=== ðŸŽ­ DESIGNING SCENARIO LEVEL {state['scenario_level']}/{state['max_scenarios']} ===")

    if state.get("custom_scenarios") is not None:
        if state["scenario_level"] <= len(state.get("custom_scenarios", [])):
            scenario_data = state["custom_scenarios"][state["scenario_level"] - 1]
        else:
            print(f"âš ï¸ No custom scenario defined for level {state['scenario_level']}. Terminating workflow.")
            return {"should_continue_outer": False, "scenario": None}
    else:
        if state["scenario_level"] == 1:
            scenario_data = {
                "id": "I",
                "randomness_level": 0.0,
                "param_uncertainty": 0.0,
                "initial_condition_range": [1.0, 1.0],
                "disturbance_level": 0.0,
                "reasoning": "Nominal condition"
            }
        elif state["scenario_level"] == 2:
            scenario_data = {
                "id": "II",
                "randomness_level": 0.005,
                "param_uncertainty": 0.0,
                "initial_condition_range": [1.0, 1.0],
                "disturbance_level": 0.0,
                "reasoning": "Inclusion of measurement noise"
            }
        elif state["scenario_level"] == 3:
            scenario_data = {
                "id": "III",
                "randomness_level": 0.01,
                "param_uncertainty": 0.1,
                "initial_condition_range": [1.0, 1.0],
                "disturbance_level": 1.5,
                "reasoning": "Addition of uncertainty and disturbance"
            }
        else:
            print(f"âš ï¸ No default scenario defined for level {state['scenario_level']}. Terminating workflow.")
            return {"should_continue_outer": False, "scenario": None}

    state["simulator"].set_scenario(scenario_data)
    state["buffer"].scenario = scenario_data

    # Initialize per-scenario metrics and start wall clock timer
    state["buffer"].current_scenario_metrics = {
        'tokens_in': 0,
        'tokens_out': 0,
        'time': 0.0,
        'cost': 0.0
    }
    state["scenario_start_time"] = time.time()  # Make sure this is called

    log_to_file(f"Scenario {state['scenario_level']} started at {datetime.fromtimestamp(state['scenario_start_time'])}")

    log_to_file(f"\n=== SCENARIO LEVEL {state['scenario_level']} ===\n{json.dumps(scenario_data, indent=2)}")
    print(f"Scenario {scenario_data['id']}: IC Range {scenario_data['initial_condition_range']}")

    return {
        "scenario": scenario_data,
        "inner_loop_completed": False,
        "should_continue_outer": True
    }


def propose_parameters(state: Dict) -> Dict:
    """Propose controller parameters (inner loop)"""
    _ensure_running(state)
    actor = LLMActor(model=state["llm_model"], seed=state["seed"], monitor=state["monitor"])
    params = actor.generate_parameters(state["buffer"], state["controller_type"],
                                       state["iteration"], state["max_iterations"],
                                       state["system"])
    return {"current_params": params}


def run_simulation(state: Dict) -> Dict:
    """Run simulation with current parameters"""
    _ensure_running(state)
    params = state["current_params"]
    simulator = state["simulator"]

    # Case 1: Invalid or missing parameters
    if not params:
        log_to_file("â—ï¸Failed to generate valid parameters", True)
        return {
            "results": {
                "success": False,
                "error": "Invalid or missing parameters",
                "metrics": {
                    "mse": float('inf'),
                    "settling_time": float('inf'),
                    "overshoot": float('inf'),
                    "stable": False,
                    "zero_crossings": 0,
                    "control_effort": 0,
                    "control_zero_crossings": 0
                },
                "trajectory": [],
                "control_signals": [],
                "errors": []
            },
            "should_continue": False
        }

    # Run the simulation
    result = simulator.evaluate_parameters(params)

    # Case 2: Simulation failed
    if not result['success']:
        log_to_file(f"â—ï¸Simulation failed: {result['error']}", True)
        return {
            "results": {
                "success": False,
                "error": result['error'],
                "metrics": {
                    "mse": float('inf'),
                    "settling_time": float('inf'),
                    "overshoot": float('inf'),
                    "stable": False,
                    "zero_crossings": 0,
                    "control_effort": 0,
                    "control_zero_crossings": 0
                },
                "trajectory": [],
                "control_signals": [],
                "errors": []
            },
            "should_continue": False
        }

    # Case 3: Simulation succeeded
    return {"results": result}


def evaluate_performance(state: Dict) -> Dict:
    """Evaluate controller performance"""
    _ensure_running(state)
    params = state["current_params"]
    results = state["results"]

    if not results['success']:
        feedback = json.dumps({
            "result_analysis": f"Simulation failed with error: {results['error']}.",
            "suggested_improvements": ["Consider adjusting parameters to avoid instability."]
        })
    else:
        critic = LLMCritic(model=state["llm_model"], seed=state["seed"], monitor=state["monitor"])

        def get_best_performance_from_buffer():
            best_entries = state["buffer"].get_best_entries(1)
            if best_entries:
                return best_entries[0]['params'], best_entries[0]['metrics']
            return None, None

        critic.get_best_performance = get_best_performance_from_buffer

        # Pass buffer to analyze_results so it can update metrics
        feedback = critic.analyze_results(
            params, results['metrics'],
            {'trajectory': results['trajectory'], 'control_signals': results['control_signals'],
             'errors': results['errors']},
            state["buffer"],  # This is already being passed
            state["target_metrics"],
            state["iteration"],
            state["max_iterations"]
        )
    return {"feedback": feedback}


def update_buffer(state: Dict) -> Dict:
    """Update history buffer with results"""
    _ensure_running(state)
    feedback_json = json.loads(state["feedback"])

    # Store current parameter data
    entry_data = {
        'params': state["current_params"],
        'metrics': state["results"]["metrics"],
        'trajectory': state["results"]["trajectory"],
        'control_signals': state["results"]["control_signals"],
        'errors': state["results"]["errors"],
        'feedback': state["feedback"],
        'param_ranges': state["buffer"].param_ranges.copy(),
        'range_change': False
    }

    # Add entry to buffer
    state["buffer"].add_entry(
        state["current_params"],
        state["results"]["metrics"],
        state["results"]["trajectory"],
        state["results"]["control_signals"],
        state["results"]["errors"],
        state["feedback"]
    )

    # Update the latest entry with range information
    if state["buffer"].history:
        last_entry = state["buffer"].history[-1]
        last_entry['param_ranges'] = state["buffer"].param_ranges.copy()
        last_entry['range_changes'] = False

    # Build performance summary line
    metrics = state["results"]["metrics"]
    params = state["current_params"]
    metrics_line = f"#{state['iteration'] + 1}/{state['max_iterations']} | "
    metrics_line += f"Type:{state['controller_type']} | "

    # Add parameters dynamically based on what's in current_params
    param_strings = []
    for param_name, param_value in params.items():
        if param_name != 'reasoning':  # Skip reasoning field
            param_strings.append(f"{param_name}:{param_value:.3f}")

    if param_strings:
        metrics_line += " | ".join(param_strings) + " | "

    # Add standard metrics
    metrics_line += f"MSE:{metrics['mse']:.4f} | "
    metrics_line += f"Ts:{metrics['settling_time']:.2f} | "
    metrics_line += f"Tr:{metrics['rise_time']:.2f} | "
    metrics_line += f"%OS:{metrics['overshoot']:.2f} | "
    metrics_line += f"ZC:{metrics['zero_crossings']} | "
    metrics_line += f"CZC:{metrics['control_zero_crossings']} | "
    metrics_line += f"CE:{metrics['control_effort']:.2f} | "
    metrics_line += f"e_ss:{metrics['ss_error']:.2f} | "
    metrics_line += f"isStb:{metrics['stable']}"

    # Print and log
    print(metrics_line)
    log_to_file(metrics_line)

    # Send metrics to the update queue for the UI
    if 'update_queue' in state and state['update_queue']:
        state['update_queue'].put(metrics_line)
        print("Put metrics_line into queue:", metrics_line)

    # Increment iteration
    state["iteration"] += 1

    return {"iteration": state["iteration"]}


def generate_final_report(state: Dict) -> Dict:
    _ensure_running(state)
    print("\n=== FINAL REPORT ===")
    summary = f"Completed {state['scenario_level'] - 1} of {state['max_scenarios']} scenarios"
    log_to_file(f"\n=== FINAL OPTIMIZATION SUMMARY ===\n{summary}")

    # Generate charts
    charts = []
    for scenario_data in state['all_scenario_history']:
        chart_config = {
            'type': 'line',
            'data': {
                'labels': list(range(len(scenario_data['history']))),
                'datasets': [{
                    'label': f"MSE - {scenario_data['controller_type']}",
                    'data': [entry['metrics']['mse'] for entry in scenario_data['history']],
                    'borderColor': 'rgb(75, 192, 192)',
                    'tension': 0.1
                }]
            },
            'options': {
                'responsive': True,
                'plugins': {
                    'title': {'display': True, 'text': f"Scenario {scenario_data['scenario_level']} Performance"}}
            }
        }
        charts.append(chart_config)

    return {"report_generated": True, "charts": charts}


def should_continue_inner(state) -> str:
    """Decision node for inner loop continuation"""
    if state["should_continue"]:
        return "continue_inner"
    else:
        return "exit_inner"


def should_continue_outer(state) -> str:
    """Decision node for outer loop continuation"""
    if state["should_continue_outer"]:
        return "continue_outer"
    else:
        return "exit_outer"


def needs_controller_redesign(state) -> str:
    """Decision node to determine if we need a controller redesign or new scenario"""
    if state["redesign_requested"]:
        return "redesign_controller"
    else:
        return "new_scenario"


def judge_termination(state: Dict) -> Dict:
    """Judge whether to terminate inner loop, incorporating LLMJuror."""
    _ensure_running(state)
    termination_judge = LLMTerminator(model=state["llm_model"], seed=state["seed"], monitor=state["monitor"])
    juror = LLMJuror(model=state["llm_model"], seed=state["seed"],
                     max_tries=state["max_tries"], monitor=state["monitor"])

    # Handle empty buffer case
    if state["buffer"].history:
        current_metrics = state["results"]["metrics"]
    else:
        current_metrics = {
            "mse": float('inf'),
            "settling_time": float('inf'),
            "overshoot": float('inf'),
            "stable": False
        }

    # Get termination decision
    termination_data, _ = termination_judge.judge_termination(
        state["buffer"],
        current_metrics,
        state["target_metrics"],
        state["max_iterations"],
        state["controller_type"],
        state["system_description"],
        state["iteration"]
    )
    decision = termination_data.get("decision", "CONTINUE")
    log_to_file(f"\n=== TERMINATION DECISION: {decision} ===\n{termination_data.get('reasoning', '')}")

    # Handle TERMINATE_SUCCESS correctly without consulting juror
    if decision == "TERMINATE_SUCCESS":
        print(f"=== ðŸ TERMINATOR DECISION: TERMINATE_SUCCESS === | Reasoning: {termination_data.get('reasoning', '')}")
        inner_loop_completed = True
        should_continue = False
        redesign_requested = False
        return {
            "should_continue": should_continue,
            "inner_loop_completed": inner_loop_completed,
            "redesign_requested": redesign_requested,
            "iteration": state["iteration"]
        }

    elif decision == "TERMINATE_REDESIGN":
        print(f"=== ðŸ TERMINATOR DECISION: TERMINATE_REDESIGN === | Reasoning: {termination_data.get('reasoning', '')}")
        juror_decision = juror.decide(state)

        if juror_decision['decision'] == "RECONSIDER_RANGE":
            print(
                f"=== ðŸ‘¨â€âš–ï¸ JUROR DECISION: RECONSIDER_RANGE === | New Range: {juror_decision['new_range']} | Reasoning: {juror_decision['reasoning']}")

            # Properly mark range change and store range information
            if state["buffer"].history:
                # Mark the last entry as a range change point
                state["buffer"].history[-1]["range_change"] = True
                # Store the old range for reference
                state["buffer"].history[-1]["old_param_range"] = state["buffer"].param_ranges.copy()

            # Update the current parameter ranges
            old_ranges = state["buffer"].param_ranges.copy()
            state["buffer"].param_ranges = juror_decision['new_range']
            state["iteration"] = 0  # Reset iteration counter for new range
            inner_loop_completed = False
            should_continue = True
            redesign_requested = False
            # NEW: Store juror reasoning for continued inner loop (allows actor to see feedback during refinement)
            state["buffer"].latest_juror_feedback = juror_decision['reasoning']

        # Handle REDESIGN_APPROVED (new decision type)
        elif juror_decision['decision'] == "REDESIGN_APPROVED":
            print(f"=== ðŸ‘¨â€âš–ï¸ JUROR DECISION: REDESIGN_APPROVED === | Reasoning: {juror_decision['reasoning']}")
            inner_loop_completed = False
            should_continue = False
            redesign_requested = True
            # NEW: No storage here, as it leads to redesign (cleared in evaluate_scenario_completion)

        # Handle EXPLORE_FURTHER correctly - continue with same controller
        else:  # EXPLORE_FURTHER
            print(f"=== ðŸ‘¨â€âš–ï¸ JUROR DECISION: EXPLORE_FURTHER === | Reasoning: {juror_decision['reasoning']}")
            state["buffer"].latest_juror_feedback = juror_decision['reasoning']  # Store feedback
            inner_loop_completed = False
            should_continue = True  # Continue exploring with current range
            redesign_requested = False
    else:  # CONTINUE
        inner_loop_completed = False
        should_continue = True
        redesign_requested = False

    # Handle max iterations with LLMJuror consultation
    if state["iteration"] >= state["max_iterations"]:
        print(f"=== â±ï¸ Reached max iterations ({state['max_iterations']}) ===")
        juror_decision = juror.decide(state)

        if juror_decision['decision'] == "RECONSIDER_RANGE":
            print(
                f"=== ðŸ‘¨â€âš–ï¸ JUROR DECISION: RECONSIDER_RANGE === | New Range: {juror_decision['new_range']} | Reasoning: {juror_decision['reasoning']}")

            # Properly mark range change and store range information
            if state["buffer"].history:
                # Mark the last entry as a range change point
                state["buffer"].history[-1]["range_change"] = True
                # Store the old range for reference
                state["buffer"].history[-1]["old_param_range"] = state["buffer"].param_ranges.copy()

            # Update the parameter ranges
            state["buffer"].param_ranges = juror_decision['new_range']

            state["iteration"] = 0  # Reset iteration counter for new range
            inner_loop_completed = False
            should_continue = True
            redesign_requested = False
            # NEW: Store juror reasoning for continued inner loop (allows actor to see feedback during refinement)
            state["buffer"].latest_juror_feedback = juror_decision['reasoning']

        # Handle REDESIGN_APPROVED (new decision type)
        elif juror_decision['decision'] == "REDESIGN_APPROVED":
            print(f"=== ðŸ‘¨â€âš–ï¸ JUROR DECISION: REDESIGN_APPROVED === | Reasoning: {juror_decision['reasoning']}")
            should_continue = False
            inner_loop_completed = False
            redesign_requested = True
            # NEW: No storage here, as it leads to redesign (cleared in evaluate_scenario_completion)

        # Handle EXPLORE_FURTHER correctly - continue the inner loop with new iterations
        else:  # EXPLORE_FURTHER
            print(f"=== ðŸ‘¨â€âš–ï¸ JUROR DECISION: EXPLORE_FURTHER === | Reasoning: {juror_decision['reasoning']}")
            state["iteration"] = 0  # Reset iteration counter to allow more iterations
            state["buffer"].latest_juror_feedback = juror_decision['reasoning']  # Store feedback
            should_continue = True  # Continue the inner loop
            inner_loop_completed = False
            redesign_requested = False

    return {
        "should_continue": should_continue,
        "inner_loop_completed": inner_loop_completed,
        "redesign_requested": redesign_requested,
        "iteration": state["iteration"]  # Ensure updated iteration is returned
    }


def evaluate_scenario_completion(state: Dict) -> Dict:
    """Evaluate whether to move to next scenario or try a different controller."""
    _ensure_running(state)
    # NEW: Compute wall clock time FIRST before any branching
    end_time = time.time()
    if state.get("scenario_start_time") is not None:
        duration = end_time - state["scenario_start_time"]
        if state["buffer"].current_scenario_metrics is not None:
            state["buffer"].current_scenario_metrics["time"] = duration  # This accumulates wall-clock + prior LLM times
            log_to_file(f"Scenario {state['scenario_level']} duration: {duration:.2f}s")
    else:
        log_to_file("Warning: scenario_start_time is None, cannot compute duration")

    # NEW: Propagate to monitor if available
    if 'monitor' in state and state['monitor'] and state["buffer"].current_scenario_metrics is not None:
        state['monitor'].add_scenario_metrics(state['scenario_level'], state["buffer"].current_scenario_metrics.copy())

    if state["inner_loop_completed"]:
        print(f"âœ… Scenario {state['scenario_level']} completed successfully!")
        save_scenario_history(state)  # This now has the updated time
        state["buffer"].latest_juror_feedback = None

        # Reset the range_reconsider_count for all controllers when moving to next scenario
        state["range_reconsider_count"] = {}

        # Store current scenario level before incrementing
        completed_level = state["scenario_level"]
        state["scenario_level"] += 1

        # Store in history with completed level
        state["all_scenario_history"].append({
            'scenario_level': completed_level,  # Use the completed level
            'controller_type': state["controller_type"],
            'history': state["buffer"].history.copy(),
            'scenario_metrics': state["buffer"].current_scenario_metrics.copy() if state[
                "buffer"].current_scenario_metrics else {}
        })

        if 'update_queue' in state and state['update_queue']:
            state['update_queue'].put(f"Scenario {completed_level} completed successfully!")

        if state["scenario_level"] > state["max_scenarios"]:
            print(f"ðŸŽ‰ All scenarios completed successfully!")
            state["should_continue_outer"] = False
        else:
            state["should_continue_outer"] = True

    elif state["redesign_requested"]:
        print(f"ðŸ”„ Redesign requested for Scenario {state['scenario_level']}")
        save_scenario_history(state)  # This now has the updated time
        state["buffer"].latest_juror_feedback = None
        state["current_controller_index"] += 1

        # Check if we've tried all controllers
        if state["current_controller_index"] >= len(state["controllers_list"]):
            print(f"âš ï¸ All controllers tried for Scenario {state['scenario_level']} without success")
            print("ðŸ Terminating workflow - no suitable controller found for current scenario.")
            state["should_continue_outer"] = False
        else:
            print(f"â­ï¸ Trying next controller: {state['controllers_list'][state['current_controller_index']]}")
            state["should_continue_outer"] = True
            state["scenario_level"] = 1
    else:
        print(
            f"ðŸ”„ Continuing optimization with current controller: {state['controllers_list'][state['current_controller_index']]} for scenario {state['scenario_level']}")

    # Only reset iteration counter and start time when moving to next controller/scenario
    if state.get("inner_loop_completed", False) or state.get("redesign_requested", False):
        state["iteration"] = 0
        state["scenario_start_time"] = None  # Clear for next scenario

    return state

# State schema
class OptimizationState(TypedDict):
    llm_model: str
    run_id: int
    seed: int
    system: GeneralDynamicalSystem
    system_name: str
    system_description: str
    iteration: int
    max_iterations: int
    scenario_level: int
    max_scenarios: int
    controllers_list: List[str]
    current_controller_index: int
    buffer: SharedBuffer
    current_params: Optional[Dict]
    simulator: SimulationRunner
    results: Optional[Dict]
    feedback: Optional[str]
    should_continue: bool
    should_continue_outer: bool
    scenario: Optional[Dict]
    controller_type: Optional[str]
    target_metrics: Optional[Dict]
    param_ranges: Optional[Dict]
    custom_scenarios: Optional[List[Dict]]
    inner_loop_completed: bool
    redesign_requested: bool
    all_scenario_history: List
    range_reconsider_count: Dict[str, int]
    monitor: Optional[Any]
    update_queue: Optional[queue.Queue]
    max_tries: int
    control_objective: str
    dt: float
    max_time: float
    target: float
    num_inputs: int
    input_channel: int
    output_channel: int
    trim_values: Optional[List[float]]
    scenario_start_time: Optional[float]  # NEW: For wall clock tracking


# Update the needs_controller_redesign function
def needs_controller_redesign(state) -> str:
    """Decision node to determine if we need a controller redesign or new scenario"""
    if state.get("redesign_requested", False):
        return "redesign_controller"
    else:
        return "new_scenario"


# Decision function to handle the flow
def should_restart_optimization(state) -> str:
    """Decision node to determine if we should restart optimization or continue inner loop"""
    # If we completed a scenario or need redesign, go to scenario completion evaluation
    if state.get("inner_loop_completed", False) or state.get("redesign_requested", False):
        return "evaluate_completion"
    else:
        # Continue with the inner loop (this handles EXPLORE_FURTHER case)
        return "continue_inner_loop"


def create_optimization_graph(max_scenarios=3, max_iter=10):
    class OptimizationState(TypedDict):
        llm_model: str
        run_id: int
        seed: int
        system: GeneralDynamicalSystem
        system_name: str
        system_description: str
        iteration: int
        max_iterations: int
        scenario_level: int
        max_scenarios: int
        controllers_list: List[str]
        current_controller_index: int
        buffer: SharedBuffer
        current_params: Optional[Dict]
        simulator: SimulationRunner
        results: Optional[Dict]
        feedback: Optional[str]
        should_continue: bool
        should_continue_outer: bool
        scenario: Optional[Dict]
        controller_type: Optional[str]
        target_metrics: Optional[Dict]
        param_ranges: Optional[Dict]
        custom_scenarios: Optional[List[Dict]]
        inner_loop_completed: bool
        redesign_requested: bool
        all_scenario_history: List
        range_reconsider_count: Dict[str, int]
        monitor: Optional[Any]
        update_queue: Optional[queue.Queue]
        max_tries: int
        control_objective: str
        scenario_start_time: Optional[float]  # NEW: For wall clock tracking

    builder = StateGraph(OptimizationState)
    builder.add_node("suggest_controller", suggest_controller)
    builder.add_node("design_scenario", design_scenario)
    builder.add_node("evaluate_scenario_completion", evaluate_scenario_completion)
    builder.add_node("generate_final_report", generate_final_report)
    builder.add_node("propose_parameters", propose_parameters)
    builder.add_node("run_simulation", run_simulation)
    builder.add_node("evaluate_performance", evaluate_performance)
    builder.add_node("update_buffer", update_buffer)
    builder.add_node("judge_termination", judge_termination)

    builder.add_edge(START, "suggest_controller")
    builder.add_edge("suggest_controller", "design_scenario")
    builder.add_edge("design_scenario", "propose_parameters")
    builder.add_edge("propose_parameters", "run_simulation")
    builder.add_edge("run_simulation", "evaluate_performance")
    builder.add_edge("evaluate_performance", "update_buffer")
    builder.add_edge("update_buffer", "judge_termination")

    builder.add_conditional_edges(
        "judge_termination",
        lambda state: "continue_inner" if state["should_continue"] else "evaluate_completion",
        {
            "continue_inner": "propose_parameters",
            "evaluate_completion": "evaluate_scenario_completion"
        }
    )

    builder.add_conditional_edges(
        "evaluate_scenario_completion",
        should_continue_outer,
        {"continue_outer": "suggest_controller", "exit_outer": "generate_final_report"}
    )

    builder.add_edge("generate_final_report", END)
    graph = builder.compile()
    config = {"max_scenarios": max_scenarios, "max_iterations": max_iter}
    return graph, config


def run_optimization(
    llm_model: str = "deepseek-r1-distill-llama-70b",
    run_id: int = 1,
    seed: int = 42,
    system_name: str = "ball_beam",
    max_scenarios: int = 3,
    max_iter: int = 10,
    controllers: Optional[List[str]] = None,
    start_controller: Optional[str | int] = None,
    custom_scenarios: Optional[List[Dict]] = None,
    start_scenario_level: int = 1,
    param_ranges: Optional[Dict[str, Dict[str, List[float]]]] = None,
    target_metrics: Optional[Dict[str, float]] = None,
    custom_dynamics_path: Optional[str] = None,
    file_type: str = "Python (.py)",
    matlab_func_name: Optional[str] = None,
    num_states: Optional[int] = None,
    update_queue: Optional[queue.Queue] = None,
    max_tries: int = 0,
    control_objective: str = "Design a stable controller with minimal settling time, overshoot, and steady-state error.",
    dt: float = 0.01,
    max_time: float = 5.0,
    target: float = 0.0,
    num_inputs: int = 1,
    input_channel: int = 0,
    output_channel: int = 0,
    trim_values: Optional[List[float]] = None,
    min_ctrl: float = -10.0,  # NEW
    max_ctrl: float = 10.0,
    file_content: str = None,
):
    graph, config = create_optimization_graph(max_scenarios, max_iter)
    initial_state = initialize_state(
        llm_model=llm_model,
        run_id=run_id,
        seed=seed,
        system_name=system_name,
        max_scenarios=max_scenarios,
        max_iter=max_iter,
        controllers=controllers,
        start_controller=start_controller,
        custom_scenarios=custom_scenarios,
        start_scenario_level=start_scenario_level,
        param_ranges=param_ranges,
        target_metrics=target_metrics,
        custom_dynamics_path=custom_dynamics_path,
        file_type=file_type,
        matlab_func_name=matlab_func_name,
        num_states=num_states,
        monitor=None,
        update_queue=update_queue,
        max_tries=max_tries,
        control_objective=control_objective,
        dt=dt,
        max_time=max_time,
        target=target,
        num_inputs=num_inputs,
        input_channel=input_channel,
        output_channel=output_channel,
        trim_values=trim_values,
        min_ctrl=min_ctrl,  # NEW
        max_ctrl=max_ctrl,  # NEW
        file_content=file_content,
    )
    log_to_file(f"=== CONTROL OPTIMIZATION LOG - {datetime.now()} ===\n\n", True)
    for _ in graph.stream(initial_state, config={"recursion_limit": 1000}):
        pass

    # NEW: Generate report for the most recent saved scenario JSON file
    json_files = list(SCEN_HIST.glob("*.json"))
    if json_files:
        most_recent = max(json_files, key=os.path.getmtime)
        print(
            f"Generating report for the most recent scenario file: {most_recent.name} (mod time: {datetime.fromtimestamp(os.path.getmtime(most_recent))})")
        generate_scenario_report_json(str(most_recent))  # Pass full path
    else:
        print("No scenario JSON files found; skipping report generation.")
