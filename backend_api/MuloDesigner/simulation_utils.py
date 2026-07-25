from numpy import *
import re

def generate_reference(t: float, signal_type: str, amplitude: float = 1, freq_hz: float = 0.5) -> float:
    """Generates standard control system test signals."""
    if signal_type == "Step":
        return amplitude if t >= 1.0 else 0.0  # Step occurs at t=1s
    elif signal_type == "Ramp":
        return amplitude * (t - 1.0) if t >= 1.0 else 0.0
    elif signal_type == "Sine":
        return amplitude * sin(2 * pi * freq_hz * t) if t >= 0 else 0.0
    return 0.0


def simulate_system_response(equation_str: str, case_study: dict, input_channel_name: str ,signal_type: str, amplitude: float = 1.0):
    """
    Executes the dynamically generated system equations and simulates the time response.
    """
    # 1. Prepare a single execution environment dictionary
    pattern = r'system_dynamics_controller_(\d+)'
    matches = re.findall(pattern, equation_str)

    if matches:
        latest_idx = max([int(m) for m in matches])
        working_function = f'system_dynamics_controller_{latest_idx}'
    else:
        working_function = 'system_dynamics'
        # 1. Prepare a single execution environment dictionary

    def dynamics(t, x, u, setpoints):
        return array([0, 0])

    exec_globals = {}
    exec(equation_str, exec_globals)
    if working_function in exec_globals:
        dynamics = exec_globals[working_function]

    # 3. Setup Simulation Constraints
    dt = float(case_study.get("simulation_params", {}).get("dt", 0.001))
    max_time = float(case_study.get("simulation_params", {}).get("max_time", 20.0))
    t_eval = arange(0.0, max_time, dt)

    X_trim = case_study.get("trim_ics", [])
    X_trim = array([float(i) for i in X_trim])
    U_trim = case_study.get("trim_values", [])
    U_trim = array([float(i) for i in U_trim])

    trajectory = []
    ref_signal = []
    cont_command = []
    x = X_trim.copy()

    for i, t in enumerate(t_eval):
        ref_value = float(generate_reference(t, signal_type, amplitude))
        setpoints = {input_channel_name: ref_value}
        dx = dynamics(t, x, U_trim, setpoints)
        # print(dx)
        x = x + dx*dt
        trajectory.append(x)
        ref_signal.append(ref_value)

    return t_eval, array(trajectory), array(ref_signal)


if __name__ == "__main__":
    import matplotlib.pyplot as plt

    code = """
from numpy import *

def system_dynamics(t, x, u):
    # =========================================================================
    # UNIVERSAL PLANT MODEL
    # Target: Python solve_ivp / State-Space
    #
    # Structure:
    # x = [state1, state2, ..., stateN]
    # u = [input1, input2, ..., inputM]
    # =========================================================================
    ## 1. PARAMETERS (Hard-coded constants)
    # [LLM: Define all coefficients, mass, inertia, or gains here]
    # [PARAM_START]
    m = 1000  # mass[kg]
    Iy = 3000  # pitch moment of inertia[kg*m**2]
    S = 16  # wing area[m**2]
    c = 1.5  # mean aerodynamic chord[m]
    rho = 1.225  # air density[kg/m**3]
    V = 50  # airspeed[m/s]
    CL_alpha = 4.5
    CM_alpha = -0.8
    CM_q = -15
    CM_delta = -1.2
    g = 9.81  # gravity[m/s^2]
    # [PARAM_END]

    ## 2. UNPACK STATES & INPUTS
    # [LLM: Mapping for readability]
    # [UNPACK_START]
    theta = x[0]  # pitch angle
    q = x[1]  # pitch rate
    w = x[2]  # vertical velocity
    delta_e = u[0]  # elevator deflection
    # [UNPACK_END]

    ## 3. DYNAMICS / EQUATIONS OF MOTION
    # [LLM: Implement the differential equations]
    # [EOM_START]
    alpha = arctan(w / V)  # angle of attack
    Q = 0.5 * rho * V**2  # dynamic pressure
    L = Q * S * CL_alpha * alpha
    M = Q * S * c * (CM_alpha * alpha + CM_q * q * c / (2*V) + CM_delta * delta_e)
    theta_dot = q
    q_dot = M / Iy
    w_dot = (L * cos(theta) - m * g * sin(theta)) / m - V * q
    # [EOM_END]

    ## 4. DERIVATIVE VECTOR CONSTRUCTION
    # [LLM: Must be a vector/array matching the state order]
    # [DERIVATIVE_START]
    dxdt = array([theta_dot, q_dot, w_dot])
    # [DERIVATIVE_END]
    return dxdt
    

class PIDController:
        def __init__(self, kp, ki, kd, dt, output_limits=(None, None)):
            self.kp = kp
            self.ki = ki
            self.kd = kd
            self.dt = dt
            self.limits = output_limits
            
            self.integral = 0.0
            self.prev_error = 0.0
    
        def update(self, setpoint, measurement):
            error = setpoint - measurement
            
            # Proportional term
            p_term = self.kp * error
            
            # Integral term
            self.integral += error * self.dt
            i_term = self.ki * self.integral
            
            # Derivative term (on measurement to avoid derivative kick)
            d_term = self.kd * (error - self.prev_error) / self.dt if self.dt > 0 else 0.0
            self.prev_error = error
            
            output = p_term + i_term + d_term
            # print(output)
            
            # Apply saturation limits if defined
            low, high = self.limits
            if low is not None or high is not None:
                output = clip(output, low, high)
            return output
        

X1PID = PIDController(10.28, 3.18, 0.37, 0.001, output_limits=(-0.5, 0.5))


def system_dynamics_controller_1(t, X, U, setpoints):
        U[0] = X1PID.update(setpoints["X[1]"], X[1])
        return system_dynamics(t, X, U)
    """

    case_study = {
        "dt": 0.001,
        "max_time": 20.0,
        "input_name": "X[1]",
        "trim_values": [0.0],
        "trim_ics": [0.0, 0.0, 0.0]
    }

    # Run the simulation
    t, sol, ref = simulate_system_response(code, case_study, "X[1]", "Sine")
    print(sol[:, 1])

    # 2. Plot the results
    plt.figure(figsize=(10, 6))

    # sol is an array where each column is a state: [theta, q, w]
    # plt.plot(t, sol[:, 0], label='theta (pitch angle)')
    plt.plot(t, sol[:, 1], label='q (pitch rate)')
    # plt.plot(t, sol[:, 2], label='w (vertical velocity)')

    # Add labels and formatting
    plt.xlabel('Time (s)')
    plt.ylabel('State Values')
    plt.title('System Response to Sine Input')
    plt.legend()
    plt.grid(True)
    plt.show()

