import json
import re
import time
import numpy as np
import matplotlib.pyplot as plt
import pickle
import importlib.util
from typing import Dict, List, Any, Tuple, Optional, TypedDict
from datetime import datetime
from typing import Annotated
from langgraph.channels import Topic
import os
try:
    from oct2py import Oct2Py
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    OCTAVE_AVAILABLE = True
    logger.disabled = True
    # logger.setLevel(logging.WARNING)
    logging.basicConfig(level=logging.DEBUG)
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
except ImportError:
    OCTAVE_AVAILABLE = False
    logger = None

# Set random seeds for reproducibility
np.random.seed(42)


def _dynamics_source_label(
    file_path: Optional[str],
    file_content: Optional[str] = None,
    default: str = "uploaded dynamics",
) -> str:
    """Human-readable label for uploaded dynamics when no file path exists."""
    if file_path:
        return os.path.basename(file_path)
    if file_content:
        return default
    return default


class GeneralDynamicalSystem:
    """Base class for dynamical systems with arbitrary number of states"""

    def __init__(self, scenario=None):
        # System identification
        self.name = "General Dynamical System"
        self.description = "Override in subclass"

        # Simulation parameters (configurable)
        self.dt = 0.01
        self.max_time = 10.0
        self.min_control = -10.0
        self.max_control = 10.0
        self.target = 0.0
        self.num_inputs = 1
        self.input_channel = 0
        self.output_channel = 0
        self.trim_values = np.zeros(1)  # Will be resized appropriately

        # System-specific parameters (to be defined in subclasses)
        self.num_states = 0
        self.state_names = []
        self.control_input_names = []
        self.num_controls = 0

        # Performance thresholds (system-specific)
        self.failure_conditions = {}
        self.max_control_limits = {}

    def get_control_param_schema(self, controller_type):
        """Return the parameter schema for a given controller type"""
        if controller_type == "FSF":
            # Full-state feedback: one gain per state
            return {f"K{i + 1}": {"min": 0.1, "max": 10.0}
                    for i in range(self.num_states)}
        elif controller_type in ["P", "PI", "PD", "PID"]:
            # PID controllers work with output feedback (typically first state)
            schema = {}
            if controller_type in ["P", "PI", "PD", "PID"]:
                schema["Kp"] = {"min": 0.1, "max": 20.0}
            if controller_type in ["PI", "PID"]:
                schema["Ki"] = {"min": 0.0, "max": 5.0}
            if controller_type in ["PD", "PID"]:
                schema["Kd"] = {"min": 0.0, "max": 5.0}
            return schema
        else:
            raise ValueError(f"Unknown controller type: {controller_type}")

    def run_simulation(self, control_params):
        """Generalized simulation runner"""
        # Determine controller type based on parameters
        if isinstance(control_params, dict):
            # Check if this is a full-state feedback controller
            fsf_keys = [f"K{i + 1}" for i in range(self.num_states)]
            if any(key in control_params for key in fsf_keys):
                # Full-state feedback controller
                K_values = [control_params.get(f"K{i + 1}", 0.0)
                            for i in range(self.num_states)]
                return self.run_fsf_simulation(K_values)
            else:
                # PID-type controller
                Kp = control_params.get('Kp', 0.0)
                Ki = control_params.get('Ki', 0.0)
                Kd = control_params.get('Kd', 0.0)
                return self.run_pid_simulation(Kp, Ki, Kd)
        else:
            # Handle legacy tuple/list format
            if len(control_params) == self.num_states:
                # Assume FSF gains
                return self.run_fsf_simulation(control_params)
            else:
                # Assume PID parameters
                Kp, Ki, Kd = control_params[:3]
                return self.run_pid_simulation(Kp, Ki, Kd)

    def run_fsf_simulation(self, K_values):
        """Full-state feedback simulation - to be implemented in subclass"""
        raise NotImplementedError("Implement in subclass")

    def run_pid_simulation(self, Kp, Ki, Kd):
        """PID simulation - to be implemented in subclass"""
        raise NotImplementedError("Implement in subclass")


class CustomDynamicalSystem(GeneralDynamicalSystem):
    """Generic SISO system from user-uploaded dynamics"""

    def __init__(self, dynamics_file_path, scenario=None, num_inputs: int = 1, file_content: str = None):
        super().__init__(scenario)
        self.num_inputs = num_inputs
        self.file_content = file_content

        # Load the user dynamics
        self.dynamics_file_path = dynamics_file_path
        self._load_dynamics_module()

        # Detect system properties
        self._detect_system_properties()

        # Set system identification
        self.name = "Custom SISO System"
        self.description = f"User-defined {self.num_states}-state SISO system from uploaded dynamics"

        # Default simulation parameters (can be overridden)
        self.dt = 0.01
        self.max_time = 10.0
        self.min_control = -10.0
        self.max_control = 10.0
        self.target = 0.0
        self.target = 0.0
        self.num_inputs = 1
        self.input_channel = 0
        self.output_channel = 0
        self.trim_values = np.zeros(1)

        # Generic state names
        self.state_names = [f'x{i}' for i in range(self.num_states)]
        self.control_input_names = ['u']
        self.num_controls = 1

        # Apply scenario parameters if provided
        self.initial_condition_range = [-1.0, 1.0]
        self.randomness_level = 0.0
        self.disturbance_level = 0.0
        self.param_uncertainty = 0.0

        if scenario:
            self.apply_scenario(scenario)

    def _load_dynamics_module(self):
        """Load the dynamics function from the uploaded file"""

        if self.file_content is not None:
            # Execute directly from string content
            import types
            # self.dynamics_module = types.ModuleType("user_dynamics")
            # exec(self.file_content, self.dynamics_module.__dict__)
            # self.dynamics_func = getattr(self.dynamics_module, 'dynamics')

            # Create a module-like dictionary pre-populated with current globals (like np)
            exec_globals = globals().copy()

            # Execute the string content within this context
            exec(self.file_content, exec_globals)

            if "dynamics" not in exec_globals:
                raise AttributeError("The provided file content does not define a 'dynamics' function.")

            self.dynamics_func = exec_globals["dynamics"]
        else:
            if not self.dynamics_file_path:
                raise ValueError(
                    "Dynamics file path or file_content is required for custom Python systems."
                )
            spec = importlib.util.spec_from_file_location("user_dynamics", self.dynamics_file_path)
            self.dynamics_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.dynamics_module)
            self.dynamics_func = getattr(self.dynamics_module, 'dynamics')

    def _detect_system_properties(self):
        """Auto-detect the number of states by testing the dynamics function.

        Tries both scalar-u (common in case studies: `... + u`) and vector-u
        (`u[0]`) conventions for SISO so either style of dynamics works.
        """
        test_t = 0.0
        if self.num_inputs == 1:
            test_u_candidates = [0.0, np.zeros(1)]
        else:
            test_u_candidates = [np.zeros(self.num_inputs)]

        self._pass_u_as_vector = self.num_inputs > 1

        for n_states in range(1, 11):
            test_x = np.zeros(n_states)
            for test_u in test_u_candidates:
                try:
                    result = self.dynamics_func(test_t, test_x, test_u)
                    result = np.asarray(result, dtype=float).reshape(-1)

                    if result.shape == (n_states,):
                        self.num_states = n_states
                        self._pass_u_as_vector = isinstance(test_u, np.ndarray)
                        return
                except Exception:
                    continue

        raise ValueError("Could not determine system dimension from dynamics function")

    def apply_scenario(self, scenario_params):
        """Apply scenario parameters"""
        ic_range = scenario_params.get('initial_condition_range', [-1.0, 1.0])
        self.initial_condition_range = ic_range

        self.randomness_level = scenario_params.get('randomness_level', 0.0)
        self.disturbance_level = scenario_params.get('disturbance_level', 0.0)
        self.param_uncertainty = scenario_params.get('param_uncertainty', 0.0)

    def system_dynamics(self, x, u):
        """Wrapper for user-provided dynamics function

        Args:
            x: State vector
            u: Control input (scalar for SISO or vector for MIMO)
        """
        t = 0.0  # Time-invariant assumption for simplicity

        if self.num_inputs == 1 and not getattr(self, '_pass_u_as_vector', False):
            # Scalar-u convention used by most case-study dynamics
            u_input = float(u[0]) if isinstance(u, (list, np.ndarray)) else float(u)
        else:
            # Vector-u convention (safe to index as u[0], ..., u[n-1])
            u_input = np.atleast_1d(np.asarray(u, dtype=float)).ravel()
            if self.num_inputs == 1:
                u_input = u_input[:1]

        return self.dynamics_func(t, x, u_input)

    def run_pid_simulation(self, Kp, Ki, Kd, initial_state=None, seed=42):
        """PID control simulation for custom system

        Args:
            Kp, Ki, Kd: PID gains
            initial_state: Optional fixed initial state. If None, random IC is used.
        """
        expected_steps = int(self.max_time / self.dt) + 1
        t = np.arange(0, self.max_time + self.dt, self.dt)[:expected_steps]
        n = len(t)

        # Initialize state
        if initial_state is not None:
            x = initial_state.copy()  # Use provided initial state
        else:
            # Random initial conditions (original behavior)
            x = np.zeros(self.num_states)
            rng = np.random.default_rng(seed=seed)
            x[self.output_channel] = rng.uniform(*self.initial_condition_range)
            # print("self.output_channel")
            # print(x[self.output_channel])


        # Rest of the method remains the same...
        # PID variables
        integral = 0.0
        prev_error = 0.0

        # History tracking
        output_history = [x[self.output_channel]]
        u_history = []
        errors = []

        for i in range(n):
            # Get current output and calculate error
            output = x[self.output_channel]

            # Handle target (can be scalar or callable for time-varying targets)
            current_target = self.target(i * self.dt) if callable(self.target) else self.target
            error = current_target - output

            # Add measurement noise
            if self.randomness_level > 0:
                error += np.random.normal(0, self.randomness_level)

            # PID control
            integral += error * self.dt
            derivative = (error - prev_error) / self.dt if i > 0 else 0.0
            u_control = Kp * error + Ki * integral + Kd * derivative

            # Add disturbance
            if self.disturbance_level > 0:
                u_control += self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)

            # Apply control limits
            u_control = np.clip(u_control, self.min_control, self.max_control)

            # Build full control input vector
            u_full = self.trim_values.copy()
            u_full[self.input_channel] = u_control

            # Record history (only the controlled input)
            u_history.append(u_control)
            errors.append(error)

            # State propagation using Euler integration
            try:
                x_dot = self.system_dynamics(x, u_full)
                x = x + x_dot * self.dt
                # NEW: Divergence check (aligns with Octave; prevents silent instability)
                if np.any(np.abs(x) > 100):
                    break
                output_history.append(x[self.output_channel])
                prev_error = error
            except:
                # If simulation becomes unstable, break
                break

        # Trim to actual simulation length
        output_history = np.array(output_history[:-1])
        u_history = np.array(u_history)
        errors = np.array(errors)

        return output_history, u_history, errors

    def run_fsf_simulation(self, K_values, initial_state=None, seed=42):
        """Full-state feedback simulation for custom system

        Args:
            K_values: State feedback gains
            initial_state: Optional fixed initial state. If None, random IC is used.
        """
        expected_steps = int(self.max_time / self.dt) + 1
        t = np.arange(0, self.max_time + self.dt, self.dt)[:expected_steps]
        n = len(t)

        # Initialize state
        if initial_state is not None:
            x = initial_state.copy()  # Use provided initial state
        else:
            # Random initial conditions (original behavior)
            x = np.zeros(self.num_states)
            rng = np.random.default_rng(seed=seed)
            x[self.output_channel] = rng.uniform(*self.initial_condition_range)

        # Rest of the method remains the same...
        # History tracking
        output_history = [x[self.output_channel]]
        u_history = []
        errors = []

        for i in range(n):
            # Apply measurement noise
            noise = np.random.normal(0, self.randomness_level,
                                     self.num_states) if self.randomness_level > 0 else np.zeros(self.num_states)
            x_noisy = x + noise

            # Get current target
            current_target = self.target(i * self.dt) if callable(self.target) else self.target

            # Error is the output channel deviation from target
            error = current_target - x_noisy[self.output_channel]
            errors.append(error)

            # Full-state feedback control law: u = -K^T * (x - x_desired)
            # We want to regulate the output channel to the target, other states to zero
            x_desired = np.zeros(self.num_states)
            x_desired[self.output_channel] = current_target
            state_error = x_noisy - x_desired

            u_control = -np.dot(K_values, state_error)

            # Add disturbance
            if self.disturbance_level > 0:
                u_control += self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)

            # Apply control limits
            u_control = np.clip(u_control, self.min_control, self.max_control)

            # Build full control input vector
            u_full = self.trim_values.copy()
            u_full[self.input_channel] = u_control

            u_history.append(u_control)

            # State propagation
            try:
                x_dot = self.system_dynamics(x, u_full)
                x = x + x_dot * self.dt
                # NEW: Divergence check (aligns with Octave; prevents silent instability)
                if np.any(np.abs(x) > 100):
                    break
                output_history.append(x[self.output_channel])
            except:
                # If simulation becomes unstable, break
                break

        # Trim to actual simulation length
        output_history = np.array(output_history[:-1])
        u_history = np.array(u_history)
        errors = np.array(errors)

        return output_history, u_history, errors
    def plot_time_response(self, control_params, save_path=None, num_runs=50):
        """Plot time response for custom system"""
        # Determine controller type
        if isinstance(control_params, dict):
            if all(f"K{i + 1}" in control_params for i in range(self.num_states)):
                controller_type = "FSF"
                title_params = ", ".join(
                    [f"K{i + 1}={control_params[f'K{i + 1}']:.2f}" for i in range(self.num_states)])
            else:
                controller_type = "PID"
                title_params = f"Kp={control_params.get('Kp', 0):.2f}, Ki={control_params.get('Ki', 0):.2f}, Kd={control_params.get('Kd', 0):.2f}"
        else:
            controller_type = "Unknown"
            title_params = str(control_params)

        # Reconstruct scenario parameters
        scenario_params = {
            'initial_condition_range': self.initial_condition_range,
            'randomness_level': self.randomness_level,
            'disturbance_level': self.disturbance_level,
            'param_uncertainty': self.param_uncertainty
        }

        # Monte Carlo simulation
        all_outputs, all_controls = [], []
        for _ in range(num_runs):
            try:
                # system = CustomDynamicalSystem(self.dynamics_file_path, scenario_params)
                system = CustomDynamicalSystem(self.dynamics_file_path, scenario_params, self.num_inputs,
                                               self.file_content)
                output, control, _ = system.run_simulation(control_params)
                all_outputs.append(output)
                all_controls.append(control)
            except:
                continue  # Skip failed runs

        if not all_outputs:
            print("All simulation runs failed!")
            return

        # Process trajectories
        max_len = max(len(out) for out in all_outputs)
        time_vector = np.arange(0, max_len * self.dt, self.dt)

        output_matrix = np.full((len(all_outputs), max_len), np.nan)
        control_matrix = np.full((len(all_controls), max_len), np.nan)

        for i in range(len(all_outputs)):
            output_matrix[i, :len(all_outputs[i])] = all_outputs[i]
            control_matrix[i, :len(all_controls[i])] = all_controls[i]

        # Calculate statistics
        output_mean = np.nanmean(output_matrix, axis=0)
        output_std = np.nanstd(output_matrix, axis=0)
        control_mean = np.nanmean(control_matrix, axis=0)
        control_std = np.nanstd(control_matrix, axis=0)

        # Create plot
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), sharex=True)

        # Output plot
        ax1.plot(time_vector, output_mean, 'b-', lw=2, label='Mean Output')
        ax1.fill_between(time_vector, output_mean - output_std, output_mean + output_std,
                         color='blue', alpha=0.2, label='±1 SD')
        ax1.axhline(0, color='r', linestyle='--', alpha=0.7, label='Target')
        ax1.set_ylabel('System Output')
        ax1.set_title(f"Custom System Response ({num_runs} runs) | {controller_type} | {title_params}")
        ax1.grid(True, linestyle='--', alpha=0.7)
        ax1.legend(loc='upper right')

        # Control signal plot
        ax2.plot(time_vector, control_mean, 'g-', lw=2, label='Mean Control')
        ax2.fill_between(time_vector, control_mean - control_std, control_mean + control_std,
                         color='green', alpha=0.2, label='±1 SD')
        ax2.set_xlabel('Time (s)')
        ax2.set_ylabel('Control Input')
        ax2.grid(True, linestyle='--', alpha=0.7)
        ax2.legend(loc='upper right')

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.show()



class OctaveSISOSystem(GeneralDynamicalSystem):
    """Octave-based SISO dynamical system using Oct2Py"""

    def __init__(self, matlab_file_path: str, matlab_func_name: str, num_states: int, scenario=None, num_inputs: int = 1,
                 file_content: str = None):
        super().__init__(scenario)
        self.file_content = file_content

        # Set num_inputs explicitly (overrides base default of 1)
        self.num_inputs = num_inputs
        self.num_controls = num_inputs  # For consistency

        self.original_matlab_file_path = matlab_file_path
        self.matlab_func_name = matlab_func_name
        self.num_states = num_states

        # Set system identification
        self.name = f"Octave System ({matlab_func_name})"  # Renamed for MIMO clarity
        self.description = (
            f"Octave-based system with {num_states} states and {num_inputs} inputs "
            f"from {_dynamics_source_label(matlab_file_path, file_content, matlab_func_name)}"
        )

        # Generate generic state and control names
        self.state_names = [f'x{i + 1}' for i in range(num_states)]
        self.control_input_names = [f'u{i + 1}' for i in range(num_inputs)]

        # Default simulation parameters (can be overridden)
        self.dt = 0.01
        self.max_time = 5.0
        self.min_control = -10.0
        self.max_control = 10.0
        self.target = 0.0
        self.input_channel = 0
        self.output_channel = 0
        self.trim_values = np.zeros(num_inputs)

        # Initialize scenario parameters
        self.initial_condition_range = [-0.5, 0.5]
        self.randomness_level = 0.0
        self.disturbance_level = 0.0
        self.param_uncertainty = 0.0

        # Octave engine and file management
        self.oct = None
        self.matlab_working_dir = None
        self.matlab_file_path = None
        self.temp_files_to_cleanup = []

        if scenario:
            self.apply_scenario(scenario)

        # Set up Octave file and initialize engine
        self._setup_matlab_file()
        self._init_octave_engine()
        self._create_simulator_wrapper()

    def _setup_matlab_file(self):
        """Set up the MATLAB/Octave file in a proper working directory"""
        try:
            import tempfile
            self.matlab_working_dir = tempfile.mkdtemp(prefix='octave_dynamics_')
            logger.info(f"Created Octave working directory: {self.matlab_working_dir}")

            matlab_filename = f"{self.matlab_func_name}.m"
            self.matlab_file_path = os.path.join(self.matlab_working_dir, matlab_filename)

            if self.file_content is not None:
                content = self.file_content
            elif self.original_matlab_file_path:
                with open(self.original_matlab_file_path, 'r') as src:
                    content = src.read()
            else:
                raise ValueError(
                    "MATLAB/Octave dynamics require either file_content or a file path."
                )

            with open(self.matlab_file_path, 'w') as dst:
                dst.write(content)

            logger.info(f"Copied MATLAB file to: {self.matlab_file_path}")

            self.temp_files_to_cleanup.append(self.matlab_file_path)
            self.temp_files_to_cleanup.append(self.matlab_working_dir)

        except Exception as e:
            error_msg = f"Failed to setup Octave file: {str(e)}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)

    def apply_scenario(self, scenario_params):
        """Apply scenario parameters with validation"""
        self.initial_condition_range = scenario_params.get('initial_condition_range', [-0.5, 0.5])
        self.randomness_level = scenario_params.get('randomness_level', 0.0)
        self.disturbance_level = scenario_params.get('disturbance_level', 0.0)
        self.param_uncertainty = scenario_params.get('param_uncertainty', 0.0)

    def _init_octave_engine(self):
        """Initialize Octave engine and set up workspace"""
        try:
            logger.info("Starting Octave engine...")
            self.oct = Oct2Py()

            # Add working directory to Octave path
            self.oct.addpath(self.matlab_working_dir)
            logger.info(f"Added {self.matlab_working_dir} to Octave path")

            # Verify the file exists
            if not os.path.exists(self.matlab_file_path):
                raise FileNotFoundError(f"Octave file not found at {self.matlab_file_path}")

            # Check if function is visible in Octave
            try:
                result = self.oct.which(self.matlab_func_name)
                if result and result != '':
                    logger.info(f"Octave found function '{self.matlab_func_name}' at: {result}")
            except Exception as e:
                logger.warning(f"Could not verify function with 'which': {e}")

            # Test the function with a simple call
            self._test_octave_function()

            logger.info("Octave engine initialized successfully")

        except Exception as e:
            error_msg = f"Failed to initialize Octave engine: {str(e)}"
            logger.error(error_msg)
            if hasattr(self, 'oct') and self.oct is not None:
                try:
                    self.oct.exit()
                except:
                    pass
            raise RuntimeError(error_msg)

    def _test_octave_function(self):
        """Test the Octave dynamics function to ensure it works"""
        try:
            logger.info(f"Testing Octave function '{self.matlab_func_name}'...")

            # Create test inputs
            test_t = 0.0
            test_x = np.array([0.1] * self.num_states).reshape(-1, 1)  # Column vector
            test_u = np.zeros((self.num_inputs, 1))  # Column vector: 1x1 for SISO, 2x1 for MIMO

            logger.info(f"Calling {self.matlab_func_name}({test_t}, {test_x.flatten()}, {test_u.flatten()})")

            # Call the function using feval
            result = self.oct.feval(self.matlab_func_name, test_t, test_x, test_u, nout=1)

            # Convert result to numpy array
            result_array = np.array(result).flatten()

            # Verify dimensions
            if len(result_array) != self.num_states:
                raise ValueError(f"Function returned {len(result_array)} states, expected {self.num_states}")

            logger.info(
                f"Octave function test successful: {self.matlab_func_name}(0, {test_x.flatten()}, {test_u.flatten()}) = {result_array}")

        except Exception as e:
            error_msg = f"Octave function test failed: {str(e)}"
            logger.error(error_msg)

            # Try to get more debugging info
            try:
                exist_result = self.oct.exist(self.matlab_func_name, 'file')
                logger.info(f"Octave exist('{self.matlab_func_name}', 'file') = {exist_result}")
            except:
                pass

            raise RuntimeError(error_msg)

    def _call_octave_dynamics(self, t, x, u):
        """Call Octave dynamics function safely"""
        try:
            # Ensure x is a column vector for MATLAB/Octave
            x_col = x.reshape(-1, 1)

            # Convert u to column vector (handles scalar or 1D array input)
            # For SISO: scalar -> 1x1; for MIMO: array -> nx1
            u_col = np.atleast_2d(u).T

            result = self.oct.feval(self.matlab_func_name, float(t), x_col, u_col, nout=1)
            result_array = np.array(result).flatten()
            return result_array

        except Exception as e:
            logger.error(f"Octave dynamics call failed: {str(e)}")
            raise

    def _create_simulator_wrapper(self):
        """Create an Octave wrapper function for efficient Monte Carlo simulation"""
        wrapper_path = os.path.join(self.matlab_working_dir, 'run_monte_carlo.m')
        wrapper_content = """
    function [t_vec, out_mean, out_std, ctrl_mean, ctrl_std] = run_monte_carlo(dyn_func, ctrl_type, ctrl_params, init_range, rand_level, dist_level, param_unc, num_states, dt, max_time, num_runs, min_ctrl, max_ctrl, target_val, output_ch)
        t_vec = 0:dt:(max_time - dt);
        n = length(t_vec);
        out_matrix = nan(num_runs, n);
        ctrl_matrix = nan(num_runs, n);

        % Convert output_ch from 0-indexed (Python) to 1-indexed (MATLAB)
        output_idx = output_ch + 1;

        for run = 1:num_runs
            x = init_range(1) + (init_range(2) - init_range(1)) * rand(num_states, 1);
            out_hist = nan(1, n);
            ctrl_hist = nan(1, n);
            out_hist(1) = x(output_idx);

            if strcmp(ctrl_type, 'PID')
                Kp = ctrl_params(1);
                Ki = ctrl_params(2);
                Kd = ctrl_params(3);
                integral = 0;
                prev_err = 0;
            elseif strcmp(ctrl_type, 'FSF')
                K = ctrl_params;
            end

            for i = 1:n
                t = t_vec(i);
                output = x(output_idx);
                err = target_val - output;

                if strcmp(ctrl_type, 'PID')
                    if rand_level > 0
                        err = err + rand_level * randn();
                    end
                    integral = integral + err * dt;
                    if i > 1
                        deriv = (err - prev_err) / dt;
                    else
                        deriv = 0;
                    end
                    u = Kp * err + Ki * integral + Kd * deriv;
                elseif strcmp(ctrl_type, 'FSF')
                    curr_x = x;
                    if rand_level > 0
                        curr_x = curr_x + rand_level * randn(num_states, 1);
                    end
                    % FIX: Desired state has target at output channel, zeros elsewhere
                    x_desired = zeros(num_states, 1);
                    x_desired(output_idx) = target_val;
                    state_err = curr_x - x_desired;
                    u = -K * state_err;
                end

                if dist_level > 0
                    dist = dist_level * sin(2 * pi * 5 * t);
                    u = u + dist;
                end

                % CHANGED: Use asymmetric clipping with min_ctrl and max_ctrl
                u = max(min(u, max_ctrl), min_ctrl);
                ctrl_hist(i) = u;

                if i < n
                    xdot = feval(dyn_func, t, x, u);
                    x = x + xdot * dt;
                    out_hist(i+1) = x(output_idx);
                end

                prev_err = err;

                if any(abs(x) > 100)
                    break;
                end
            end

            out_matrix(run, :) = out_hist;
            ctrl_matrix(run, :) = ctrl_hist;
        end

        % Compute statistics
        out_mean = zeros(1, n);
        out_std = zeros(1, n);
        ctrl_mean = zeros(1, n);
        ctrl_std = zeros(1, n);

        for i = 1:n
            valid_out = out_matrix(:, i);
            valid_out = valid_out(~isnan(valid_out));
            if ~isempty(valid_out)
                out_mean(i) = mean(valid_out);
                out_std(i) = std(valid_out);
            else
                out_mean(i) = nan;
                out_std(i) = nan;
            end

            valid_ctrl = ctrl_matrix(:, i);
            valid_ctrl = valid_ctrl(~isnan(valid_ctrl));
            if ~isempty(valid_ctrl)
                ctrl_mean(i) = mean(valid_ctrl);
                ctrl_std(i) = std(valid_ctrl);
            else
                ctrl_mean(i) = nan;
                ctrl_std(i) = nan;
            end
        end
    end
        """
        with open(wrapper_path, 'w') as f:
            f.write(wrapper_content.strip())
        self.temp_files_to_cleanup.append(wrapper_path)
        logger.info(f"Created Monte Carlo wrapper at {wrapper_path}")

    def run_simulation(self, control_params):
        """Route to appropriate simulation based on control parameters"""
        if isinstance(control_params, dict):
            fsf_keys = [f"K{i + 1}" for i in range(self.num_states)]
            if any(key in control_params for key in fsf_keys):
                K_values = [control_params.get(f"K{i + 1}", 0.0) for i in range(self.num_states)]
                return self.run_fsf_simulation(K_values)
            else:
                Kp = control_params.get('Kp', 0.0)
                Ki = control_params.get('Ki', 0.0)
                Kd = control_params.get('Kd', 0.0)
                return self.run_pid_simulation(Kp, Ki, Kd)
        else:
            if len(control_params) == self.num_states:
                return self.run_fsf_simulation(control_params)
            else:
                Kp, Ki, Kd = control_params[:3]
                return self.run_pid_simulation(Kp, Ki, Kd)

    def run_pid_simulation(self, Kp, Ki, Kd, initial_state=None):
        """PID control simulation for Octave SISO system

        Args:
            Kp, Ki, Kd: PID gains
            initial_state: Optional fixed initial state. If None, random IC is used.
        """
        expected_steps = int(self.max_time / self.dt) + 1
        t = np.arange(0, self.max_time + self.dt, self.dt)[:expected_steps]
        n = len(t)

        # Initialize state
        if initial_state is not None:
            x = initial_state.copy()  # Use provided initial state
        else:
            # Random initial conditions (original behavior)
            x = np.zeros(self.num_states)
            x[self.output_channel] = np.random.uniform(self.initial_condition_range[0], self.initial_condition_range[1])

        integral = 0.0
        prev_error = 0.0

        output_history = [x[self.output_channel]]
        control_history = []
        error_history = []

        logger.info(f"Starting PID simulation with Kp={Kp}, Ki={Ki}, Kd={Kd}")

        for i in range(n):
            output = x[self.output_channel]

            # Handle time-varying or constant target
            current_target = self.target(i * self.dt) if callable(self.target) else self.target
            error = current_target - output

            if self.randomness_level > 0:
                noise = np.random.normal(0, self.randomness_level)
                error += noise

            integral += error * self.dt
            if i > 0:
                derivative = (error - prev_error) / self.dt
            else:
                derivative = 0.0

            u_control = Kp * error + Ki * integral + Kd * derivative

            if self.disturbance_level > 0:
                disturbance = self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)
                u_control += disturbance

            u_control = np.clip(u_control, self.min_control, self.max_control)

            # Build full control input vector
            u_full = self.trim_values.copy()
            u_full[self.input_channel] = u_control

            control_history.append(u_control)
            error_history.append(error)

            try:
                # Pass full u_full vector (MIMO support)
                x_dot = self._call_octave_dynamics(i * self.dt, x, u_full)
                x = x + x_dot * self.dt
                # NEW: Divergence check (aligns with wrapper; prevents silent instability)
                if np.any(np.abs(x) > 100):
                    logger.warning(f"Simulation diverged at step {i}")
                    break
                output_history.append(x[self.output_channel])
            except Exception as e:
                logger.error(f"Octave dynamics call failed at step {i}: {e}")
                break

            prev_error = error

            if np.any(np.abs(x) > 100):
                logger.warning(f"Simulation diverged at step {i}")
                break

        logger.info(f"PID simulation completed: {len(control_history)} steps")

        return (np.array(output_history[:-1]),
                np.array(control_history),
                np.array(error_history))

    def run_fsf_simulation(self, K_values, initial_state=None):
        """Full-state feedback simulation for Octave SISO system

        Args:
            K_values: State feedback gains
            initial_state: Optional fixed initial state. If None, random IC is used.
        """
        expected_steps = int(self.max_time / self.dt) + 1
        t = np.arange(0, self.max_time + self.dt, self.dt)[:expected_steps]
        n = len(t)

        # Initialize state
        if initial_state is not None:
            x = initial_state.copy()  # Use provided initial state
        else:
            # Random initial conditions (original behavior)
            x = np.zeros(self.num_states)
            x[self.output_channel] = np.random.uniform(self.initial_condition_range[0], self.initial_condition_range[1])

        output_history = [x[self.output_channel]]
        control_history = []
        error_history = []

        logger.info(f"Starting FSF simulation with K={K_values}")

        for i in range(n):
            current_x = x.copy()

            if self.randomness_level > 0:
                noise = np.random.normal(0, self.randomness_level, self.num_states)
                current_x += noise

            # Get current target
            current_target = self.target(i * self.dt) if callable(self.target) else self.target

            # State error: regulate output channel to target, other states to zero
            x_desired = np.zeros(self.num_states)
            x_desired[self.output_channel] = current_target
            state_error = current_x - x_desired

            u_control = -np.dot(K_values, state_error)

            if self.disturbance_level > 0:
                disturbance = self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)
                u_control += disturbance

            u_control = np.clip(u_control, self.min_control, self.max_control)

            # Build full control input vector
            u_full = self.trim_values.copy()
            u_full[self.input_channel] = u_control

            control_history.append(u_control)
            error_history.append(current_target - x[self.output_channel])

            try:
                # Pass full u_full vector (MIMO support)
                x_dot = self._call_octave_dynamics(i * self.dt, x, u_full)
                x = x + x_dot * self.dt
                # NEW: Divergence check (aligns with wrapper; prevents silent instability)
                if np.any(np.abs(x) > 100):
                    logger.warning(f"Simulation diverged at step {i}")
                    break
                output_history.append(x[self.output_channel])
            except Exception as e:
                logger.error(f"Octave dynamics call failed at step {i}: {e}")
                break

            if np.any(np.abs(x) > 100):
                logger.warning(f"Simulation diverged at step {i}")
                break

        logger.info(f"FSF simulation completed: {len(control_history)} steps")

        return (np.array(output_history[:-1]),
                np.array(control_history),
                np.array(error_history))

    def run_monte_carlo(self, controller_type: str, control_params: dict, num_runs: int) -> Tuple[
        np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Run Monte Carlo simulations entirely in Octave for efficiency"""
        if controller_type == "PID":
            ctrl_params_list = [control_params.get('Kp', 0.0), control_params.get('Ki', 0.0),
                                control_params.get('Kd', 0.0)]
        elif controller_type == "FSF":
            ctrl_params_list = [control_params.get(f'K{i + 1}', 0.0) for i in range(self.num_states)]
        else:
            raise ValueError(f"Unknown controller type: {controller_type}")

        try:
            result = self.oct.run_monte_carlo(
                self.matlab_func_name,
                controller_type,
                ctrl_params_list,
                self.initial_condition_range,
                float(self.randomness_level),
                float(self.disturbance_level),
                float(self.param_uncertainty),
                float(self.num_states),
                float(self.dt),
                float(self.max_time),
                float(num_runs),
                float(self.min_control),  # NEW: Pass min_control
                float(self.max_control),  # NEW: Pass max_control (now after num_runs)
                float(self.target),
                float(self.output_channel),
                nout=5
            )

            time_vector = np.array(result[0]).flatten()
            output_mean = np.array(result[1]).flatten()
            output_std = np.array(result[2]).flatten()
            control_mean = np.array(result[3]).flatten()
            control_std = np.array(result[4]).flatten()

            # Ensure time vector matches expected length
            expected_steps = int(self.max_time / self.dt) + 1
            if len(time_vector) > expected_steps:
                time_vector = time_vector[:expected_steps]
                output_mean = output_mean[:expected_steps]
                output_std = output_std[:expected_steps]
                control_mean = control_mean[:expected_steps]
                control_std = control_std[:expected_steps]
            elif len(time_vector) < expected_steps:
                # Pad with NaN if too short
                pad_length = expected_steps - len(time_vector)
                time_vector = np.pad(time_vector, (0, pad_length), mode='constant', constant_values=np.nan)
                output_mean = np.pad(output_mean, (0, pad_length), mode='constant', constant_values=np.nan)
                output_std = np.pad(output_std, (0, pad_length), mode='constant', constant_values=np.nan)
                control_mean = np.pad(control_mean, (0, pad_length), mode='constant', constant_values=np.nan)
                control_std = np.pad(control_std, (0, pad_length), mode='constant', constant_values=np.nan)

            return time_vector, output_mean, output_std, control_mean, control_std

        except Exception as e:
            error_msg = f"Monte Carlo simulation in Octave failed: {str(e)}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)

    def __del__(self):
        """Clean up Octave engine when object is destroyed"""
        if hasattr(self, 'oct') and self.oct is not None:
            try:
                self.oct.exit()
                logger.info("Octave engine terminated")
            except:
                pass


class InvertedPendulum(GeneralDynamicalSystem):
    def __init__(self, scenario=None):
        self.name = "Inverted Pendulum"
        self.description = """
    An inverted pendulum system with a mass at the end of a rigid massless rod.
    The goal is to balance the pendulum in the upright position by applying torque at the pivot point.
    The system is inherently unstable and requires active control to maintain balance.
    """
        self.dt = 0.01
        self.max_time = 5.0
        self.theta_threshold = 0  # Failure angle
        self.max_torque = 1.0

        # System dimensions
        self.num_states = 2
        self.num_controls = 1
        self.state_names = ['theta', 'theta_dot']
        self.control_input_names = ['torque']

        # System parameters
        self.m = 0.1  # Mass (kg)
        self.l = 0.5  # Length (m)
        self.b = 0.1  # Damping
        self.g = 9.81  # Gravity

        # Apply scenario parameters if provided
        self.initial_condition_range = [np.pi / 6, np.pi / 3]  # Default range for initial conditions
        self.randomness_level = 0.0
        self.disturbance_level = 0.0
        self.param_uncertainty = 0.0

        if scenario:
            self.apply_scenario(scenario)
        else:
            self.m_perturbed = self.m
            self.l_perturbed = self.l
            self.b_perturbed = self.b

    def apply_scenario(self, scenario_params):
        """Apply scenario parameters with validation"""
        # Validate initial conditions
        ic_range = scenario_params.get('initial_condition_range', [np.pi / 6, np.pi / 3])
        self.initial_condition_range = [
            max(min(ic_range[0], np.pi), -np.pi / 2),  # Prevent unsafe ranges
            min(max(ic_range[1], -np.pi / 2), np.pi / 2)
        ]

        # Enforce predefined structure
        self.randomness_level = scenario_params.get('randomness_level', 0)
        self.disturbance_level = scenario_params.get('disturbance_level', 0)
        self.param_uncertainty = scenario_params.get('param_uncertainty', 0)

        if self.param_uncertainty > 0:
            # Create perturbed parameters with multiplicative noise
            uncertainty = self.param_uncertainty
            self.m_perturbed = self.m * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
            self.l_perturbed = self.l * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
            self.b_perturbed = self.b * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
        else:
            # Use nominal parameters
            self.m_perturbed = self.m
            self.l_perturbed = self.l
            self.b_perturbed = self.b

    def run_simulation(self, control_params, initial_state=None):
        """Route to appropriate simulation based on control parameters

        Args:
            control_params: Controller parameters (dict or list/tuple)
            initial_state: Optional fixed initial state for reproducible simulations
        """
        if isinstance(control_params, dict):
            fsf_keys = [f"K{i + 1}" for i in range(self.num_states)]
            if any(key in control_params for key in fsf_keys):
                K_values = [control_params.get(f"K{i + 1}", 0.0) for i in range(self.num_states)]
                return self.run_fsf_simulation(K_values, initial_state=initial_state)
            else:
                Kp = control_params.get('Kp', 0.0)
                Ki = control_params.get('Ki', 0.0)
                Kd = control_params.get('Kd', 0.0)
                return self.run_pid_simulation(Kp, Ki, Kd, initial_state=initial_state)
        else:
            if len(control_params) == self.num_states:
                return self.run_fsf_simulation(control_params, initial_state=initial_state)
            else:
                Kp, Ki, Kd = control_params[:3]
                return self.run_pid_simulation(Kp, Ki, Kd, initial_state=initial_state)

    def run_pid_simulation(self, Kp, Ki, Kd, initial_state=None):
        t = np.arange(0, self.max_time, self.dt)
        n = len(t)
        control_signals = []
        errors = []
        prev_error = 0.0

        # Initial Conditions
        if initial_state is not None:
            x = initial_state.copy()
        else:
            theta0 = np.random.uniform(
                self.initial_condition_range[0],
                self.initial_condition_range[1]
            )
            theta_dot0 = 0.1
            x = np.array([theta0, theta_dot0])

        # Rest of the method remains the same...
        theta_d = np.pi
        integral = 0
        theta_history = [x[0]]
        u_history = []

        for i in range(n):
            theta = x[0]
            theta_dot = x[1]
            error = theta_d - theta

            noise = np.random.normal(0, self.randomness_level) if self.randomness_level > 0 else 0
            error += noise

            integral += error * self.dt
            derivative = (error - prev_error) / self.dt if i > 0 else 0
            u = Kp * error + Ki * integral + Kd * derivative

            if self.disturbance_level > 0:
                disturbance = self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)
                u += disturbance

            u = np.clip(u, -self.max_torque, self.max_torque)
            u_history.append(u)

            theta_dotdot = (u - self.m_perturbed * self.g * self.l_perturbed * np.sin(theta) \
                            - self.b_perturbed * theta_dot) / (self.m_perturbed * self.l_perturbed ** 2)
            x = x + np.array([theta_dot, theta_dotdot]) * self.dt
            theta_history.append(x[0])

            prev_error = error
            errors.append(error)

            if abs(theta) < self.theta_threshold or abs(theta) > 2 * np.pi + self.theta_threshold:
                break

        theta_history = np.array(theta_history[:-1])
        u_history = np.array(u_history)

        return np.array(theta_history), np.array(u_history), np.array(errors)

    def run_fsf_simulation(self, K_values, initial_state=None):
        """Accept K_values as a list/array instead of separate K1, K2 parameters"""
        if isinstance(K_values, (list, tuple, np.ndarray)):
            K1, K2 = K_values[0], K_values[1]
        else:
            # Fallback for old signature
            K1 = K_values
            K2 = initial_state if initial_state is not None else 0.0
            initial_state = None

        t = np.arange(0, self.max_time, self.dt)
        n = len(t)
        control_signals = []
        errors = []

        # Initial Conditions
        if initial_state is not None:
            x = initial_state.copy()
        else:
            theta0 = np.random.uniform(
                self.initial_condition_range[0],
                self.initial_condition_range[1]
            )
            theta_dot0 = 0.1
            x = np.array([theta0, theta_dot0])

        # Rest of the method remains the same...
        theta_d = np.pi
        theta_history = [x[0]]
        u_history = []

        for i in range(n):
            theta = x[0]
            theta_dot = x[1]
            error = theta_d - theta

            noise_theta = np.random.normal(0, self.randomness_level) if self.randomness_level > 0 else 0
            noise_theta_dot = np.random.normal(0, self.randomness_level) if self.randomness_level > 0 else 0

            u = -K1 * (-error + noise_theta) - K2 * (theta_dot + noise_theta_dot)

            if self.disturbance_level > 0:
                disturbance = self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)
                u += disturbance

            u = np.clip(u, -self.max_torque, self.max_torque)
            u_history.append(u)

            theta_dotdot = (u - self.m_perturbed * self.g * self.l_perturbed * np.sin(theta) \
                            - self.b_perturbed * theta_dot) / (self.m_perturbed * self.l_perturbed ** 2)
            x = x + np.array([theta_dot, theta_dotdot]) * self.dt
            theta_history.append(x[0])

            errors.append(error)

            if abs(theta) < self.theta_threshold or abs(theta) > 2 * np.pi + self.theta_threshold:
                break

        theta_history = np.array(theta_history[:-1])
        u_history = np.array(u_history)

        return np.array(theta_history), np.array(u_history), np.array(errors)

    def plot_time_response(self, control_params, save_path=None, num_runs=100):
        # Determine controller type based on parameters
        if isinstance(control_params, dict):
            if 'K1' in control_params and 'K2' in control_params:
                controller_type = "FSF"
                title_params = f"K1={control_params['K1']:.2f}, K2={control_params['K2']:.2f}"
            else:
                controller_type = "PID"
                title_params = f"Kp={control_params.get('Kp', 0):.2f}, Ki={control_params.get('Ki', 0):.2f}, Kd={control_params.get('Kd', 0):.2f}"
        else:
            controller_type = "PID"
            Kp, Ki, Kd = control_params
            title_params = f"Kp={Kp:.2f}, Ki={Ki:.2f}, Kd={Kd:.2f}"

        # Reconstruct scenario parameters from current instance
        scenario_params = {
            'initial_condition_range': self.initial_condition_range,
            'randomness_level': self.randomness_level,
            'disturbance_level': self.disturbance_level,
            'param_uncertainty': self.param_uncertainty
        }

        # Monte Carlo simulation
        all_theta, all_control = [], []
        for _ in range(num_runs):
            system = InvertedPendulum(scenario_params)
            theta, control, _ = system.run_simulation(control_params)
            all_theta.append(theta)
            all_control.append(control)

        # Process trajectories
        max_len = max(len(t) for t in all_theta)
        time_vector = np.arange(0, max_len * self.dt, self.dt)

        theta_matrix = np.full((num_runs, max_len), np.nan)
        control_matrix = np.full((num_runs, max_len), np.nan)
        for i in range(num_runs):
            theta_matrix[i, :len(all_theta[i])] = all_theta[i]
            control_matrix[i, :len(all_control[i])] = all_control[i]

        # Calculate statistics
        theta_mean = np.degrees(np.nanmean(theta_matrix, axis=0))
        theta_std = np.degrees(np.nanstd(theta_matrix, axis=0))
        control_mean = np.nanmean(control_matrix, axis=0)
        control_std = np.nanstd(control_matrix, axis=0)

        # Create plot
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)

        # Angle plot
        ax1.plot(time_vector, theta_mean, 'b-', lw=2, label='Mean Angle')
        ax1.fill_between(time_vector, theta_mean - theta_std, theta_mean + theta_std,
                         color='blue', alpha=0.2, label='±1 SD')
        ax1.axhline(0, color='r', linestyle='--', alpha=0.7, label='Target')
        ax1.set_ylabel('Angle (degrees)')
        ax1.set_title(f"Monte Carlo Response ({num_runs} runs) | {controller_type} | {title_params}")
        ax1.grid(True, linestyle='--', alpha=0.7)
        ax1.legend(loc='upper right')

        # Control signal plot
        ax2.plot(time_vector, control_mean, 'g-', lw=2, label='Mean Control')
        ax2.fill_between(time_vector, control_mean - control_std, control_mean + control_std,
                         color='green', alpha=0.2, label='±1 SD')
        ax2.set_xlabel('Time (s)')
        ax2.set_ylabel('Control Signal (Nm)')
        ax2.grid(True, linestyle='--', alpha=0.7)
        ax2.legend(loc='upper right')

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.show()

        return fig

    def linearize(self):
        """
        Linearize the inverted pendulum around the upright equilibrium
        Returns A, B, C, D matrices
        """
        # Linearization around theta=pi (upright), theta_dot=0
        A = np.array([
            [0, 1],
            [self.g / self.l, -self.b / (self.m * self.l ** 2)]
        ])

        B = np.array([
            [0],
            [1 / (self.m * self.l ** 2)]
        ])

        C = np.array([[1, 0]])  # Output is theta
        D = np.array([[0]])

        return A, B, C, D

    def system_dynamics(self, x, u):
        """System dynamics for linearization

        Args:
            x: State vector [theta, theta_dot]
            u: Control input (scalar or array)
        """
        theta = x[0]
        theta_dot = x[1]

        # Extract scalar control input
        u_scalar = u[0] if isinstance(u, (list, np.ndarray)) else u

        # Dynamics
        theta_dotdot = (u_scalar - self.m * self.g * self.l * np.sin(theta) \
                        - self.b * theta_dot) / (self.m * self.l ** 2)

        return np.array([theta_dot, theta_dotdot])


class DCMotorPositionControl(GeneralDynamicalSystem):
    def __init__(self, scenario=None):
        super().__init__(scenario)
        self.name = "DC Motor Position Control"
        self.description = """
    A DC motor position control system with current, angular velocity, and position states.
    The goal is to control the motor's angular position by applying voltage.
    The system includes electrical and mechanical dynamics with active control.
    """
        self.dt = 0.01
        self.max_time = 10.0
        self.theta_threshold = np.pi  # Failure angle (radians)
        self.max_voltage = 24.0  # Maximum control voltage (V)

        # System dimensions
        self.num_states = 3
        self.num_controls = 1
        self.state_names = ['current', 'omega', 'theta']
        self.control_input_names = ['voltage']

        # Motor parameters
        self.J = 0.01  # Moment of inertia (kg·m²)
        self.b = 0.1  # Damping coefficient (N·m·s)
        self.K = 0.01  # Motor torque constant (N·m/A)
        self.R = 1.0  # Armature resistance (Ω)
        self.L = 0.5  # Armature inductance (H)

        # Apply scenario parameters if provided
        self.initial_condition_range = [0, np.pi / 6]  # Default range for initial position (rad)
        self.randomness_level = 0.0
        self.disturbance_level = 0.0
        self.param_uncertainty = 0.0

        if scenario:
            self.apply_scenario(scenario)
        else:
            self.J_perturbed = self.J
            self.b_perturbed = self.b
            self.K_perturbed = self.K
            self.R_perturbed = self.R
            self.L_perturbed = self.L

    def apply_scenario(self, scenario_params):
        """Apply scenario parameters with validation"""
        # Validate initial conditions
        ic_range = scenario_params.get('initial_condition_range', [0, np.pi / 6])
        self.initial_condition_range = [
            max(min(ic_range[0], np.pi), -np.pi),  # Prevent unsafe ranges
            min(max(ic_range[1], -np.pi), np.pi)
        ]

        self.randomness_level = scenario_params.get('randomness_level', 0)
        self.disturbance_level = scenario_params.get('disturbance_level', 0)
        self.param_uncertainty = scenario_params.get('param_uncertainty', 0)

        if self.param_uncertainty > 0:
            uncertainty = self.param_uncertainty
            self.J_perturbed = self.J * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
            self.b_perturbed = self.b * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
            self.K_perturbed = self.K * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
            self.R_perturbed = self.R * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
            self.L_perturbed = self.L * (1 + uncertainty * np.sign(np.random.rand() * 2 - 1))
        else:
            self.J_perturbed = self.J
            self.b_perturbed = self.b
            self.K_perturbed = self.K
            self.R_perturbed = self.R
            self.L_perturbed = self.L

    def system_dynamics(self, X, voltage):
        """Compute state derivatives based on DC motor dynamics"""
        current, omega, theta = X
        J = self.J_perturbed
        b = self.b_perturbed
        K = self.K_perturbed
        R = self.R_perturbed
        L = self.L_perturbed

        # Extract scalar voltage
        voltage_scalar = voltage[0] if isinstance(voltage, (list, np.ndarray)) else voltage

        # Current dynamics: di/dt = (V - Ri - Kω)/L
        current_dot = (voltage_scalar - R * current - K * omega) / L
        # Mechanical dynamics: dω/dt = (Ki - bω)/J
        torque = K * current
        omega_dot = (torque - b * omega) / J
        # Position dynamics: dθ/dt = ω
        theta_dot = omega

        return np.array([current_dot, omega_dot, theta_dot])

    def run_pid_simulation(self, Kp, Ki, Kd, initial_state=None):
        t = np.arange(0, self.max_time, self.dt)
        n = len(t)
        errors = []
        prev_error = 0.0

        # Initial conditions
        if initial_state is not None:
            x = initial_state.copy()
        else:
            theta0 = np.random.uniform(self.initial_condition_range[0], self.initial_condition_range[1])
            current0 = 0.0  # Initial current (A)
            omega0 = 0.0  # Initial angular velocity (rad/s)
            x = np.array([current0, omega0, theta0])

        # Rest remains the same...
        theta_d = 0
        integral = 0
        theta_history = [x[2]]
        u_history = []

        for i in range(n):
            theta = x[2]
            error = theta_d - theta

            noise = np.random.normal(0, self.randomness_level) if self.randomness_level > 0 else 0
            error += noise

            integral += error * self.dt
            derivative = (error - prev_error) / self.dt if i > 0 else 0
            u = Kp * error + Ki * integral + Kd * derivative

            if self.disturbance_level > 0:
                disturbance = self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)
                u += disturbance

            u = np.clip(u, -self.max_voltage, self.max_voltage)
            u_history.append(u)

            x_dot = self.system_dynamics(x, u)
            x = x + x_dot * self.dt
            theta_history.append(x[2])
            errors.append(error)
            prev_error = error

            if abs(theta) > self.theta_threshold:
                break

        theta_history = np.array(theta_history[:-1])
        u_history = np.array(u_history)
        return theta_history, u_history, np.array(errors)

    def run_fsf_simulation(self, K_values, initial_state=None):
        """Accept K_values as a list/array"""
        if isinstance(K_values, (list, tuple, np.ndarray)):
            K1, K2, K3 = K_values[0], K_values[1], K_values[2]
        else:
            raise ValueError("K_values must be a list, tuple, or array of 3 gains")

        t = np.arange(0, self.max_time, self.dt)
        n = len(t)
        errors = []

        # Initial conditions
        if initial_state is not None:
            x = initial_state.copy()
        else:
            theta0 = np.random.uniform(self.initial_condition_range[0], self.initial_condition_range[1])
            current0 = 0.0
            omega0 = 0.0
            x = np.array([current0, omega0, theta0])

        # Rest remains the same...
        theta_d = 0
        theta_history = [x[2]]
        u_history = []

        for i in range(n):
            current, omega, theta = x
            error = theta_d - theta

            noise = np.random.normal(0, self.randomness_level, 3) if self.randomness_level > 0 else np.zeros(3)
            x_noisy = x + noise

            u = -K1 * x_noisy[0] - K2 * x_noisy[1] - K3 * x_noisy[2]

            if self.disturbance_level > 0:
                disturbance = self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)
                u += disturbance

            u = np.clip(u, -self.max_voltage, self.max_voltage)
            u_history.append(u)

            x_dot = self.system_dynamics(x, u)
            x = x + x_dot * self.dt
            theta_history.append(x[2])
            errors.append(error)

            if abs(theta) > self.theta_threshold:
                break

        theta_history = np.array(theta_history[:-1])
        u_history = np.array(u_history)
        return theta_history, u_history, np.array(errors)

    def get_control_param_schema(self, controller_type):
        """Return the parameter schema for a given controller type"""
        if controller_type == "FSF":
            return {f"K{i + 1}": {"min": -10.0, "max": 10.0} for i in range(self.num_states)}
        return super().get_control_param_schema(controller_type)

    def plot_time_response(self, control_params, save_path=None, num_runs=100):
        # Determine controller type based on parameters
        if isinstance(control_params, dict):
            if all(f"K{i + 1}" in control_params for i in range(self.num_states)):
                controller_type = "FSF"
                title_params = f"K1={control_params['K1']:.2f}, K2={control_params['K2']:.2f}, K3={control_params['K3']:.2f}"
            else:
                controller_type = "PID"
                title_params = f"Kp={control_params.get('Kp', 0):.2f}, Ki={control_params.get('Ki', 0):.2f}, Kd={control_params.get('Kd', 0):.2f}"
        else:
            controller_type = "PID"
            Kp, Ki, Kd = control_params
            title_params = f"Kp={Kp:.2f}, Ki={Ki:.2f}, Kd={Kd:.2f}"

        # Reconstruct scenario parameters
        scenario_params = {
            'initial_condition_range': self.initial_condition_range,
            'randomness_level': self.randomness_level,
            'disturbance_level': self.disturbance_level,
            'param_uncertainty': self.param_uncertainty
        }

        # Monte Carlo simulation
        all_theta, all_control = [], []
        for _ in range(num_runs):
            system = DCMotorPositionControl(scenario_params)
            theta, control, _ = system.run_simulation(control_params)
            all_theta.append(theta)
            all_control.append(control)

        # Process trajectories
        max_len = max(len(t) for t in all_theta)
        time_vector = np.arange(0, max_len * self.dt, self.dt)

        theta_matrix = np.full((num_runs, max_len), np.nan)
        control_matrix = np.full((num_runs, max_len), np.nan)
        for i in range(num_runs):
            theta_matrix[i, :len(all_theta[i])] = all_theta[i]
            control_matrix[i, :len(all_control[i])] = all_control[i]

        # Calculate statistics
        theta_mean = np.degrees(np.nanmean(theta_matrix, axis=0))
        theta_std = np.degrees(np.nanstd(theta_matrix, axis=0))
        control_mean = np.nanmean(control_matrix, axis=0)
        control_std = np.nanstd(control_matrix, axis=0)

        # Create plot
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)

        # Angle plot
        ax1.plot(time_vector, theta_mean, 'b-', lw=2, label='Mean Position')
        ax1.fill_between(time_vector, theta_mean - theta_std, theta_mean + theta_std,
                         color='blue', alpha=0.2, label='±1 SD')
        ax1.axhline(0, color='r', linestyle='--', alpha=0.7, label='Target')
        ax1.set_ylabel('Position (degrees)')
        ax1.set_title(f"Monte Carlo Response ({num_runs} runs) | {controller_type} | {title_params}")
        ax1.grid(True, linestyle='--', alpha=0.7)
        ax1.legend(loc='upper right')

        # Control signal plot
        ax2.plot(time_vector, control_mean, 'g-', lw=2, label='Mean Voltage')
        ax2.fill_between(time_vector, control_mean - control_std, control_mean + control_std,
                         color='green', alpha=0.2, label='±1 SD')
        ax2.set_xlabel('Time (s)')
        ax2.set_ylabel('Control Voltage (V)')
        ax2.grid(True, linestyle='--', alpha=0.7)
        ax2.legend(loc='upper right')

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.show()


class BallBeam(GeneralDynamicalSystem):
    def __init__(self, scenario=None):
        self.name = "Ball and Beam System"
        self.description = """
    A ball rolling on a beam where the control input is the angular acceleration of the beam.
    The goal is to stabilize the ball at a desired position along the beam.
    States: [ball_position, ball_velocity, beam_angle, beam_angular_velocity]
    Control input: beam_angular_acceleration (theta)
    """
        self.dt = 0.01
        self.max_time = 10.0
        self.max_beam_length = 2.0  # Beam length in meters
        self.r_desired = 0.0  # Target position

        # System dimensions
        self.num_states = 4
        self.num_controls = 1
        self.state_names = ['r', 'dr', 'alpha', 'dalpha']
        self.control_input_names = ['theta']

        # Physics parameters
        self.g = -9.8  # Gravity (m/s²)
        self.m = 0.11  # Ball mass (kg)
        self.R = 0.015  # Ball radius (m)
        self.J = 9.99e-6  # Ball moment of inertia (kg·m²)
        self.max_theta = 5.0  # Max angular acceleration (rad/s²)

        # Scenario parameters
        self.initial_condition_range = [0.5, 1.0]  # Default initial ball position range
        self.randomness_level = 0.0
        self.disturbance_level = 0.0
        self.param_uncertainty = 0.0

        # Apply scenario modifications if provided
        if scenario:
            self.apply_scenario(scenario)
        else:
            self.m_perturbed = self.m
            self.R_perturbed = self.R
            self.J_perturbed = self.J

    def apply_scenario(self, scenario_params):
        """Apply scenario parameters with validation"""
        # Validate initial conditions
        ic_range = scenario_params.get('initial_condition_range', [0.5, 1.0])
        self.initial_condition_range = [
            max(min(ic_range[0], self.max_beam_length), 0.0),
            min(max(ic_range[1], 0.0), self.max_beam_length)
        ]

        # Apply other scenario parameters
        self.randomness_level = scenario_params.get('randomness_level', 0)
        self.disturbance_level = scenario_params.get('disturbance_level', 0)
        self.param_uncertainty = scenario_params.get('param_uncertainty', 0)

        # Handle parameter uncertainty
        if self.param_uncertainty > 0:
            uncertainty = self.param_uncertainty
            self.m_perturbed = self.m * (1 + uncertainty * np.sign(2 * np.random.rand() - 1))
            self.R_perturbed = self.R * (1 + uncertainty * np.sign(2 * np.random.rand() - 1))
            self.J_perturbed = self.J * (1 + uncertainty * np.sign(2 * np.random.rand() - 1))
        else:
            self.m_perturbed = self.m
            self.R_perturbed = self.R
            self.J_perturbed = self.J

    def system_dynamics(self, state, u):
        """Compute state derivatives given current state and control input"""
        r, dr, alpha, dalpha = state

        # Extract scalar control input
        u_scalar = u[0] if isinstance(u, (list, np.ndarray)) else u

        # Use perturbed parameters if uncertainty exists
        m = self.m_perturbed
        R = self.R_perturbed
        J = self.J_perturbed

        # Ball acceleration calculation
        numerator = R ** 2 * m * (r * dalpha ** 2 - self.g * np.sin(alpha))
        denominator = m * R ** 2 + J
        ddr = numerator / denominator

        # State derivatives
        return np.array([
            dr,  # dr/dt = velocity
            ddr,  # d²r/dt² = acceleration
            dalpha,  # dalpha/dt = angular velocity
            u_scalar  # d²alpha/dt² = control input (theta)
        ])

    def run_pid_simulation(self, Kp, Ki, Kd, initial_state=None):
        t = np.arange(0, self.max_time, self.dt)
        n = len(t)

        # Initialize state
        if initial_state is not None:
            x = initial_state.copy()
        else:
            r0 = np.random.uniform(*self.initial_condition_range)
            x = np.array([r0, 0.0, 0.0, 0.0])

        # Rest remains the same...
        integral = 0.0
        prev_error = 0.0
        r_history = [x[0]]
        u_history = []
        errors = []

        for i in range(n):
            r = x[0]
            error = self.r_desired - r

            if self.randomness_level > 0:
                error += np.random.normal(0, self.randomness_level)

            integral += error * self.dt
            derivative = (error - prev_error) / self.dt if i > 0 else 0.0
            u = Kp * error + Ki * integral + Kd * derivative

            if self.disturbance_level > 0:
                u += self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)

            u = np.clip(u, -self.max_theta, self.max_theta)
            u_history.append(u)
            errors.append(error)

            x_dot = self.system_dynamics(x, u)
            x = x + x_dot * self.dt
            r_history.append(x[0])
            prev_error = error

            if x[0] < -0.5 * self.max_beam_length or x[0] > self.max_beam_length:
                break

        r_history = np.array(r_history[:-1])
        return r_history, np.array(u_history), np.array(errors)

    def run_fsf_simulation(self, K_values, initial_state=None):
        """Accept K_values as a list/array"""
        if isinstance(K_values, (list, tuple, np.ndarray)):
            K1, K2, K3, K4 = K_values[0], K_values[1], K_values[2], K_values[3]
        else:
            raise ValueError("K_values must be a list, tuple, or array of 4 gains")

        t = np.arange(0, self.max_time, self.dt)
        n = len(t)

        # Initialize state
        if initial_state is not None:
            x = initial_state.copy()
        else:
            r0 = np.random.uniform(*self.initial_condition_range)
            x = np.array([r0, 0.0, 0.0, 0.0])

        # Rest remains the same...
        r_history = [x[0]]
        u_history = []
        errors = []

        for i in range(n):
            noise = np.random.normal(0, self.randomness_level, 4) if self.randomness_level > 0 else np.zeros(4)
            x_noisy = x + noise

            errors.append(x_noisy[0])

            u = -K1 * (x_noisy[0] - self.r_desired) - K2 * x_noisy[1] - K3 * x_noisy[2] - K4 * x_noisy[3]

            if self.disturbance_level > 0:
                u += self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)

            u = np.clip(u, -self.max_theta, self.max_theta)
            u_history.append(u)

            x_dot = self.system_dynamics(x, u)
            x = x + x_dot * self.dt
            r_history.append(x[0])

            if x[0] < -0.5 * self.max_beam_length or x[0] > self.max_beam_length:
                break

        r_history = np.array(r_history[:-1])
        return r_history, np.array(u_history), np.array(errors)

    def plot_time_response(self, control_params, save_path=None, num_runs=100):
        # Determine controller type based on parameters
        if isinstance(control_params, dict):
            if 'K1' in control_params:
                controller_type = "FSF"
                title_params = ", ".join(
                    [f"K{i + 1}={control_params[f'K{i + 1}']:.2f}" for i in range(self.num_states)])
            else:
                controller_type = "PID"
                title_params = f"Kp={control_params.get('Kp', 0):.2f}, Ki={control_params.get('Ki', 0):.2f}, Kd={control_params.get('Kd', 0):.2f}"
        else:
            if len(control_params) == self.num_states:
                controller_type = "FSF"
                title_params = ", ".join([f"K{i + 1}={val:.2f}" for i, val in enumerate(control_params)])
            else:
                controller_type = "PID"
                Kp, Ki, Kd = control_params[:3]
                title_params = f"Kp={Kp:.2f}, Ki={Ki:.2f}, Kd={Kd:.2f}"

        # Reconstruct scenario parameters
        scenario_params = {
            'initial_condition_range': self.initial_condition_range,
            'randomness_level': self.randomness_level,
            'disturbance_level': self.disturbance_level,
            'param_uncertainty': self.param_uncertainty
        }

        # Monte Carlo simulation
        all_r, all_control = [], []
        for _ in range(num_runs):
            system = BallBeam(scenario_params)
            r, control, _ = system.run_simulation(control_params)
            all_r.append(r)
            all_control.append(control)

        # Process trajectories
        max_len = max(len(r) for r in all_r)
        time_vector = np.arange(0, max_len * self.dt, self.dt)

        r_matrix = np.full((num_runs, max_len), np.nan)
        control_matrix = np.full((num_runs, max_len), np.nan)
        for i in range(num_runs):
            r_matrix[i, :len(all_r[i])] = all_r[i]
            control_matrix[i, :len(all_control[i])] = all_control[i]

        # Calculate statistics
        r_mean = np.nanmean(r_matrix, axis=0)
        r_std = np.nanstd(r_matrix, axis=0)
        control_mean = np.nanmean(control_matrix, axis=0)
        control_std = np.nanstd(control_matrix, axis=0)

        # Create plot
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)

        # Position plot
        ax1.plot(time_vector[:len(r_mean)], r_mean, 'b-', lw=2, label='Mean Position')
        ax1.fill_between(time_vector[:len(r_mean)], r_mean - r_std, r_mean + r_std,
                         color='blue', alpha=0.2, label='±1 SD')
        ax1.axhline(self.r_desired, color='r', linestyle='--', alpha=0.7, label='Target')
        ax1.set_ylabel('Ball Position (m)')
        ax1.set_title(f"Ball and Beam Response ({num_runs} runs) | {controller_type} | {title_params}")
        ax1.grid(True, linestyle='--', alpha=0.7)
        ax1.legend(loc='upper right')

        # Control signal plot
        ax2.plot(time_vector[:len(r_mean)], control_mean, 'g-', lw=2, label='Mean Control')
        ax2.fill_between(time_vector[:len(r_mean)], control_mean - control_std, control_mean + control_std,
                         color='green', alpha=0.2, label='±1 SD')
        ax2.set_xlabel('Time (s)')
        ax2.set_ylabel('Angular Accel (rad/s²)')
        ax2.grid(True, linestyle='--', alpha=0.7)
        ax2.legend(loc='upper right')

        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.show()


class DoublePendulum(GeneralDynamicalSystem):
    def __init__(self, scenario=None):
        self.name = "Double Pendulum"
        self.description = """
A double pendulum system with two masses connected by rigid massless rods.
Control torque is applied at the base (first joint). The system is highly
nonlinear and chaotic, making control challenging.
"""
        self.dt = 0.01
        self.max_time = 5.0
        self.theta_threshold = np.pi / 2  # Failure angle (radians)

        # System dimensions
        self.num_states = 4
        self.num_controls = 1
        self.state_names = ['theta1', 'theta2', 'theta1_dot', 'theta2_dot']
        self.control_input_names = ['torque1']

        # System parameters (nominal values)
        self.m1 = 0.1  # Mass of first pendulum (kg)
        self.m2 = 0.05  # Mass of second pendulum (kg)
        self.L1 = 0.5  # Length of first pendulum (m)
        self.L2 = 0.3  # Length of second pendulum (m)
        self.g = 9.81  # Gravity (m/s^2)
        self.max_torque = 150.0  # Maximum control torque (Nm)

        # Perturbed parameters (used when uncertainty is applied)
        self.m1_perturbed = self.m1
        self.m2_perturbed = self.m2
        self.L1_perturbed = self.L1
        self.L2_perturbed = self.L2

        # Initial condition ranges [min, max]
        self.initial_condition_range = [0.1, 0.2]  # Default range
        self.randomness_level = 0.0  # Measurement noise level
        self.disturbance_level = 0.0  # External disturbance level
        self.param_uncertainty = 0.0  # Parameter uncertainty level

        # Apply scenario modifications if provided
        if scenario:
            self.apply_scenario(scenario)

    def apply_scenario(self, scenario_params):
        """Apply scenario parameters with validation"""
        # Validate initial conditions
        self.initial_condition_range = scenario_params.get('initial_condition_range', [0.1, 0.2])

        # Update other parameters
        self.randomness_level = scenario_params.get('randomness_level', 0.0)
        self.disturbance_level = scenario_params.get('disturbance_level', 0.0)
        self.param_uncertainty = scenario_params.get('param_uncertainty', 0.0)

        # Apply parameter uncertainty
        if self.param_uncertainty > 0:
            self.m1_perturbed = self.m1 * (1 + self.param_uncertainty * np.sign(2 * np.random.rand() - 1))
            self.m2_perturbed = self.m2 * (1 + self.param_uncertainty * np.sign(2 * np.random.rand() - 1))
            self.L1_perturbed = self.L1 * (1 + self.param_uncertainty * np.sign(2 * np.random.rand() - 1))
            self.L2_perturbed = self.L2 * (1 + self.param_uncertainty * np.sign(2 * np.random.rand() - 1))
        else:
            self.m1_perturbed = self.m1
            self.m2_perturbed = self.m2
            self.L1_perturbed = self.L1
            self.L2_perturbed = self.L2

    def get_control_param_schema(self, controller_type):
        """Return parameter schema only for FSF (no PID support)"""
        if controller_type == "FSF":
            return {f"K{i + 1}": {"min": -50.0, "max": 50.0} for i in range(4)}
        else:
            raise ValueError(f"Only FSF control is supported for {self.name}")

    def run_simulation(self, control_params, initial_state=None):
        """Run simulation with FSF control only

        Args:
            control_params: Controller parameters (dict or list/tuple/array)
            initial_state: Optional fixed initial state

        Returns:
            trajectory: Output channel history
            control_signals: Control signal history
            errors: Error history
        """
        if isinstance(control_params, dict):
            # Extract FSF gains from dictionary
            K_values = [control_params.get(f"K{i + 1}", 0.0) for i in range(4)]
            return self.run_fsf_simulation(K_values, initial_state=initial_state)
        elif isinstance(control_params, (list, tuple, np.ndarray)):
            # Use list/tuple of gains directly
            if len(control_params) == 4:
                return self.run_fsf_simulation(control_params, initial_state=initial_state)
            else:
                raise ValueError("Requires exactly 4 gains for FSF control")
        else:
            raise TypeError("control_params must be dict or list/tuple of 4 gains")

    def _dynamics(self, X, u):
        """Compute state derivatives for double pendulum"""
        theta1, theta2, dtheta1, dtheta2 = X

        # Use perturbed parameters if uncertainty is applied
        m1 = self.m1_perturbed
        m2 = self.m2_perturbed
        L1 = self.L1_perturbed
        L2 = self.L2_perturbed
        g = self.g

        # Compute ddtheta1
        numerator_ddtheta1 = (
            - (2 * L1 * g * m1 * np.sin(theta1)
               - 2 * u
               + L1 * g * m2 * np.sin(theta1)
               + L1 * g * m2 * np.sin(theta1 - 2 * theta2)
               + L1 ** 2 * dtheta1 ** 2 * m2 * np.sin(2 * theta1 - 2 * theta2)
               + 2 * L1 * L2 * dtheta2 ** 2 * m2 * np.sin(theta1 - theta2))
        )
        denominator_ddtheta1 = L1 ** 2 * (2 * m1 + m2 - m2 * np.cos(2 * theta1 - 2 * theta2))
        ddtheta1 = numerator_ddtheta1 / denominator_ddtheta1

        # Compute ddtheta2
        numerator_ddtheta2 = (
                2 * L1 ** 2 * dtheta1 ** 2 * m1 * np.sin(theta1 - theta2)
                - 2 * u * np.cos(theta1 - theta2)
                + 2 * L1 ** 2 * dtheta1 ** 2 * m2 * np.sin(theta1 - theta2)
                - L1 * g * m1 * np.sin(theta2)
                - L1 * g * m2 * np.sin(theta2)
                + L1 * g * m1 * np.sin(2 * theta1 - theta2)
                + L1 * g * m2 * np.sin(2 * theta1 - theta2)
                + L1 * L2 * dtheta2 ** 2 * m2 * np.sin(2 * theta1 - 2 * theta2)
        )
        denominator_ddtheta2 = L1 * L2 * (2 * m1 + m2 - m2 * np.cos(2 * theta1 - 2 * theta2))
        ddtheta2 = numerator_ddtheta2 / denominator_ddtheta2

        return np.array([dtheta1, dtheta2, ddtheta1, ddtheta2])

    def run_fsf_simulation(self, K_values, initial_state=None):
        """Simulate double pendulum with full-state feedback control

        Args:
            K_values: List/array of 4 gains [K1, K2, K3, K4]
            initial_state: Optional fixed initial state

        Returns:
            trajectory: Output channel history (theta1)
            u_hist: Control signal history
            errors: Error history for output channel
        """
        if isinstance(K_values, (list, tuple, np.ndarray)):
            K1, K2, K3, K4 = K_values[0], K_values[1], K_values[2], K_values[3]
        else:
            raise ValueError("K_values must be a list, tuple, or array of 4 gains")

        t = np.arange(0, self.max_time, self.dt)
        n = len(t)

        # Initialize state
        if initial_state is not None:
            X = initial_state.copy()
        else:
            theta1_0 = np.random.uniform(*self.initial_condition_range)
            theta2_0 = np.random.uniform(*self.initial_condition_range)
            X = np.array([theta1_0, theta2_0, 0.1, 0.1])

        # Initialize history arrays
        theta1_hist = [X[0]]
        u_hist = []
        errors = []

        # Desired state
        X_desired = np.array([np.pi, np.pi, 0, 0])

        # Simulation loop
        for i in range(n):
            # Apply measurement noise if configured
            noise = np.zeros(4)
            if self.randomness_level > 0:
                noise = np.random.normal(0, self.randomness_level, 4)

            # Calculate error vector
            error = X_desired - X

            # Store error for the output channel (theta1)
            errors.append(error[0])

            # Full-state feedback control law
            u = - (K1 * (error[0] + noise[0]) +
                   K2 * (error[1] + noise[1]) +
                   K3 * (error[2] + noise[2]) +
                   K4 * (error[3] + noise[3]))

            # Apply disturbance if configured
            if self.disturbance_level > 0:
                u += self.disturbance_level * np.sin(2 * np.pi * 5 * i * self.dt)

            # Clip control to torque limits
            u = np.clip(u, -self.max_torque, self.max_torque)
            u_hist.append(u)

            # Compute state derivatives
            dX = self._dynamics(X, u)

            # Euler integration
            X = X + dX * self.dt

            # Store theta1 (output channel)
            theta1_hist.append(X[0])

            # Check failure conditions
            if (X[0] < self.theta_threshold or
                    X[0] > 2 * np.pi - self.theta_threshold):
                break

        # Trim theta1_hist to match time vector
        theta1_hist = np.array(theta1_hist[:-1])
        u_hist = np.array(u_hist)
        errors = np.array(errors)

        return theta1_hist, u_hist, errors

    def system_dynamics(self, X, u):
        """Wrapper for _dynamics to match interface expected by GA script

        Args:
            X: State vector [theta1, theta2, theta1_dot, theta2_dot]
            u: Control input (scalar or array)

        Returns:
            State derivatives
        """
        # Extract scalar control input
        u_scalar = u[0] if isinstance(u, (list, np.ndarray)) else u

        return self._dynamics(X, u_scalar)

    def plot_time_response(self, control_params, save_path=None, num_runs=100):
        """Plot Monte Carlo simulation results"""
        # Reconstruct scenario parameters
        scenario_params = {
            'initial_condition_range': self.initial_condition_range,
            'randomness_level': self.randomness_level,
            'disturbance_level': self.disturbance_level,
            'param_uncertainty': self.param_uncertainty
        }

        # Monte Carlo simulation
        all_theta1, all_control = [], []
        for _ in range(num_runs):
            system = DoublePendulum(scenario_params)
            theta1, control, _ = system.run_simulation(control_params)  # Now consistent!
            all_theta1.append(theta1)
            all_control.append(control)

        # Process trajectories
        max_len = max(len(t) for t in all_theta1)
        time_vector = np.arange(0, max_len * self.dt, self.dt)

        theta1_matrix = np.full((num_runs, max_len), np.nan)
        control_matrix = np.full((num_runs, max_len), np.nan)

        for i in range(num_runs):
            theta1_matrix[i, :len(all_theta1[i])] = all_theta1[i]
            control_matrix[i, :len(all_control[i])] = all_control[i]

        # Calculate statistics
        theta1_mean = np.degrees(np.nanmean(theta1_matrix, axis=0))
        theta1_std = np.degrees(np.nanstd(theta1_matrix, axis=0))
        control_mean = np.nanmean(control_matrix, axis=0)
        control_std = np.nanstd(control_matrix, axis=0)

        # Create plot
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)

        # Theta1 plot (output channel)
        ax1.plot(time_vector, theta1_mean, 'b-', lw=2, label='Mean Theta1')
        ax1.fill_between(time_vector, theta1_mean - theta1_std, theta1_mean + theta1_std,
                         color='blue', alpha=0.2, label='±1 SD')
        ax1.axhline(180, color='r', linestyle='--', alpha=0.7, label='Target')
        ax1.set_ylabel('Theta1 (deg)')
        ax1.grid(True, linestyle='--', alpha=0.7)
        ax1.legend(loc='best')
        ax1.set_title(f"Double Pendulum FSF Control ({num_runs} runs)")

        # Control signal plot
        ax2.plot(time_vector, control_mean, 'g-', lw=2, label='Mean Control')
        ax2.fill_between(time_vector, control_mean - control_std, control_mean + control_std,
                         color='green', alpha=0.2, label='±1 SD')
        ax2.set_xlabel('Time (s)')
        ax2.set_ylabel('Torque (Nm)')
        ax2.grid(True, linestyle='--', alpha=0.7)
        ax2.legend(loc='best')

        # Set gains in title
        if isinstance(control_params, dict):
            gains_str = ', '.join([f'K{i + 1}={control_params.get(f"K{i + 1}", 0):.2f}'
                                   for i in range(4)])
        else:
            gains_str = ', '.join([f'K{i + 1}={val:.2f}' for i, val in enumerate(control_params)])

        fig.suptitle(f'Gains: {gains_str}', fontsize=12)
        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        plt.show()


# Factory function to create systems
def create_system(system_name: str, scenario=None, custom_dynamics_path: Optional[str] = None,
                  file_type: str = "Python (.py)", matlab_func_name: Optional[str] = None,
                  num_states: Optional[int] = None, num_inputs: int = 1,
                  file_content: Optional[str] = None):
    """Factory function to create appropriate system"""
    if system_name == "custom" and (custom_dynamics_path or file_content is not None):
        if file_type == "MATLAB/Octave (.m)":
            if not OCTAVE_AVAILABLE:
                raise ImportError(
                    "oct2py is required for MATLAB/Octave (.m) dynamics. "
                    "Install it with: pip install oct2py  (and ensure GNU Octave is installed)."
                )
            if not matlab_func_name:
                raise ValueError("MATLAB function name required for .m files")

            # Auto-detect num_states if not provided
            if not num_states:
                oct = Oct2Py()
                try:
                    # Try to infer from the file, passing num_inputs for correct test_u
                    num_states = _detect_matlab_states(
                        oct,
                        custom_dynamics_path,
                        matlab_func_name,
                        num_inputs,
                        file_content=file_content,
                    )
                finally:
                    oct.exit()

            return OctaveSISOSystem(
                custom_dynamics_path,
                matlab_func_name,
                num_states,
                scenario,
                num_inputs,
                file_content=file_content,
            )
        else:
            return CustomDynamicalSystem(custom_dynamics_path, scenario, num_inputs, file_content)
    elif system_name == "inverted_pendulum":
        return InvertedPendulum(scenario)
    elif system_name == "dc_motor":
        return DCMotorPositionControl(scenario)
    elif system_name == "ball_beam":
        return BallBeam(scenario)
    elif system_name == "double_pendulum":
        return DoublePendulum(scenario)
    else:
        return DCMotorPositionControl(scenario)


def _detect_matlab_states(
        oct,
        matlab_file_path: Optional[str],
        func_name: str,
        num_inputs: int = 1,
        file_content: Optional[str] = None,
) -> int:
    """Auto-detect number of states from MATLAB function
    Attempts two strategies:
    1. Pattern matching on xdot = zeros(n, 1) declaration
    2. Octave execution with test vectors (1-10 states)
    """
    import shutil
    import tempfile
    import re
    # Setup temporary directory
    temp_dir = tempfile.mkdtemp()
    matlab_filename = f"{func_name}.m"
    temp_matlab_path = os.path.join(temp_dir, matlab_filename)

    try:
        if file_content is not None:
            content = file_content
        elif matlab_file_path:
            with open(matlab_file_path, 'r') as src:
                content = src.read()
        else:
            raise ValueError(
                "MATLAB/Octave dynamics require either file_content or a file path."
            )
        # ===== STRATEGY 1: Pattern Matching =====
        # Try to detect from xdot = zeros(n, 1) pattern
        pattern = r'xdot\s*=\s*zeros\s*\(\s*(\d+)'
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            return int(match.group(1))
        # ===== STRATEGY 2: Octave Execution =====
        with open(temp_matlab_path, 'w') as dst:
            dst.write(content)

        # Add to Octave path
        oct.addpath(temp_dir)

        # Try different state dimensions
        errors_encountered = []
        for n in range(1, 11):
            try:
                test_t = 0.0
                test_x = np.zeros((n, 1))
                test_u = np.zeros((num_inputs, 1))
                # Call the MATLAB function
                result = oct.feval(func_name, test_t, test_x, test_u, nout=1)
                result_array = np.array(result).flatten()

                if len(result_array) == n:
                    return n
            except Exception as e:
                errors_encountered.append((n, str(e)))
                continue
        # ===== FALLBACK =====
        raise ValueError(
            f"Could not auto-detect number of states from MATLAB function. "
            f"Errors encountered during Octave execution."
        )
    finally:
        # Cleanup
        try:
            oct.rmpath(temp_dir)
        except:
            pass
        shutil.rmtree(temp_dir, ignore_errors=True)