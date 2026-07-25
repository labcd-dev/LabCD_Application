from typing import TypedDict, List, Dict, Any, Optional, Union
import numpy as np
import logging


class WorkflowState(TypedDict):
    """Defines the state of the workflow graph."""
    input_content: str
    config: Dict[str, Any]
    initial_guess: Union[List[float], np.ndarray]
    strategy: str
    x_e: Optional[np.ndarray]
    u_e: Optional[np.ndarray]
    converged: bool
    A: Optional[np.ndarray]
    B: Optional[np.ndarray]
    eigenvalues: List[complex]
    classification: str
    feasible: bool
    equilibrium_match: bool
    trace: List[Dict[str, Any]]
    restart_count: int
    max_restarts: int
    logger: logging.Logger
    final_result: Dict[str, Any]
    user_choice: str
    ui_mode: str
    ui_inputs: Dict[str, Any]
    trimming_params: List[str]
    token_usage: Dict[str, int]
    total_cost: float

