import copy
import json
from datetime import datetime
from typing import Any, Dict, Optional
from langchain_cerebras import ChatCerebras
import os

from backend_api.SiloDesigner.src.controllers import run_optimization, initialize_state, create_optimization_graph
from backend_api.SiloDesigner.src.utils import log_to_file
from backend_api.SiloDesigner.classic.ga_utils import GAOptimizer

MONITOR_STATE_KEYS = (
    'iteration',
    'max_iterations',
    'scenario_level',
    'max_scenarios',
    'controller_type',
    'controllers_list',
    'current_controller_index',
    'system_description',
    'dt',
    'max_time',
    'target',
    'current_params',
    'results',
    'simulator',
    'system',
    'seed',
)
MAX_MONITOR_HISTORY = 100


def _array_to_list(value: Any) -> list:
    if value is None:
        return []
    if hasattr(value, 'tolist'):
        return value.tolist()
    if isinstance(value, list):
        return value
    return []


def _lightweight_results_snapshot(results: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(results, dict):
        return None

    return {
        'success': results.get('success'),
        'metrics': copy.deepcopy(results.get('metrics', {})),
        'trajectory': _array_to_list(results.get('trajectory')),
        'control_signals': _array_to_list(results.get('control_signals')),
        'errors': _array_to_list(results.get('errors')),
    }


def lightweight_monitor_snapshot(state: Dict[str, Any]) -> Dict[str, Any]:
    """Store only UI-relevant fields; avoid copying system/simulator/buffer objects."""
    snapshot: Dict[str, Any] = {}
    for key in MONITOR_STATE_KEYS:
        if key not in state:
            continue
        if key == 'results':
            results = _lightweight_results_snapshot(state.get('results'))
            if results is not None:
                snapshot['results'] = results
            continue
        if key == 'current_params' and isinstance(state.get('current_params'), dict):
            snapshot['current_params'] = copy.deepcopy(state['current_params'])
            continue
        snapshot[key] = state[key]
    return snapshot

#Configure Streamlit page



class DummySessionManager:
    def get_all_sessions(self, user_id):
        return [] # Returns empty session history so the sidebar remains clean
    def create_session(self, user_id, title):
        return "local_test_session_001"
    def save_custom_dynamics(self, user_id, session_id, file_bytes, filename):
        # Create a temporary local path to store dynamics files safely during test
        os.makedirs("test_dynamics", exist_ok=True)
        path = os.path.join("test_dynamics", filename)
        with open(path, "wb") as f:
            f.write(file_bytes)
        return path
    def update_session(self, user_id, session_id, updates):
        pass
    def load_session(self, user_id, session_id):
        return {}
    def load_custom_dynamics(self, user_id, session_id):
        return None


class DummyMonitor:
    """Dummy monitor for safe object recreation without side effects"""

    def __init__(self):
        self.progress_history = []
        self.state_history = []
        self.llm_responses = []
        self.current_state = {}
        self.is_running = False

    def add_progress(self, message: str, data: Dict = None):
        pass

    def add_llm_response(self, agent_name: str, prompt: str, response: str):
        pass

    def update_state(self, update: Dict):
        pass


class DesignCancelledError(Exception):
    """Raised when the user cancels an in-progress control design."""
    pass


class DesignMonitor:
    """Monitor class to capture real-time design progress"""

    def __init__(self):
        self.progress_history = []
        self.state_history = []
        self.llm_responses = []
        self.current_state = {}
        self.is_running = False
        self.scenario_metrics_history = []
        self.revision = 0

    def _bump_revision(self) -> None:
        self.revision += 1

    def add_progress(self, message: str, data: Dict = None):
        """Add progress update to history list"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.progress_history.append({
            'timestamp': timestamp,
            'message': message,
            'data': data or {}
        })

    def add_llm_response(self, agent_name: str, prompt: str, response: str):
        """Add LLM response for monitoring"""
        self.llm_responses.append({
            'timestamp': datetime.now().strftime("%H:%M:%S"),
            'agent': agent_name,
            'prompt': prompt[:200] + "..." if len(prompt) > 200 else prompt,
            'response': response
        })
        self._bump_revision()

    def update_state(self, update: Dict):
        """Update current state"""
        self.current_state.update(update)

        if 'iteration' in update:
            self.state_history.append({
                'timestamp': datetime.now().strftime("%H:%M:%S"),
                'state': lightweight_monitor_snapshot(self.current_state),
            })
            if len(self.state_history) > MAX_MONITOR_HISTORY:
                self.state_history = self.state_history[-MAX_MONITOR_HISTORY:]
            self._bump_revision()
        elif (
            'results' in update
            and isinstance(update.get('results'), dict)
            and update['results'].get('success')
        ):
            # Notify subscribers of fresh simulation data without duplicating history.
            self._bump_revision()

    def add_scenario_metrics(self, scenario_level: int, metrics: Dict):
        """NEW: Add per-scenario computational metrics to history"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.scenario_metrics_history.append({
            'scenario_level': scenario_level,
            'timestamp': timestamp,
            'metrics': metrics  # {'tokens_in': int, 'tokens_out': int, 'time': float (wall-clock + LLM), 'cost': float}
        })
        self.add_progress(f"ðŸ“Š Scenario {scenario_level} profiling: {metrics['tokens_in']} in, {metrics['tokens_out']} out, {metrics['time']:.1f}s, ${metrics['cost']:.4f}")


def process_objective(user_input: str) -> str:
    """Process user objective with LLM to refine it."""
    llm = ChatCerebras(model="zai-glm-4.7", temperature=0.0)
    system_prompt = "You are a control systems expert. Rephrase the user's control objective clearly and concisely for a controller design task."
    user_prompt = f"User input: {user_input}\nRephrase it as a control objective."
    response = llm.invoke([{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}])
    return response.content.strip()


def get_serializable_monitor_state(monitor):
    """Create a JSON-serializable copy of monitor state by converting non-serializable objects"""
    def to_serializable(obj):
        if isinstance(obj, dict):
            return {k: to_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [to_serializable(item) for item in obj]
        elif isinstance(obj, (str, int, float, bool, type(None))):
            return obj
        else:
            return repr(obj)

    return {
        'revision': monitor.revision,
        'state_history': [
            {
                'timestamp': entry['timestamp'],
                'state': to_serializable(entry['state'])
            } for entry in monitor.state_history
        ],
        'llm_responses': monitor.llm_responses,
        'current_state': to_serializable(lightweight_monitor_snapshot(monitor.current_state)),
        'progress_history': monitor.progress_history,
        'scenario_metrics_history': [
            {
                'scenario_level': entry['scenario_level'],
                'timestamp': entry['timestamp'],
                'metrics': to_serializable(entry['metrics'])
            } for entry in monitor.scenario_metrics_history
        ]
    }


def run_design_with_monitoring(config: Dict, monitor: DesignMonitor):
    """Run the design process with real-time monitoring"""
    monitor.is_running = True
    monitor.add_progress("Starting Control System Design Process...")

    try:
        def monitored_run_optimization(**kwargs):
            monitor.add_progress(f"Initializing design with system: {kwargs.get('system_name', 'unknown')}")

            # Create graph and initial state
            graph, graph_config = create_optimization_graph(
                kwargs.get('max_scenarios', 3),
                kwargs.get('max_iter', 10)
            )

            # Filter out keys that are not accepted by initialize_state
            excluded_init_keys = {'enable_ga', 'ga_config', 'file_name'}
            filtered_kwargs = {k: v for k, v in kwargs.items() if k not in excluded_init_keys}

            init_kwargs = {
                **filtered_kwargs,
                'dt': filtered_kwargs.get('dt', 0.01),
                'max_time': filtered_kwargs.get('max_time', 5.0),
                'target': filtered_kwargs.get('target', 0.0),
                'num_inputs': filtered_kwargs.get('num_inputs', 1),
                'input_channel': filtered_kwargs.get('input_channel', 0),
                'output_channel': filtered_kwargs.get('output_channel', 0),
                # NEW: Pass trim_values, num_states, matlab_func_name, min_ctrl, max_ctrl
                'trim_values': filtered_kwargs.get('trim_values'),
                'num_states': filtered_kwargs.get('num_states'),
                'matlab_func_name': filtered_kwargs.get('matlab_func_name'),
                'min_ctrl': filtered_kwargs.get('min_ctrl', -10.0),
                'max_ctrl': filtered_kwargs.get('max_ctrl', 10.0),
                'monitor': monitor
            }

            initial_state = initialize_state(**init_kwargs)
            monitor.current_state = initial_state.copy()

            log_to_file(f"=== CONTROL DESIGN LOG - {datetime.now()} ===\n\n", True)

            # Stream the graph execution with monitoring
            step_count = 0
            for step_output in graph.stream(initial_state, config={"recursion_limit": 1000}):
                if not monitor.is_running:
                    monitor.add_progress("Design cancelled by user")
                    raise DesignCancelledError("Design cancelled by user")

                step_count += 1

                # Extract state information from step output
                if step_output:
                    for node_name, node_output in step_output.items():
                        monitor.add_progress(f"Executing: {node_name}")

                        # Update state with node output
                        if isinstance(node_output, dict):
                            monitor.update_state(node_output)

                            # Special handling for different node types
                            if node_name == "propose_parameters" and "current_params" in node_output:
                                params = node_output["current_params"]
                                monitor.add_progress(f"Proposed Parameters: {params}")

                            elif node_name == "run_simulation" and "results" in node_output:
                                results = node_output["results"]
                                if results and results.get("success"):
                                    metrics = results.get("metrics", {})
                                    monitor.add_progress(
                                        f"Simulation Results - MSE: {metrics.get('mse', 'N/A'):.4f}, "
                                        f"Settling Time: {metrics.get('settling_time', 'N/A'):.2f}s")

                            elif node_name == "evaluate_performance" and "feedback" in node_output:
                                feedback = node_output["feedback"]
                                try:
                                    feedback_data = json.loads(feedback) if isinstance(feedback, str) else feedback
                                    monitor.add_progress("Performance Analysis Complete")
                                except:
                                    monitor.add_progress(f"Performance Analysis: {str(feedback)[:100]}...")

                        if step_count > 1000:  # Safety break
                            break

            if not monitor.is_running:
                monitor.add_progress("Design cancelled by user")
                raise DesignCancelledError("Design cancelled by user")

            monitor.add_progress("Design process completed!")

        monitored_run_optimization(**config)
    finally:
        monitor.is_running = False


def run_ga_optimization(config, ga_results_container):
    """Run GA optimization in background thread"""
    try:
        # Extract config
        system_name = config.get('system_name', 'custom')

        # Determine controller type from selected controllers
        controllers = config.get('controllers', ['PID'])
        controller_type = controllers[0] if controllers else 'PID'

        # Get GA config
        ga_config = config.get('ga_config', {})

        # NEW: Get num_states - either from config or by creating a temporary system
        num_states = config.get('num_states')

        if num_states is None and controller_type == 'FSF':
            # Need to determine num_states from the actual system
            try:
                # Create a temporary system to get num_states
                from backend_api.SiloDesigner.src.controllers import initialize_state
                temp_init_kwargs = {
                    'system_name': system_name,
                    'custom_dynamics_path': config.get('custom_dynamics_path'),
                    'file_content': config.get('file_content'),
                    'file_type': config.get('file_type', 'Python (.py)'),
                    'matlab_func_name': config.get('matlab_func_name'),
                    'num_states': None,  # Let it auto-detect
                    'dt': config.get('dt', 0.01),
                    'max_time': config.get('max_time', 5.0),
                    'target': config.get('target', 0.0),
                    'num_inputs': config.get('num_inputs', 1),
                    'input_channel': config.get('input_channel', 0),
                    'output_channel': config.get('output_channel', 0),
                    'trim_values': config.get('trim_values'),
                    'min_ctrl': config.get('min_ctrl', -10.0),
                    'max_ctrl': config.get('max_ctrl', 10.0),
                    'monitor': None
                }
                temp_state = initialize_state(**temp_init_kwargs)
                if temp_state.get('system'):
                    num_states = temp_state['system'].num_states
                else:
                    raise ValueError("Failed to create system to determine num_states")
            except Exception as e:
                raise ValueError(f"Cannot determine num_states for FSF controller: {e}")

        # Build param_ranges for GA
        param_ranges = config.get('param_ranges', {})
        if not param_ranges:
            # Use defaults
            if controller_type == 'PID':
                param_ranges = {'PID': {'Kp': [0.0, 200.0], 'Ki': [0.0, 50.0], 'Kd': [0.0, 100.0]}}
            elif controller_type == 'FSF':
                if num_states is None:
                    raise ValueError("num_states is required for FSF controller but could not be determined")
                param_ranges = {'FSF': {f'K{i + 1}': [-50.0, 50.0] for i in range(num_states)}}

        # Get scenario config (use first scenario)
        scenarios = config.get('custom_scenarios', [])
        scenario_config = scenarios[0] if scenarios else {
            'initial_condition_range': (-1.0, 1.0),
            'randomness_level': 0.0,
            'disturbance_level': 0.0
        }

        # Create optimizer
        optimizer = GAOptimizer(
            system_name=system_name,
            controller_type=controller_type,
            ga_config=ga_config,
            param_ranges=param_ranges,
            scenario_config=scenario_config,
            num_evaluation_runs=ga_config.get('num_evaluation_runs', 10),
            weights=ga_config.get('weights', {}),
            custom_dynamics_path=config.get('custom_dynamics_path'),
            file_type=config.get('file_type', 'Python (.py)'),
            matlab_func_name=config.get('matlab_func_name'),
            num_states=config.get('num_states'),
            dt=config.get('dt', 0.01),
            max_time=config.get('max_time', 5.0),
            target=config.get('target', 0.0),
            num_inputs=config.get('num_inputs', 1),
            input_channel=config.get('input_channel', 0),
            output_channel=config.get('output_channel', 0),
            trim_values=config.get('trim_values'),
            min_ctrl=config.get('min_ctrl', -10.0),
            max_ctrl=config.get('max_ctrl', 10.0),
            seed=config['seed']
        )

        # Run optimization
        best_params, best_fitness, history = optimizer.optimize()

        # Get final metrics
        final_metrics = optimizer.get_performance_metrics(best_params, num_runs=20)

        # Store results
        ga_results_container['best_params'] = best_params
        ga_results_container['best_fitness'] = -best_fitness  # Convert back to cost
        ga_results_container['history'] = history
        ga_results_container['final_metrics'] = final_metrics
        ga_results_container['controller_type'] = controller_type
        ga_results_container['status'] = 'complete'
        ga_results_container['optimizer'] = optimizer  # Store for plotting

    except Exception as e:
        ga_results_container['status'] = 'error'
        ga_results_container['error'] = str(e)
        import traceback
        ga_results_container['traceback'] = traceback.format_exc()
