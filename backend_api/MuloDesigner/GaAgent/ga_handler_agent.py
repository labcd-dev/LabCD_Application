import numpy as np
from typing import Dict, Any
import time
from datetime import datetime

from backend_api.MuloDesigner.GaAgent.src.graph import create_ga_handler_graph
from backend_api.MuloDesigner.GaAgent.src.utils import (
    coerce_float,
    coerce_metric_targets,
    coerce_simulation_params,
    load_case_study,
)
from backend_api.MuloDesigner.GaAgent.src.logger import get_logger, configure_logging


# Get logger for this module
logger = get_logger(__name__)

# Each GA attempt runs design -> optimize -> evaluate (3 graph steps).
_STEPS_PER_ATTEMPT = 3
_MIN_RECURSION_LIMIT = 100


def get_recursion_limit(max_attempts: int) -> int:
    """Size LangGraph recursion limit from attempt budget (+ buffer for warm-start path)."""
    attempts = max(int(max_attempts), 1)
    return max(_MIN_RECURSION_LIMIT, attempts * _STEPS_PER_ATTEMPT + 20)


# =============================== MAIN FUNCTIONS ===============================

def initialize_ga_handler_state(
        case_study: Dict[str, Any],
        tuning_specs: Dict[str, Any],
        llm_model: str = "openai/gpt-oss-20b",
        seed: int = 42,
        run_id: int = 1,
        temperature: float = 0.0,
        max_attempts: int = 5,
        max_wall_clock: float = 60.0,
        max_cost_budget: float = 0.01,
        prompt_variant: str = "elaborate",
        buffer_size: int = 3,
        warm_start_config=None,
        system_aware: bool = True,
) -> Dict[str, Any]:
    """Initialize GA handler state with fixed targets and adjustable weights"""

    np.random.seed(seed)

    state = {
        "current_attempt": 1,
        "experiment_start_time": time.time(),  # set once; shared across all GA attempts
        "max_attempts": max(int(coerce_float(max_attempts, 5)), 1),
        "max_wall_clock": coerce_float(max_wall_clock, 3600.0),
        "total_elapsed_time": 0.0,
        "prompt_variant": prompt_variant,
        "buffer_size": buffer_size,
        "feedback_history": [],
        "best_result": None,
        "ga_config": None,
        "optimization_results": None,
        "decision": None,
        "tuning_specs": tuning_specs,
        "llm_model": llm_model,
        "run_id": run_id,
        "seed": seed,
        "temperature": temperature,
        "system_name": case_study["system_name"],
        "num_states": case_study["num_states"],
        "control_objective": case_study.get("control_objective", "Design a stable controller"),
        "dt": tuning_specs['simulation_params']['dt'],
        "max_time": tuning_specs['simulation_params']['max_time'],
        "target": case_study["target"],
        "num_inputs": case_study["num_inputs"],
        "input_channel": case_study["input_channel"],
        "output_channel": case_study["output_channel"],
        "trim_values": case_study["trim_values"],
        "trim_ics": case_study["trim_ics"],
        "min_ctrl": case_study["min_ctrl"],
        "max_ctrl": case_study["max_ctrl"],
        "system_description": case_study.get("system_description"),
        "python_code": case_study.get("python_code"),
        "max_cost_budget": coerce_float(max_cost_budget, 1.0),  # Maximum allowed cost in dollars
        "total_cost_consumed": 0.0,  # Total cost consumed so far
        "warm_start_config": warm_start_config,
        "system_aware": system_aware,
        "working_function": case_study.get("working_function", "system_dynamics"),
        "input_name": case_study.get("input_name", ""),
    }

    return state


def run_ga_handler(
        case_study_file: str = "AircraftPitch.json",
        tuning_specs: Dict[str, Any] = None,
        llm_model: str = "openai/gpt-oss-20b",
        seed: int = 42,
        run_id: int = 1,
        max_attempts: int = 2,
        max_wall_clock: float = 3600.0,
        max_cost_budget: float = 1.0,
        prompt_variant: str = "elaborate",
        buffer_size: int = 3,
        control_objective: str = None,
        warm_start_config: Dict[str, Any] = None,
        system_aware: bool = True,
        case_study: Dict[str, Any] = None,
):
    """
    Run GA handler workflow with fixed targets and adjustable weights.

    warm_start_config (optional)
    ----------------------------
    If provided, attempt 1 uses this config directly instead of calling the
    LLM.  Subsequent attempts call the LLM as normal.

    Supported keys (all optional â€“ defaults are used for missing keys):
        weights           : dict  â€“ initial fitness weights
        ga_population_size: int   â€“ population size for the warm-start run
        ga_generations    : int   â€“ generation count for the warm-start run
        param_ranges      : dict  â€“ PID search bounds  {'PID': {'Kp':[], ...}}

    Example â€“ lighter than the regular GA, same search bounds:
        warm_start_config = {
            "weights": {"mse": 1.0, "settling_time": 1.0,
                        "overshoot": 1.0, "control_effort": 1.0},
            "ga_population_size": 10,    # half of regular GA's 20
            "ga_generations":     25,    # 5 % of regular GA's 500
            "param_ranges": {"PID": {"Kp": [0.5, 50.0],
                                     "Ki": [0.005, 5.0],
                                     "Kd": [0.005, 10.0]}},
        }
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    configure_logging(verbose=False, log_file=f"logs/ga_run_{timestamp}.log")

    logger.info("=" * 80)
    logger.info("GA HANDLER - Tuning GA Configuration with Fixed Targets and Adjustable Weights")
    logger.info("=" * 80)

    logger.info(f"Loading case study from case_studies/json/{case_study_file}...")
    if case_study is None:
        case_study = load_case_study(case_study_file)
    if control_objective is not None:
        case_study['control_objective'] = control_objective
    logger.info(f"âœ“ Loaded case study: {case_study['system_name']}")

    # Extract fixed_targets and simulation_params from case study
    fixed_targets = coerce_metric_targets(case_study.get('fixed_targets'))
    simulation_params = coerce_simulation_params(case_study.get('simulation_params'))

    # Default initial weights if not provided
    default_weights = {
        'mse': 1.0,
        'settling_time': 1.0,
        'overshoot': 1.0,
        'control_effort': 1.0
    }

    # Build tuning_specs from case study + optional override
    if tuning_specs is None:
        tuning_specs = {
            'fixed_targets': fixed_targets,
            'weights': default_weights,
            'simulation_params': simulation_params
        }
    else:
        # If tuning_specs provided, merge with case study data
        # Case study takes precedence for fixed_targets and simulation_params
        tuning_specs['fixed_targets'] = fixed_targets
        tuning_specs['simulation_params'] = simulation_params

        # Use provided weights if available, otherwise use defaults
        if 'weights' not in tuning_specs:
            tuning_specs['weights'] = default_weights

    logger.info("Initializing GA handler state with FIXED TARGETS and adjustable weights...")
    state = initialize_ga_handler_state(
        case_study=case_study,
        tuning_specs=tuning_specs,
        llm_model=llm_model,
        seed=seed,
        run_id=run_id,
        max_attempts=max_attempts,
        max_wall_clock=max_wall_clock,
        max_cost_budget=max_cost_budget,
        prompt_variant=prompt_variant,
        buffer_size=buffer_size,
        warm_start_config=warm_start_config,
        system_aware=system_aware,
    )

    logger.info(f"Fixed targets (from case study): {tuning_specs['fixed_targets']}")
    logger.info(f"Initial weights: {tuning_specs['weights']}")
    logger.info(f"Fixed sim params (from case study): {tuning_specs['simulation_params']}")

    logger.info("Creating GA handler workflow...")
    app = create_ga_handler_graph()

    recursion_limit = get_recursion_limit(max_attempts)
    logger.info("Starting GA configuration tuning workflow...")
    logger.info(f"LangGraph recursion_limit: {recursion_limit} (max_attempts={max_attempts})")
    final_state = app.invoke(state, {"recursion_limit": recursion_limit})

    logger.info("=" * 80)
    logger.info("FINAL RESULTS")
    logger.info("=" * 80)
    logger.info(f"Best Result (Attempt {final_state['best_result']['best_attempt']}):")
    logger.info(f"  Baseline Cost: {final_state['best_result']['best_baseline_cost']:.4f}")
    logger.info(f"  GA Cost: {final_state['best_result']['best_ga_cost']:.4f}")
    logger.info(f"  GA Config:")
    best_ga = final_state['best_result']['best_ga_config']
    logger.info(f"    Population: {best_ga['ga_population_size']}")
    logger.info(f"    Generations: {best_ga['ga_generations']}")
    logger.info(f"    Param ranges: {best_ga['param_ranges']}")
    logger.info(f"  Controller: {final_state['best_result']['controller_parameters']}")
    logger.info(f"  Achieved Metrics:")
    for metric, value in final_state['best_result']['achieved_metrics'].items():
        logger.info(f"    {metric}: {value:.4f}")

    # Log num_evaluations for the best attempt
    best_attempt = final_state['best_result']['best_attempt']
    if final_state['feedback_history'] and best_attempt <= len(final_state['feedback_history']):
        num_evaluations = final_state['feedback_history'][best_attempt - 1].get('num_evaluations', 0)
        logger.info(f"  PID Evaluations: {num_evaluations}")

    logger.info(f"Final Decision: {final_state['decision']['action']}")
    logger.info(f"Reason: {final_state['decision']['reason']}")
    logger.info(f"Total Attempts: {len(final_state['feedback_history'])}")

    total_evals = sum(entry.get('num_evaluations', 0) for entry in final_state['feedback_history'])
    logger.info(f"Total PID Evaluations: {total_evals}")

    return final_state


def run_ga_handler_mock(
        case_study_file: str = "DCMotor.json",
        max_attempts: int = 3,
        prompt_variant: str = "elaborate",
        initial_weights: Dict[str, float] = None,
        **kwargs
):
    """
    Run GA handler workflow in mock mode for testing.

    Args:
        case_study_file: Case study JSON file (contains fixed_targets and simulation_params)
        max_attempts: Maximum number of attempts
        prompt_variant: Prompt variant to use
        initial_weights: Optional initial weights (if None, uses defaults)
        **kwargs: Additional arguments passed to run_ga_handler
    """

    # Prepare tuning_specs with only weights (if provided)
    tuning_specs = None
    if initial_weights is not None:
        tuning_specs = {'weights': initial_weights}

    return run_ga_handler(
        case_study_file=case_study_file,
        tuning_specs=tuning_specs,
        llm_model="mock",
        seed=42,
        run_id=999,
        max_attempts=max_attempts,
        max_wall_clock=600.0,
        prompt_variant=prompt_variant,
        buffer_size=2,
        **kwargs
    )


if __name__ == "__main__":
    from src.logger import configure_logging

    # Configure logging for standalone execution
    configure_logging(verbose=False)

    # Test with initial weights override
    initial_weights = {
        'mse': 1.0,
        'settling_time': 1.0,
        'overshoot': 1.0,
        'control_effort': 1.0
    }

    fin_state = run_ga_handler(
        case_study_file="DCMotor.json",
        tuning_specs={'weights': initial_weights},  # Only override weights
        llm_model="mock",
        seed=42,
        run_id=1,
        max_attempts=3,
        max_wall_clock=5.5,
        max_cost_budget=0.021,
        prompt_variant="concise",
        buffer_size=3
    )

