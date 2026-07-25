import json
import re
import os
import numpy as np
from typing import Any, Dict, List

from backend_api.MuloDesigner.GaAgent.ga_handler_agent import run_ga_handler
from backend_api.MuloDesigner.GaAgent.src.utils import coerce_metric_targets, coerce_simulation_params
from backend_api.MuloDesigner.agents import Agents


class MuloControllerDesigner:

    def __init__(self, run_config: Dict[str, Any], controller_structure: List[Any],
                 system_identification: Dict[str, Any], trimming_result: Dict[str, Any], equation: str):
        self.run_config = run_config
        self.equation = equation
        self.case_study = self.generate_case_study(system_identification, trimming_result)
        self.controller_structure = self.add_constraint_to_controller(controller_structure, trimming_result)
        self.controller_index = 0
        self.controller_designed = False
        self.final_state = {}


    def design_controller(self):
        i = self.controller_index
        if i >= len(self.controller_structure):
            return None, None

        self.controller_structure[i]["controllers"] = self.design_controller_in_block(self.controller_structure[i])
        self.add_controller_to_equation(self.controller_structure[i]["controllers"])
        # print(controllers[i])
        # print(100 * "_")
        # print(self.equation)
        self.controller_index += 1
        self.controller_designed = True

        return self.final_state

    def add_controller_to_equation(self, controllers):
        pid_controller = """
\n\nclass PIDController:
    def __init__(self, kp, ki, kd, dt, output_limits=(None, None)):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.dt = dt
        self.limits = output_limits

        self.integral = 0.0
        self.prev_error = 0.0

    def update(self, setpoint, measurement):
        error =  setpoint - measurement 

        # Compute P and D terms normally
        p_term = self.kp * error
        d_term = self.kd * (error - self.prev_error) / self.dt if self.dt > 0 else 0.0        
        self.prev_error = error
        
        # Compute unsaturated output using existing integral state
        u_unsaturated = p_term + (self.ki * self.integral) + d_term
        
        # 3. Apply saturation limits
        low, high = self.limits
        output = u_unsaturated
        if low is not None or high is not None:
            output = clip(u_unsaturated, low, high)
            
        # Clamping Logic: Only integrate if not saturated,
        saturated = (output != u_unsaturated)
        
        # Check if error and saturated output have the same sign
        same_sign = (error * u_unsaturated) > 0
        
        if not (saturated and same_sign):
            self.integral += error * self.dt

        return output
"""

        if "class PIDController" not in self.equation:
            self.equation += pid_controller

        pattern = r'system_dynamics_controller_(\d+)'
        match = re.findall(pattern, self.equation)
        if match:
            match = [int(i) for i in match]
            new_controller = 'system_dynamics_controller_' + str(max(match) + 1)
            last_controller = 'system_dynamics_controller_' + str(max(match))
        else:
            new_controller = 'system_dynamics_controller_1'
            last_controller = 'system_dynamics'

        for cont in controllers:
            controller_name = f'{cont["controlled_variable_in_equation"].replace("[", "").replace("]", "")}PID'
            dt = self.case_study["simulation_params"]["dt"]
            minB = cont['controller_output']['min_bound']
            maxB = cont['controller_output']['max_bound']
            bounds = f', output_limits=({minB}, {maxB})' if minB and maxB else ''
            self.equation += f'\n\n{controller_name} = PIDController({cont["kp"]}, {cont["ki"]}, {cont["kd"]}, {dt}{bounds})'
            cont["name"] = controller_name

        controller_equation = f'\ndef {new_controller}(t, X, U, setpoints):'

        for cont in controllers:
            name = cont["name"]
            inp = cont["controlled_variable_in_equation"]
            out = cont['output_variable_in_equation']
            out = out if 'U' in out else f'setpoints["{out}"]'
            controller_equation += f'\n    {out} = {name}.update(setpoints["{inp}"], {inp})'  # Swapped \t with 4 spaces
        sp_expr = "" if last_controller == "system_dynamics" else ", setpoints"
        controller_equation += f'\n    return {last_controller}(t, X, U{sp_expr})'  # Swapped \t with 4 spaces
        self.equation += f'\n\n{controller_equation}'


    def controller_tuner_rand(self) -> tuple[float, float, float]:
        rng = np.random.default_rng(seed=self.run_config["seed"])
        kp = round(rng.uniform(1.5, 10.5), 2)
        ki = round(rng.uniform(1.5, 10.5), 2)
        kd = round(rng.uniform(1.5, 10.5), 2)
        return kp, ki, kd


    def design_controller_in_block(self, pid_loop):
        self.case_study["fixed_targets"] = coerce_metric_targets(pid_loop.get('metrics'))
        sim_params = coerce_simulation_params(self.case_study.get("simulation_params"))
        self.case_study["simulation_params"] = sim_params
        # self.case_study["simulation_params"]["max_time"] = pid_loop["simulation_params"]['max_time']
        controllers = pid_loop["controllers"]

        pattern = r'system_dynamics_controller_(\d+)'
        match = re.findall(pattern, self.equation)

        if match:
            match = [int(i) for i in match]
            working_function =  'system_dynamics_controller_' + str(max(match))
        else:
            working_function = 'system_dynamics'

        for i, cont in enumerate(controllers):
            self.update_case_study(cont, working_function)

            kp, ki, kd = self.controller_tuner()

            controllers[i]["kp"] = kp
            controllers[i]["ki"] = ki
            controllers[i]["kd"] = kd

        return controllers


    def controller_tuner(self) -> tuple[float, float, float]:
        # import pprint
        # pprint.pprint(self.controller_structure)

        final_state = run_ga_handler(
            case_study_file=self.run_config["case_study_file"],
            tuning_specs=None,          # use case-study defaults
            llm_model=self.run_config["llm_model"],
            seed=42,
            run_id=1,
            max_attempts=self.run_config["max_attempts"],
            max_wall_clock=self.run_config["max_wall_clock"],
            max_cost_budget=self.run_config["max_cost_budget"],
            prompt_variant=self.run_config["prompt_variant"],
            buffer_size=self.run_config["buffer_size"],
            control_objective=self.run_config.get("control_objective"),
            case_study=self.case_study,
        )
        # import pprint
        # pprint.pprint(final_state)
        kp = round(float(final_state["best_result"]["controller_parameters"]["Kp"]), 2)
        ki = round(float(final_state["best_result"]["controller_parameters"]["Ki"]), 2)
        kd = round(float(final_state["best_result"]["controller_parameters"]["Kd"]), 2)

        self.final_state = final_state

        return kp, ki, kd
        # if self.controller_index % 2 == 0:
        #     return kp, ki, kd
        # return -kp, -ki, -kd



    def generate_case_study(self, system_identification:Dict[str, Any],
                            trimming_result:Dict[str, Any]) -> Dict[str, Any]:
        case_study = {
            "system_name": system_identification["system_name"],
            "python_code": self.equation,
            "system_description": system_identification["description"],
            "control_objective": "Design a controller to regulate pitch attitude (theta) to a desired setpoint with minimal settling time, overshoot, and steady-state error",
            "target": None,
            "num_inputs": trimming_result["system"]["n_inputs"],
            "trim_values": trimming_result["equilibrium"]["u_e"],
            "trim_ics": trimming_result["equilibrium"]["x_e"],
            "input_channel": None,
            "output_channel": None,
            "num_states": trimming_result["system"]["n_states"],
            "min_ctrl": None,
            "max_ctrl": None,
            "fixed_targets": {
                "mse": 0.001,
                "settling_time": 7.0,
                "overshoot": 10.0,
                "control_effort": 0.25
            },
            "simulation_params": {
                "dt": 0.001,
                "max_time": 50.0
            }
        }

        return case_study


    def update_case_study(self, cont:Dict[str, Any], working_function:str) -> None:
        output_channel = cont['controlled_variable_in_equation']
        input_channel = cont['output_variable_in_equation']
        target = self.generate_target(cont)

        self.case_study["output_channel"] = self.get_index(output_channel)
        self.case_study["input_channel"] = self.get_index(input_channel)
        self.case_study["input_name"] = input_channel
        self.case_study["min_ctrl"] = float(cont['controller_output']['min_bound'])
        self.case_study["max_ctrl"] = float(cont['controller_output']['max_bound'])
        self.case_study["target"] = target

        self.case_study['python_code'] = self.equation
        self.case_study['working_function'] = working_function


    def generate_target(self, cont):
        min_target = float(cont['target']['min_value'])
        max_target = float(cont['target']['max_value'])

        target = 0.0
        rng = np.random.default_rng(seed=self.run_config["seed"])
        while target == 0.0:
            target = round(rng.uniform(min_target, max_target), 3)
        print("target")
        print(target)
        target = 0.1
        return target


    @staticmethod
    def get_index(signal_str):
        match = re.search(r'([A-Za-z_]+)[\(\[](\d+)[\)\]]', signal_str)
        return int(match.group(2))


    def add_constraint_to_controller(self, cont:List[Any],  trimming_result:Dict[str, Any])\
            -> List[Any]:
        if __name__ == "__main__":
            agents = Agents(model_name=self.run_config["llm_model"])
        else:
            agents = Agents(model_name=self.run_config["llm_model"], prompt_dir="backend_api/MuloDesigner/templates")

        if self.run_config["web_search_model"] is not None:
            response = agents.constraint_estimator_web(cont, trimming_result, self.run_config["web_search_model"])
        else:
            response = agents.constraint_estimator(cont, trimming_result)

        new_controller = json.loads(response.replace("'''json", "").replace("'''", ""))
        new_controller = sorted(new_controller["pid_loops"], key=lambda x: x['loop_number'])

        for i, pid_loop in enumerate(new_controller):
            for j, cont in enumerate(pid_loop["controllers"]):
                new_value = self.get_state_name(new_controller[i]["controllers"][j]["output_variable_in_equation"])
                new_controller[i]["controllers"][j]["output_variable_in_equation"] = new_value

        import pprint
        pprint.pprint(new_controller)

        return new_controller


    @staticmethod
    def get_state_name(signal_str):
        # Robustly check for X_sp and convert safely using regex
        if signal_str.startswith("X_sp"):
            match = re.search(r'\d+', signal_str)
            if match:
                n = int(match.group())
                return f'X[{n}]'  # Keep original convention format; to_zero_based down the line handles it cleanly
        return signal_str


    def get_controller_structure(self):
        return self.controller_structure

    def set_controller_structure(self, controller_structure:Dict[str, Any]) -> None:
        self.controller_structure = controller_structure

    def get_case_study(self):
        return self.case_study

    def set_case_study(self, case_study:Dict[str, Any]) -> None:
        self.case_study = case_study


def load_file(file_name):
    file_path = os.path.join(os.getcwd(), file_name)
    if os.path.exists(file_path):
        with open(file_path, 'r') as file:
            file_content = file.read()
        return file_content
    else:
        raise FileNotFoundError(f"The file {file_name} does not exist in the current directory.")


if __name__ == "__main__":
    controller = load_file("inputs/aircraft.json")
    trimming = load_file("inputs/aircraft_trim.json")
    trimming = json.loads(trimming)
    pyEquation = load_file("inputs/aircraft_equation.py")
    # controller = batch_controllers(controller, trimming)
    system = load_file("inputs/aircraft_system_identification.json")
    system = json.loads(system)

    config = {
        'case_study_file' : '',
        'tuning_specs' : None,  # use case-study defaults
        'llm_model' : 'openai/gpt-oss-120b',
        'web_search_model': None,
        'seed' : 42,
        'run_id' : 1,
        'max_attempts' : 5,
        'max_wall_clock' : 120.0,
        'max_cost_budget' : 1.0,
        'prompt_variant' : "elaborate",
        'buffer_size' : 3,
        'control_objective' : 'Design a controller to regulate pitch attitude (theta) to a desired setpoint with minimal settling time, overshoot',
    }

    import pprint
    # pprint.pprint(equation)
    controller = json.loads(controller)
    pprint.pprint(controller)
    designer = MuloControllerDesigner(config, controller, system, trimming, pyEquation)
    controller, equation =designer.design_controller()
    pprint.pprint(equation)
