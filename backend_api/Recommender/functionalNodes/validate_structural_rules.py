import json
import re
from typing import Dict, Any, Tuple, List


# from backend_api.Recommender.states import OverallState

def check_bounds(var_str: str, num_inputs: int, num_states: int) -> Tuple[bool, str]:
    """Helper function to validate format and bounds."""
    match = re.match(r"^(U|X|X_sp)\[(\d+)\]$", var_str)
    if not match:
        return False, f"Invalid format '{var_str}' (expected U[m], X[n], or X_sp[n])."

    var_type, idx_str = match.groups()
    idx = int(idx_str)

    if var_type == "U" and idx >= num_inputs:
        return False, f"Input index '{var_str}' must be < total system inputs ({num_inputs})."
    if var_type in ("X", "X_sp") and idx >= num_states:
        return False, f"State index '{var_str}' must be < total system states ({num_states})."

    return True, ""


def check_rule_1_siso_and_bounds(controller_data: Dict[str, Any], system_data: Dict[str, Any]) -> Tuple[
    bool, str, List[str], List[str], List[str]]:
    """Validates Rule 1: SISO Check & Variable Index Bounds."""
    feedback = []
    all_controlled_vars = []
    all_output_vars = []
    passed = True

    try:
        num_inputs = int(system_data.get("system_properties", {}).get("n_inputs", 0))
        num_states = int(system_data.get("system_properties", {}).get("n_states", 0))
    except (KeyError, AttributeError):
        num_inputs, num_states = 0, 0

    loops = controller_data.get("pid_loops", [])

    for loop in loops:
        loop_num = loop.get("loop_number")
        for i, controller in enumerate(loop.get("controllers", [])):

            controlled_var = controller.get("controlled_variable_in_equation")
            output_var = controller.get("output_variable_in_equation")

            if not controlled_var or not isinstance(controlled_var, str):
                passed = False
                feedback.append(f"Loop {loop_num}, Controller {i+1}: Missing 'controlled_variable_in_equation'.")
            else:
                valid, err_msg = check_bounds(controlled_var, num_inputs, num_states)
                if not valid:
                    passed = False
                    feedback.append(f"Loop {loop_num}, Controller {i+1}: {err_msg}")
                all_controlled_vars.append(controlled_var)

            if not output_var or not isinstance(output_var, str):
                passed = False
                feedback.append(f"Loop {loop_num}, Controller {i+1}: Missing 'output_variable_in_equation'.")
            else:
                valid, err_msg = check_bounds(output_var, num_inputs, num_states)
                if not valid:
                    passed = False
                    feedback.append(f"Loop {loop_num}, Controller {i+1}: {err_msg}")
                all_output_vars.append(output_var)

    if passed:
        audit_log = "SISO Check: Pass - All controllers have exactly one valid controlled/output variable within system bounds."
    else:
        audit_log = "SISO Check: Fail - Controllers must have valid variable formatting that stays within system limits."

    return passed, audit_log, feedback, all_controlled_vars, all_output_vars


def check_rule_2_uniqueness(all_controlled_vars: List[str], all_output_vars: List[str]) -> Tuple[bool, str, List[str]]:
    """Validates Rule 2: Uniqueness."""
    feedback = []
    passed = True

    duplicates_controlled = set([x for x in all_controlled_vars if all_controlled_vars.count(x) > 1])
    duplicates_output = set([x for x in all_output_vars if all_output_vars.count(x) > 1])

    if duplicates_controlled:
        passed = False
        feedback.append(f"Duplicate controlled variables found: {', '.join(duplicates_controlled)}.")

    if duplicates_output:
        passed = False
        feedback.append(f"Duplicate output variables found: {', '.join(duplicates_output)}.")

    if passed:
        audit_log = "Uniqueness: Pass - No duplicate controlled or output variables across controllers."
    else:
        audit_log = "Uniqueness: Fail - Conflicting variable assignments detected."

    return passed, audit_log, feedback


def check_pre_hierarchy_numbering(controller_data: Dict[str, Any]) -> Tuple[bool, str, List[str]]:
    """
    Validates PID loop block numbering scheme.
    Enforces uniqueness, contiguous sequencing, and JSON ordering.
    """
    feedback = []
    passed = True

    loops = controller_data.get("pid_loops", [])
    if not loops:
        return False, "Loop Numbering: Fail", ["No 'pid_loops' array found in the configuration."]

    loop_numbers = []

    # Extract and type-check
    for i, loop in enumerate(loops):
        l_num = loop.get("loop_number")
        if not isinstance(l_num, int):
            passed = False
            feedback.append(f"Block at index {i} has an invalid or missing 'loop_number'. Must be an integer.")
            continue
        loop_numbers.append(l_num)

    if not passed:
        return passed, "Loop Numbering: Fail - Type errors detected.", feedback

    # Algorithm 1: Uniqueness
    if len(set(loop_numbers)) != len(loop_numbers):
        passed = False
        duplicates = set([str(x) for x in loop_numbers if loop_numbers.count(x) > 1])
        feedback.append(
            f"Uniqueness error: Duplicate loop numbers found: {', '.join(duplicates)}. Each block must have a distinct loop_number.")

    # Algorithm 2: Contiguous Sequence (No gaps)
    if passed:
        sorted_nums = sorted(loop_numbers)
        # Create an ideal sequence starting from the minimum loop number found
        expected_nums = list(range(sorted_nums[0], sorted_nums[0] + len(sorted_nums)))

        if sorted_nums != expected_nums:
            passed = False
            feedback.append(
                f"Sequence error: Loop numbers contain gaps. "
                f"Found {sorted_nums}, but expected a continuous sequence like {expected_nums}."
            )

    if passed:
        audit_log = "Loop Numbering: Pass - All loop numbers are unique, contiguous, and correctly ordered."
    else:
        audit_log = "Loop Numbering: Fail - Numbering scheme violates structural requirements."

    return passed, audit_log, feedback


def check_rule_3_hierarchy(controller_data: Dict[str, Any]) -> Tuple[bool, str, List[str]]:
    """
    Validates Rule 3: Hierarchy.
    A controller must only reference (provide a setpoint to) a controller
    that exists in a lower PID loop number.
    """
    feedback = []
    passed = True

    controllers = []
    loops = controller_data.get("pid_loops", [])

    # Flatten controllers to easily map connections and retain indices for exact error reporting
    for loop in loops:
        loop_num = loop.get("loop_number")
        for i, c in enumerate(loop.get("controllers", [])):
            controllers.append({
                "loop_num": loop_num,
                "controller_index": i,
                "output": c.get("output_variable_in_equation", ""),
                "setpoint": c.get("setpoint_variable_in_equation", "")
            })

    # Evaluate references: Controller A's output becomes Controller B's setpoint
    for c_source in controllers:
        source_output = c_source["output"]

        # Plant actuators (e.g., U[0]) are physical endpoints, not other controllers
        if source_output.startswith("U["):
            continue

        # Find any controller that uses this output as its setpoint
        referenced_controllers = [c for c in controllers if c["setpoint"] == source_output]

        for c_target in referenced_controllers:
            # The receiving controller MUST be in a strictly lower loop number
            if c_target["loop_num"] >= c_source["loop_num"]:
                passed = False
                feedback.append(
                    f"Hierarchy error: Controller in Loop {c_source['loop_num']} (Index {c_source['controller_index']}) "
                    f"outputs to '{source_output}', which is referenced as a setpoint by a controller in Loop {c_target['loop_num']} "
                    f"(Index {c_target['controller_index']}). "
                    f"Controllers must only reference controllers in a strictly lower loop number."
                )

    if passed:
        audit_log = "Hierarchy: Pass - All controller references strictly target lower PID loop numbers."
    else:
        audit_log = "Hierarchy: Fail - Controllers violate the strictly lower loop number reference rule."

    return passed, audit_log, feedback


def validate_structural_rules(controller_data: Dict[str, Any], system_data: Dict[str, Any]) -> Tuple[
    bool, List[str], str]:
    """
    Executes structural rules sequentially.
    Breaks the process and returns immediately if any rule fails.
    """
    audit_logs = []

    # --- Step 1: SISO and Bounds ---
    r1_passed, r1_log, r1_feedback, all_controlled, all_output = check_rule_1_siso_and_bounds(controller_data,
                                                                                              system_data)
    audit_logs.append(r1_log)

    if not r1_passed:
        return False, audit_logs, " ".join(r1_feedback)

    # --- Step 2: Uniqueness ---
    r2_passed, r2_log, r2_feedback = check_rule_2_uniqueness(all_controlled, all_output)
    audit_logs.append(r2_log)

    if not r2_passed:
        return False, audit_logs, " ".join(r2_feedback)

    # --- Step 3: Loop Numbering Validation (New Pre-Hierarchy Check) ---
    num_passed, num_log, num_feedback = check_pre_hierarchy_numbering(controller_data)
    audit_logs.append(num_log)

    if not num_passed:
        # Break immediately if the block numbering sequence or order is broken
        return False, audit_logs, " ".join(num_feedback)

    # --- Step 4: Hierarchy (Cascaded Loop Reference Check) ---
    r3_passed, r3_log, r3_feedback = check_rule_3_hierarchy(controller_data)
    audit_logs.append(r3_log)

    if not r3_passed:
        return False, audit_logs, " ".join(r3_feedback)

    # If the code execution reaches this point, all structural rules have passed
    final_feedback = "None required for Rules 1, 2, and 3."
    return True, audit_logs, final_feedback


def apply_system_names(controller_json_str: str, system_json_str: str) -> str:
    """
    Parses the finalized controller JSON and replaces 'controlled_variable' and 'output_signal'
    based on the 'variable_name' mappings found in the system_identification JSON.
    """
    controller_data = json.loads(controller_json_str)
    system_data = json.loads(system_json_str)

    # 1. Build a lookup dictionary from the system_identification data
    var_mapping = {}
    for category in ["state_variables", "inputs"]:
        for item in system_data.get(category, []):
            if "variable_in_equation" in item and "variable_name" in item:
                var_mapping[item["variable_in_equation"]] = item["variable_name"]

    # 2. Iterate through the controller structure and update the names
    for loop in controller_data.get("pid_loops", []):
        for ctrl in loop.get("controllers", []):
            cv_eq = ctrl.get("controlled_variable_in_equation", "")
            out_eq = ctrl.get("output_variable_in_equation", "")

            # Strip "_sp" to find the base state variable in the system mapping map
            cv_eq_base = cv_eq.replace("_sp", "")
            out_eq_base = out_eq.replace("_sp", "")

            # Update controlled_variable
            if cv_eq_base in var_mapping:
                # If it was a setpoint, you could append "_setpoint", but usually
                # the controlled variable is the base state (e.g., X[1] -> q)
                ctrl["controlled_variable"] = var_mapping[cv_eq_base]

            # Update output_signal
            if out_eq_base in var_mapping:
                if "_sp" in out_eq:
                    # e.g., X_sp[1] maps to "q_setpoint"
                    ctrl["output_signal"] = var_mapping[out_eq_base] + "_setpoint"
                else:
                    # e.g., U[0] maps to "delta_e"
                    ctrl["output_signal"] = var_mapping[out_eq_base]

    return json.dumps(controller_data, indent=2)


# # --- Execution Example ---
# if __name__ == "__main__":
#     system = "quadcopter"
#
#     with open(f'inputs/{system}/controller.json', 'r') as file:
#         controller_json = json.load(file)
#
#     with open(f'inputs/{system}/system_identification.json', 'r') as file:
#         system_json = json.load(file)
#
#     result = structural_supervisor_node(controller_json, system_json)
#     import pprint
#     pprint.pprint(result)