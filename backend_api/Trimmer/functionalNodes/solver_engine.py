
import numpy as np
import re

from backend_api.Trimmer.states import WorkflowState
from backend_api.Trimmer.agenticNodes.agents import Agents
from backend_api.Trimmer.agenticNodes.tools.tools import solve_equilibrium as solve_equilibrium_tool


def plan_strategy(state: WorkflowState, writer, agents) -> WorkflowState:
    """Node to plan the solving strategy using YAML-driven agent."""
    writer({"progress": 0.5, "text": "ðŸ§  Planing Strategy..."})

    logger = state['logger']
    logger.info("--- Entering Node: plan_strategy ---")

    config = state['config']

    # Use YAML-driven agent from agenticNodes
    plan_agent = agents.plan_strategy(state)

    # Prepare agent state
    # TODO: this is look like to be extra work
    agent_state = {
        'system_name': config.get('system_name', 'Unknown'),
        'params': config.get('params', {}),
        'operating_conditions': config.get('operating_conditions', {}),
        'state_vars': config.get('state_vars', []),
        'n_x': config.get('n_x', 0),
        'n_u': config.get('n_u', 0),
        'bounds': config.get('bounds', {}),
        'trace': state.get('trace', [])
    }

    # Invoke agent
    result_state = plan_agent(agent_state)
    result = result_state.get('strategy_result', {})
    output_text = str(result)

    initial_guess = result.get('initial_guess', [0.0] * (config.get('n_x', 0) + config.get('n_u', 0)))
    strategy = result.get('strategy', 'least_squares')
    reasoning = result.get('reasoning', '')

    logger.info("Planner output: initial_guess=%s, strategy=%s", initial_guess, strategy)
    output_text += f"\n\n[1/3] Planner Agent: Determining strategy..."
    output_text += f"\n  â†’ Initial guess: {initial_guess}"
    output_text += f"\n  â†’ Strategy: {strategy}"
    if reasoning:
        output_text += f"\n  â†’ Reasoning: {reasoning}"

    # Ensure initial guess is numeric and within provided bounds (clip to bounds)
    init_guess_arr = np.array(initial_guess, dtype=np.float64)
    b = config.get('bounds', {}) or {}
    # Clip states
    if b.get('x_min') is not None and b.get('x_max') is not None:
        x_min = np.array(b['x_min'], dtype=float)
        x_max = np.array(b['x_max'], dtype=float)
        # pad/truncate to n_x
        if x_min.size < config.get('n_x', 0):
            x_min = np.resize(x_min, config.get('n_x', 0))
        if x_max.size < config.get('n_x', 0):
            x_max = np.resize(x_max, config.get('n_x', 0))
        for i in range(config.get('n_x', 0)):
            if not np.isnan(init_guess_arr[i]):
                if x_min[i] is not None:
                    init_guess_arr[i] = max(init_guess_arr[i], float(x_min[i]))
                if x_max[i] is not None:
                    init_guess_arr[i] = min(init_guess_arr[i], float(x_max[i]))

    # Clip inputs
    if b.get('u_min') is not None and b.get('u_max') is not None:
        u_min = np.array(b['u_min'], dtype=float)
        u_max = np.array(b['u_max'], dtype=float)
        if u_min.size < config.get('n_u', 0):
            u_min = np.resize(u_min, config.get('n_u', 0))
        if u_max.size < config.get('n_u', 0):
            u_max = np.resize(u_max, config.get('n_u', 0))
        for j in range(config.get('n_u', 0)):
            idx = config.get('n_x', 0) + j
            if not np.isnan(init_guess_arr[idx]):
                if u_min[j] is not None:
                    init_guess_arr[idx] = max(init_guess_arr[idx], float(u_min[j]))
                if u_max[j] is not None:
                    init_guess_arr[idx] = min(init_guess_arr[idx], float(u_max[j]))

    state['initial_guess'] = init_guess_arr
    state['strategy'] = strategy
    state['trace'] = result_state.get('trace', state.get('trace', []))

    if state["ui_mode"] == "streamlit":
        writer({"agent_tag": "ðŸ§ .Strategy Planner", "log_history": output_text})
    else:
        print(output_text)

    return state


def solve_equilibrium_node(state: WorkflowState, writer, agents) -> WorkflowState:
    """Node to find the equilibrium point using numerical tools with adaptive retry logic."""
    writer({"progress": 0.8, "text": "ðŸ‘¨â€ðŸ« Solving Equation..."})

    logger = state['logger']
    logger.info("--- Entering Node: solve_equilibrium ---")

    config = state['config']
    max_retries = 2
    tolerance = 1e-8

    output_text = f"\n[2/3] Solver: Finding equilibrium\n\n (attempt {state['restart_count'] + 1}/{state['max_restarts']})..."

    # Get initial parameters
    current_guess = np.array(state['initial_guess'], dtype=np.float64)
    current_strategy = state['strategy']
    best_cost = float('inf')
    best_x_e, best_u_e = None, None
    best_converged = False
    best_trace_entry = None

    # Override current_guess with operating_conditions for fixed states
    operating_conditions = config.get('operating_conditions')
    if operating_conditions is not None:
        state_vars = config.get('state_vars', [])
        state_map = {var: i for i, var in enumerate(state_vars)} if state_vars else {}
        for i in range(config.get('n_x', 0)):
            key = f'x{i + 1}'
            if key in operating_conditions:
                current_guess[i] = float(operating_conditions[key])
            # Also check by variable name
            if state_vars and i < len(state_vars) and state_vars[i] in operating_conditions:
                current_guess[i] = float(operating_conditions[state_vars[i]])

    for attempt in range(max_retries):
        # Use tools from agenticNodes.tools
        x_e, u_e, converged, cost, message, trace_entry = solve_equilibrium_tool(
            system_f=config.get('system_f'),
            initial_guess=current_guess,
            params=config.get('params', {}),
            n_x=config.get('n_x', 0),
            n_u=config.get('n_u', 0),
            strategy=current_strategy,
            bounds=config.get('bounds', {}),
            tolerance=tolerance,
            operating_conditions=operating_conditions,
            state_vars=config.get('state_vars')
        )

        logger.info("Solver attempt %d: x_e=%s, u_e=%s, converged=%s, cost=%.2e",
                    attempt + 1, x_e, u_e, converged, cost)

        output_text += f"\n\n  Attempt {attempt + 1}/{max_retries}:\n\n cost: {cost:.2e}\n success: {converged}\n message: {message}"

        # Track best solution
        if cost < best_cost:
            best_cost = cost
            best_x_e, best_u_e = x_e, u_e
            best_converged = converged
            best_trace_entry = trace_entry

        if converged:
            output_text += f"\n  âœ“ Converged on attempt {attempt + 1}!"
            break

        # Adaptive retry with LLM guidance if not converged and not last attempt
        if attempt < max_retries - 1:
            current_guess, current_strategy, output_text = _adapt_solver_with_llm(
                state, config, current_guess, x_e, u_e, attempt, current_strategy,
                best_cost, cost, logger, output_text, agents
            )

    # Use best result found
    x_e, u_e, converged = best_x_e, best_u_e, best_converged
    trace_entry = best_trace_entry

    if x_e is not None and u_e is not None:
        output_text += f"\n  â†’ x_e = {x_e}"
        output_text += f"\n  â†’ u_e = {u_e}"
        try:
            state['x_e'] = np.array([float(val) for val in x_e], dtype=np.float64)
            state['u_e'] = np.array([float(val) for val in u_e], dtype=np.float64)
        except (ValueError, TypeError) as e:
            logger.error("Type conversion error: %s", e)
            output_text += f"\n  âœ— Error: Failed to convert equilibrium values to numeric: {e}"

    if converged:
        output_text += f"\n  âœ“ Converged!"
    else:
        output_text += f"\n  âœ— Failed to converge after {max_retries} attempts. Best cost: {best_cost:.2e}"

    state['converged'] = converged
    if not converged:
        state['restart_count'] = state.get('restart_count', 0) + 1

    state['trace'] = state.get('trace', []) + [trace_entry] if trace_entry else state.get('trace', [])

    if state["ui_mode"] == "streamlit":
        writer({"agent_tag": "ðŸ‘¨â€ðŸ«.Equation Solver", "log_history": output_text})
    else:
        print(output_text)

    return state


def _adapt_solver_with_llm(state, config, old_guess, x_e, u_e, attempt, strategy, best_cost, last_cost, logger, output_text, agents_config):
    """Use LLM to suggest adaptive guess and strategy adjustments."""
    # Prepare context for LLM
    if config is None:
        config = state.get('config', {})

    bounds = config['bounds']
    x_min = bounds.get('x_min')
    x_max = bounds.get('x_max')
    u_min = bounds.get('u_min')
    u_max = bounds.get('u_max')

    last_residual = float(last_cost) if last_cost is not None else "unknown"
    n_x = config['n_x']
    n_u = config['n_u']

    try:
        output_text += f"\n    ðŸ§  Consulting LLM for adaptive strategy (attempt {attempt + 1})..."

        # Use the solve_equilibrium agent for adaptive guidance
        adaptive_agent = agents_config.solve_equilibrium()

        # Sanitize system_f_code for passing to LLM agent (do not embed code execution inside the dict)
        system_f_code = config.get('system_f_code', '')
        if system_f_code and 'def system_f' in system_f_code:
            code = system_f_code
            try:
                code_decoded = code.encode('utf-8').decode('unicode_escape')
                if '\\n' not in code_decoded or '\\' not in code_decoded:
                    code = code_decoded
            except Exception:
                code = code.replace('\\r\\n', '\r\n').replace('\\n', '\n').replace('\\"', '"')

            m = re.search(r'```(?:\w+)?\s*(.*?)```', code, re.DOTALL)
            if m:
                code = m.group(1)
            else:
                mm = re.search(r'(?:import\s+|from\s+|def\s+system_f).*', code, re.DOTALL)
                if mm:
                    code = mm.group(0)

            try:
                namespace = {"np": np, "params": config.get('params', {})}
                exec(code, namespace)
                config['system_f'] = namespace.get('system_f')
                if config['system_f'] is None:
                    output_text += "Warning: system_f function not found in provided code. Setting to None."
            except Exception as e:
                output_text += f"\nFailed to compile system_f_code: {e}"
                output_text += f"\nCode was:\n{code}"
                config['system_f'] = None

        best_cost_for_agent = float(best_cost) if np.isfinite(best_cost) else "inf"
        agent_state = {
            'system_name': config.get('system_name', 'Unknown'),
            'n_x': n_x,
            'n_u': n_u,
            'state_vars': config.get('state_vars', []),
            'attempt': attempt + 1,
            'best_cost': best_cost_for_agent,
            'previous_guess': old_guess.tolist(),
            'last_residual': last_residual,
            'x_min': x_min,
            'x_max': x_max,
            'u_min': u_min,
            'u_max': u_max,
            'params': config.get('params', {}),
            'system_f_code': system_f_code
        }

        result_state = adaptive_agent(agent_state)
        result = result_state.get('adaptive_result') or result_state.get('solver_result', {})

        new_guess = np.array(result.get('suggested_guess', old_guess.tolist()))
        new_strategy = result.get('suggested_strategy', strategy)
        reasoning = result.get('reasoning', '')

        # Ensure bounds are respected
        if x_min is not None and x_max is not None:
            for i in range(n_x):
                val = new_guess[i]
                min_b = x_min[i] if i < len(x_min) else None
                max_b = x_max[i] if i < len(x_max) else None
                if min_b is not None:
                    val = max(val, min_b)
                if max_b is not None:
                    val = min(val, max_b)
                new_guess[i] = val

        if u_min is not None and u_max is not None:
            for i in range(n_u):
                val = new_guess[n_x + i]
                min_b = u_min[i] if i < len(u_min) else None
                max_b = u_max[i] if i < len(u_max) else None
                if min_b is not None:
                    val = max(val, min_b)
                if max_b is not None:
                    val = min(val, max_b)
                new_guess[n_x + i] = val

        trace_entry = {
            "agent": "SolverAgent",
            "action": "llm_adaptive_adjustment",
            "attempt": attempt + 1,
            "new_strategy": new_strategy,
            "new_guess": new_guess.tolist(),
            "reasoning": reasoning
        }
        state['trace'].append(trace_entry)

        output_text += f"\n   â†’ LLM suggested strategy: {new_strategy}"
        if reasoning:
            output_text += f"\n    â†’ Reasoning: {reasoning}"

        return new_guess, new_strategy, output_text

    except Exception as e:
        # Check if it's a rate limit error
        if "rate_limit_exceeded" in str(e) or "Rate limit reached" in str(e):
            output_text += f"\n    âš  Rate limit reached. Stopping adaptive retries."
            raise e

        # Fallback to heuristic adaptation
        output_text += f"\n   âš  LLM call failed: {e}. Using heuristic adaptation."
        return _adapt_guess_heuristic(old_guess, x_e, u_e, n_x, n_u, bounds, attempt), strategy, output_text


def _adapt_guess_heuristic(old_guess, x_e, u_e, n_x, n_u, bounds, attempt):
    """Heuristic adaptive guess modification strategy (fallback if LLM unavailable)."""
    if x_e is not None and u_e is not None:
        new_guess = np.concatenate([x_e, u_e])
    else:
        new_guess = old_guess.copy()

    # Add random perturbation with decreasing magnitude
    perturbation_scale = 0.1 * (0.5 ** attempt)
    new_guess += perturbation_scale * np.random.randn(len(new_guess))

    # Ensure bounds are respected
    x_min = bounds.get('x_min')
    x_max = bounds.get('x_max')
    u_min = bounds.get('u_min')
    u_max = bounds.get('u_max')

    if x_min is not None and x_max is not None:
        for i in range(n_x):
            val = new_guess[i]
            min_b = x_min[i] if i < len(x_min) else None
            max_b = x_max[i] if i < len(x_max) else None
            if min_b is not None:
                val = max(val, min_b)
            if max_b is not None:
                val = min(val, max_b)
            new_guess[i] = val

    if u_min is not None and u_max is not None:
        for i in range(n_u):
            val = new_guess[n_x + i]
            min_b = u_min[i] if i < len(u_min) else None
            max_b = u_max[i] if i < len(u_max) else None
            if min_b is not None:
                val = max(val, min_b)
            if max_b is not None:
                val = min(val, max_b)
            new_guess[n_x + i] = val

    return new_guess
