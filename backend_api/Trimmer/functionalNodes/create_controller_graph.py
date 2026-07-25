"""
create_controller_graph.py - Deterministic logic and visualization

This module contains functional nodes that handle "hard-coded" tasks not requiring LLM,
such as solving equations, analysis, and generating visualizations.
"""

from backend_api.Trimmer.states import WorkflowState
from backend_api.Trimmer.agenticNodes.tools.tools import (
    compute_jacobian,
    analyze_stability,
    validate_constraints
)
from backend_api.Trimmer.agenticNodes.agents import Agents
import numpy as np
import json
import matplotlib.pyplot as plt
from scipy.integrate import odeint
import sys
from datetime import datetime


def make_serializable(obj):
    if callable(obj):
        return str(obj)
    elif hasattr(obj, 'tolist'):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: make_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [make_serializable(item) for item in obj]
    else:
        try:
            json.dumps(obj)
            return obj
        except TypeError:
            return str(obj)


class Plotter:
    """Visualization tool for time-domain simulation."""
    def __init__(self, system_f, params, x_e, u_e):
        self.system_f = system_f
        self.params = params
        self.x_e = x_e
        self.u_e = u_e

    def simulate_response(self, t_span, x0):
        def ode_func(x, t):
            y = self.system_f(x, self.u_e, self.params)
            # Flatten nested lists/arrays to 1D array for odeint
            if isinstance(y, (list, tuple, np.ndarray)):
                flat = []
                for item in y:
                    if isinstance(item, (list, tuple, np.ndarray)):
                        flat.extend(item)
                    else:
                        flat.append(item)
                return np.array(flat)
            else:
                return np.array([y])
        sol = odeint(ode_func, x0, t_span)
        return sol

    def plot_time_response(self, t_span, x0, labels, save_path=None):
        sol = self.simulate_response(t_span, x0)
        n = len(labels)
        plt.rcParams['mathtext.default'] = 'regular'
        plt.style.use('classic')
        fig, axes = plt.subplots(n, 1, figsize=(10, 2.5*n))
        if n == 1: axes = [axes]
        for i in range(n):
            axes[i].plot(t_span, sol[:, i], 'b-', linewidth=2, label=f'{labels[i]}')
            axes[i].plot(t_span, [self.x_e[i]] * len(t_span), 'r--', linewidth=1.5, label=f'Equilibrium ({self.x_e[i]:.4g})')
            axes[i].set_xlabel('Time [s]', fontsize=10)
            axes[i].set_ylabel(labels[i], fontsize=10)
            axes[i].legend(loc='best', fontsize=9)
            axes[i].grid(True)
            axes[i].ticklabel_format(axis='y', style='plain', useOffset=False)
        plt.tight_layout()
        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            print(f"Plot saved to {save_path}")
        plt.show()


def analyze_result(state: WorkflowState, writer, agents) -> WorkflowState:
    """
    Node for linearization, stability analysis, and validation.

    This functional node handles deterministic analysis tasks while delegating
    LLM-based assessments to agenticNodes as per architecture guidelines.
    """
    writer({"progress": 0.9, "text": "ðŸ§ Analysing Result ..."})

    logger = state['logger']
    logger.info("--- Entering Node: analyze_result ---")

    config = state['config']

    output_text = "\n[3/3] Analysis Agent: Linearization and validation..."

    # Check if equilibrium matches desired operating conditions
    operating_conditions = config.get('operating_conditions', {})
    has_operating_conditions = bool(operating_conditions)
    desired_check_skipped = False
    match = None
    analysis = ""
    llm_analysis = ""

    if not has_operating_conditions:
        desired_check_skipped = True
        match = True
        analysis = "No desired operating conditions were provided; skipped equilibrium-match check."
    elif state.get('x_e') is None or state.get('u_e') is None:
        match = False
        analysis = "Equilibrium result is incomplete; cannot validate against operating conditions."
    elif operating_conditions and state.get('x_e') is not None and state.get('u_e') is not None:
        x_desired = operating_conditions.get('x_desired')

        if x_desired is not None:
            # Direct state comparison (deterministic logic in functionalNodes)
            x_desired = np.array(x_desired, dtype=np.float64)
            x_e = state['x_e']
            tolerance = 1e-6
            x_match = np.allclose(x_e, x_desired, atol=tolerance, rtol=1e-5)
            match = x_match

            if match:
                analysis = "Equilibrium state successfully matches desired operating conditions."
            else:
                x_diff = x_e - x_desired
                max_x_error = np.max(np.abs(x_diff))
                max_x_idx = np.argmax(np.abs(x_diff))
                analysis = (
                    f"State mismatch: max error = {max_x_error:.2e} at index {max_x_idx} "
                    f"(desired: {x_desired[max_x_idx]:.6f}, got: {x_e[max_x_idx]:.6f})"
                )
        else:
            # Trimming system: dynamics check in functionalNodes + LLM assessment in agenticNodes
            dynamics_ok = False
            dx_dt_norm = float('inf')

            if config.get('system_f') and callable(config.get('system_f')):
                dx_dt_raw = config.get('system_f')(state['x_e'], state['u_e'], config.get('params', {}))
                def flatten(obj):
                    if isinstance(obj, (list, tuple, np.ndarray)):
                        flat = []
                        for item in obj:
                            flat.extend(flatten(item))
                        return flat
                    else:
                        return [obj]
                dx_dt = np.array(flatten(dx_dt_raw), dtype=np.float64)
                # For trimming, ignore translational-position derivatives (e.g., X/Y/Z),
                # which are typically nonzero in steady motion.
                translational_position_names = {
                    "x", "y", "z",
                    "xpos", "ypos", "zpos",
                    "x_pos", "y_pos", "z_pos",
                    "posx", "posy", "posz",
                    "position_x", "position_y", "position_z",
                    "north", "east", "down", "n", "e", "d"
                }
                state_vars = config.get('state_vars', [])
                residual_mask = np.ones(len(dx_dt), dtype=bool)
                if state_vars and len(state_vars) == len(dx_dt):
                    for i, var_name in enumerate(state_vars):
                        if str(var_name).strip().lower() in translational_position_names:
                            residual_mask[i] = False
                    if not np.any(residual_mask):
                        residual_mask[:] = True
                dx_dt_eval = dx_dt[residual_mask]
                dx_dt_norm = np.linalg.norm(dx_dt_eval)
                dynamics_ok = dx_dt_norm < 1e-6

            # Use agenticNodes for LLM assessment
            try:
                equilibrium_check_agent = agents.equilibrium_check(state)


                # Prepare agent state
                agent_state = {
                    'system_name': config.get('system_name', 'Unknown'),
                    'operating_conditions': str(operating_conditions),
                    'x_e': state['x_e'].tolist() if hasattr(state['x_e'], 'tolist') else list(state['x_e']),
                    'params': str(config.get('params', {})),
                    'dynamics_check': 'PASS' if dynamics_ok else f'FAIL (dx/dt norm = {dx_dt_norm:.2e})'
                }

                result_state = equilibrium_check_agent(agent_state)
                check_result = result_state.get('equilibrium_check_result', {})
                llm_analysis = check_result.get('explanation', '')

                output_text += "\n\n"
                output_text += str(llm_analysis)
                output_text += "\n\n"


                # Keep pass/fail deterministic based on dynamics residual,
                # use LLM output as supplemental explanation.
                match = dynamics_ok
                analysis = f"Dynamics check: {'PASS' if dynamics_ok else 'FAIL'} (norm = {dx_dt_norm:.2e})"
                if llm_analysis:
                    analysis = f"{analysis} | LLM: {llm_analysis}"

            except Exception as e:
                logger.warning(f"Equilibrium check agent failed: {e}. Using fallback.")
                # Fallback: only check dynamics
                match = dynamics_ok
                analysis = f"Dynamics check: {'PASS' if dynamics_ok else 'FAIL'} (norm = {dx_dt_norm:.2e})"

    state['equilibrium_match'] = match
    state['trace'] = state.get('trace', []) + [{
        'agent': 'AnalysisAgent',
        'action': 'equilibrium_vs_desired_check',
        'match': match,
        'analysis': analysis,
        'llm_analysis': llm_analysis
    }]

    # Always perform linearization and stability analysis if converged, matching base_code behavior
    if state.get('converged'):
        output_text += "\n\n  âœ“ Converged! Performing linearization and stability analysis..."
        logger.info("Equilibrium found. Performing full analysis.")

        # Perform linearization and stability analysis using tools
        if config.get('system_f') and callable(config.get('system_f')) and state.get('x_e') is not None and state.get('u_e') is not None:
            A, B, jac_trace = compute_jacobian(
                config.get('system_f'), state['x_e'], state['u_e'], config.get('params', {})
            )
            eigenvalues, eigvals_complex, classification, stab_trace = analyze_stability(A)
            feasible, constraint_trace = validate_constraints(
                state['x_e'], state['u_e'], config.get('bounds', {})
            )

            state.update({
                'A': A, 'B': B, 'eigenvalues': eigenvalues, 'classification': classification,
                'feasible': feasible, 'trace': state.get('trace', []) + [jac_trace, stab_trace, constraint_trace]
            })
        else:
            logger.warning("Cannot perform linearization: missing system function or equilibrium.")
            state.update({'A': None, 'B': None, 'eigenvalues': [], 'classification': 'unknown', 'feasible': False})

        # Handle equilibrium match logic for restart
        if match:
            if desired_check_skipped:
                output_text += "\nâœ“ No desired operating conditions provided; skipping match check."
            else:
                output_text += "\nâœ“ Equilibrium matches desired operating conditions!"
            if analysis:
                output_text += f"\n    {analysis}"
            state['restart_count'] = 0
        else:
            output_text += "\n  âœ— Equilibrium does NOT match desired operating conditions."
            if analysis:
                output_text += f"\n    {analysis}"
            logger.warning("Equilibrium mismatch detected.")
            state['restart_count'] = state.get('restart_count', 0) + 1
    else:
        logger.warning("Did not converge, skipping analysis.")
        state.update({'A': None, 'B': None, 'eigenvalues': [], 'classification': 'unknown', 'feasible': False})

    if state['ui_mode'] == 'streamlit':
        writer({"agent_tag": "ðŸ§.Equilibrium Check", "log_history": output_text})
    else:
        print(output_text)

    return state


def handle_convergence_failure(state: WorkflowState, writer, agents) -> WorkflowState:
    return handle_human_intervention(state, "Solver failed to converge", writer, agents)

def handle_mismatch_failure(state: WorkflowState, writer, agents) -> WorkflowState:
    return handle_human_intervention(state, "Equilibrium does not match desired conditions", writer, agents)


def handle_human_intervention(state: WorkflowState, failure_type: str, writer, agents) -> WorkflowState:
    """Node to handle human intervention."""
    writer({"progress": 0.9, "text": "ðŸ¤– Human Intervention ..."})

    logger = state['logger']
    logger.info(f"--- Entering Node: handle_human_intervention ({failure_type}) ---")

    output_text = f"\n\nðŸ¤– {failure_type}. Invoking human intervention..."

    augmented_trace = state['trace'] + [{
        "agent": "System",
        "info": "Failure Context",
        "failure_reason": failure_type,
        "params": state['config'].get('params'),
        "system_code": state['config'].get('system_f_code')
    }]

    config = state['config']
    intervention_agent = agents.human_intervention(state)

    agent_state = {
        'system_name': config.get('system_name', 'Unknown'),
        'max_restarts': state['max_restarts'],
        'restart_count': state['restart_count'],
        'trace': augmented_trace[-20:],
        'trace_summary': '\n'.join([f"{entry.get('agent', 'Unknown')}: {entry.get('action', 'Unknown')}" for entry in augmented_trace[-20:]]),
        'x_e': state.get('x_e'),
        'u_e': state.get('u_e'),
        'converged': state.get('converged', False),
        'equilibrium_match': state.get('equilibrium_match', False),
        'operating_conditions': config.get('operating_conditions', {}),
        'initial_guess': state.get('initial_guess', []),
        'bounds': config.get('bounds', {}),
        'system_info': f"System dynamics function:\n{config.get('system_f_code', '')}\n\nSystem parameters: {config.get('params', {})}\n\nSystem dimensions: {config.get('n_x', 0)} states, {config.get('n_u', 0)} inputs\n\nState variables: {', '.join(config.get('state_vars', []))}\n\nInput variables: {', '.join(config.get('input_vars', []))}"
    }

    output_text += f"\n\nðŸ¤– HumanInterventionAgent: Analyzing workflow failure..."

    try:
        result_state = intervention_agent(agent_state)
    except Exception as e:
        logger.warning("Human intervention agent failed: %s. Falling back to default action.", e)
        result_state = {}

    raw_intervention_result = (
        result_state.get('human_intervention_result')
        or result_state.get('result')
        or {}
    )
    llm_result = raw_intervention_result if isinstance(raw_intervention_result, dict) else {}

    action = llm_result.get('action')
    root_cause = llm_result.get('root_cause', 'unknown')
    explanation = llm_result.get('explanation', '')
    confidence = llm_result.get('confidence')

    valid_actions = {
        "ask_new_desired_conditions",
        "ask_new_initial_values",
        "ask_new_states",
        "ask_new_bounds",
        "exit",
        "retry",
    }

    if action in valid_actions:
        try:
            conf_txt = f"{float(confidence):.2f}" if confidence is not None else "N/A"
        except Exception:
            conf_txt = str(confidence)
        output_text += f"\n  ðŸ“‹ Diagnosis: {root_cause} (confidence: {conf_txt})"
        output_text += f"\n  ðŸ’¡ Recommended action: {action}"
        if explanation:
            output_text += f"\n  ðŸ“ Explanation: {explanation}"
    else:
        action = "ask_new_desired_conditions"
        root_cause = "unknown"
        explanation = "LLM analysis unavailable or invalid; prompting for new desired conditions as fallback."
        output_text += "\n  âš  LLM analysis unavailable/invalid. Using default action: ask_new_desired_conditions."

    output_text += "\n  ðŸ§¾ Human intervention output:"
    output_text += "\n    " + json.dumps(
            {
                "root_cause": root_cause,
                "action": action,
                "explanation": explanation,
                "confidence": confidence,
            },
            ensure_ascii=True,
        )



    intervention_result, output_text = _execute_human_intervention_action(
        action=action,
        root_cause=root_cause,
        explanation=explanation,
        operating_conditions=config.get('operating_conditions', {}),
        initial_guess=state.get('initial_guess', []),
        bounds=config.get('bounds', {}),
        output_text = output_text
    )

    state['trace'].append({'agent': 'HumanInterventionAgent', 'output': intervention_result})
    should_exit = intervention_result.get('exit', False)

    if should_exit:
        root_cause = intervention_result.get('root_cause')
        if root_cause not in ['success', 'best_possible_solution', 'model_problem']:
            output_text += "\n\nâŒ User chose to exit workflow."
        logger.info(f"User chose to exit workflow. Root cause: {root_cause}")
        if root_cause == 'best_possible_solution':
            state['user_choice'] = 'exit_best_possible'
        else:
            state['user_choice'] = 'exit'
    else:
        logger.info("Continuing workflow with updated inputs from user.")
        output_text += "\n\nðŸ”„ Continuing workflow with updated inputs..."
        state['restart_count'] = 0

        action = intervention_result.get('action')
        new_inputs = intervention_result.get('new_inputs', {})
        if new_inputs.get('restart_from_parser', False):
            if action == "ask_new_desired_conditions":
                state['user_choice'] = 'validate_config_only'
                if 'config' in state:
                    state['config']['operating_conditions'] = {}
            else:
                state['user_choice'] = 'restart_from_parser'
                state['config'] = {}
        elif action == "ask_new_bounds":
            state['user_choice'] = 'replan'
            if 'bounds' in new_inputs:
                state['config']['bounds'] = new_inputs['bounds']
        elif action == "ask_new_desired_conditions":
            state['user_choice'] = 'validate_config_only'
        elif action == "ask_new_initial_values":
            state['user_choice'] = 'retry_solver_with_new_guess'
            if 'initial_guess' in new_inputs:
                state['initial_guess'] = new_inputs['initial_guess']
        elif action == "retry":
            if failure_type == "Solver failed to converge":
                state['user_choice'] = 'retry_solver'
            else:
                state['user_choice'] = 'replan'
        else:
            state['user_choice'] = 'replan'

    if state['ui_inputs'] == 'streamlit':
        writer({"agent_tag": "ðŸ¤–.Human Intervention", "log_history": output_text})
    else:
        print(output_text)

    return state


def _execute_human_intervention_action(action, root_cause, explanation, operating_conditions, initial_guess, bounds, output_text):
    """Execute base-code style human intervention action by prompting the user."""
    result = {
        'action': action,
        'root_cause': root_cause,
        'explanation': explanation,
        'new_inputs': {},
        'exit': False
    }

    interactive_session = bool(getattr(sys.stdin, "isatty", lambda: False)())
    if (not interactive_session) and action in {
        "ask_new_desired_conditions",
        "ask_new_initial_values",
        "ask_new_states",
        "ask_new_bounds",
    }:
        output_text += "\n\nâš  Non-interactive session detected. Manual intervention inputs are unavailable."
        output_text += "\n   Recommended action '{action}' cannot be executed automatically."
        output_text += "\n   Exiting after reporting intervention analysis."
        result['action'] = 'exit'
        result['explanation'] = (
            f"{explanation} Manual input is required, but stdin is non-interactive."
        ).strip()
        result['exit'] = True
        return result, output_text

    if action == "exit":
        if root_cause == 'model_problem':
            output_text += "\n\nâŒ The model has a problem. Terminating the process."
        elif root_cause == 'best_possible_solution':
            output_text += "\n\nâœ… Accepting best possible solution. Terminating the process."
        else:
            output_text += "\n\nâŒ User chose to exit workflow."
        result['exit'] = True
        return result, output_text

    if action == "ask_new_desired_conditions":
        output_text += "\n\nðŸ”„ Restarting from parser to specify new desired operating conditions..."
        result['new_inputs']['restart_from_parser'] = True
        return result, output_text

    if action == "ask_new_initial_values":
        output_text += "\n\nâ“ Let's update the initial guess values."
        output_text += "\n   Current initial guess: {initial_guess}"
        output_text += "\n   Please enter new values separated by commas (press Enter to keep current):"

        user_input = input("   New initial guess: ").strip()
        if user_input:
            try:
                new_guess = [float(x.strip()) for x in user_input.split(',')]
                result['new_inputs']['initial_guess'] = new_guess
                output_text += "\n   âœ“ Updated initial guess to: {new_guess}"
            except ValueError:
                output_text += "\n   âš  Invalid input format. Please enter numbers separated by commas."
                output_text += "\n   Keeping current initial guess: {initial_guess}"
        else:
            output_text += "\n   â†’ Keeping current initial guess: {initial_guess}"
        return result, output_text

    if action == "ask_new_states":
        output_text += "\n\nâ“ Let's update the state configuration."
        output_text += "\n   Current bounds: {json.dumps(bounds, indent=2)}"
        output_text += "\n   This will restart the system parsing. Are you sure? (y/n):"

        confirm = input("   Confirm restart: ").strip().lower()
        if confirm == 'y':
            output_text += "\n   Please provide the path to your new system configuration file:"
            config_path = input("   Config file path: ").strip()
            if config_path:
                result['new_inputs']['config_path'] = config_path
                result['new_inputs']['restart_from_parser'] = True
                output_text += "\n   âœ“ Will restart from parser with new config: {config_path}"
            else:
                output_text += "\n   âš  No path provided. Keeping current configuration."
        else:
            output_text += "\n   â†’ Keeping current state configuration."
        return result, output_text

    if action == "ask_new_bounds":
        output_text += "\n\nâ“ Let's update the bounds for state and input variables."
        output_text += "\n   Current bounds: {json.dumps(bounds, indent=2)}"
        output_text += "\n   Please enter new bounds for each variable (press Enter to keep current):"

        new_bounds = bounds.copy() if isinstance(bounds, dict) else {}
        for bound_type in ['x_min', 'x_max', 'u_min', 'u_max']:
            if bound_type in bounds:
                current_values = bounds[bound_type]
                output_text += "\n   {bound_type} (current: {current_values}):"
                user_input = input(f"     Enter {len(current_values)} values separated by commas: ").strip()
                if user_input:
                    try:
                        new_values = [float(x.strip()) for x in user_input.split(',')]
                        if len(new_values) == len(current_values):
                            new_bounds[bound_type] = new_values
                            output_text += "\n     âœ“ Updated {bound_type} to: {new_values}"
                        else:
                            output_text += "\n     âš  Expected {len(current_values)} values, got {len(new_values)}. Keeping current."
                    except ValueError:
                        output_text += "\n     âš  Invalid input format. Keeping current {bound_type}: {current_values}"
                else:
                    output_text += "\n     â†’ Keeping {bound_type}: {current_values}"

        result['new_inputs']['bounds'] = new_bounds
        output_text += "\n\n   âœ“ Bounds updated successfully!"
        return result, output_text

    if action == "retry":
        output_text += "\n\nðŸ”„ Retrying with current inputs."
        return result, output_text

    output_text += "\n\nâš  Unknown action: {action}. Retrying with current inputs."
    result['action'] = 'retry'
    return result, output_text


def generate_output(state: WorkflowState) -> WorkflowState:
    """Node to generate the final structured output."""
    logger = state['logger']
    logger.info("--- Entering Node: generate_output ---")

    config = state['config']
    n_x = config.get('n_x', 0)
    n_u = config.get('n_u', 0)

    if state.get('user_choice') == 'exit' and not state.get('converged') and not state.get('equilibrium_match'):
        logger.info("Full workflow trace (for debugging): %s", json.dumps(make_serializable(state['trace']), indent=2))
        result = {
            "error": "User chose to exit workflow before convergence.",
            "diagnostics": {"converged": False, "feasible": False}
        }
    else:
        result = {
            "system": {
                "name": config.get('system_name', 'N/A'),
                "n_states": n_x,
                "n_inputs": n_u,
                "n_outputs": n_x,
                "state_variables": config.get('state_vars', []),
                "input_variables": config.get('input_vars', []),
                "parameters": config.get('params', {})
            },
            "equilibrium": {
                "x_e": state['x_e'].tolist() if state.get('x_e') is not None else None,
                "u_e": state['u_e'].tolist() if state.get('u_e') is not None else None,
                "y_e": state['x_e'].tolist() if state.get('x_e') is not None else None
            },
            "linearized": {
                "A": state['A'].tolist() if state.get('A') is not None else None,
                "B": state['B'].tolist() if state.get('B') is not None else None,
                "C": np.eye(n_x).tolist() if n_x > 0 else [],
                "D": np.zeros((n_x, n_u)).tolist() if n_x > 0 and n_u > 0 else []
            },
            "stability": {
                "eigenvalues": state.get('eigenvalues', []),
                "classification": state.get('classification', 'unknown')
            },
            "diagnostics": {
                "converged": bool(state.get('converged')),
                "feasible": bool(state.get('feasible')),
                "equilibrium_match": bool(state.get('equilibrium_match')),
                "timestamp": datetime.now().isoformat()
            }
        }
        if state.get('user_choice') == 'exit':
             result['diagnostics']['exit_reason'] = 'User chose to exit after finding a non-matching equilibrium.'
        elif state.get('user_choice') == 'exit_best_possible':
             result['diagnostics']['exit_reason'] = 'Best possible solution accepted.'

    logger.info("Full workflow trace (for debugging): %s", json.dumps(make_serializable(state['trace']), indent=2))
    logger.info("Workflow completed.")
    state['final_result'] = result
    return state

