import json
import re


def standardize_system_variables(sys_id_json_str: str) -> str:
    """
    Parses the system_analyser JSON output and strictly formats
    state and input variable identifiers to X[n] and U[n].
    """
    try:
        data = json.loads(sys_id_json_str)
    except json.JSONDecodeError:
        return sys_id_json_str  # Return raw string if JSON parsing fails

    def fix_format(value: str, target_letter: str) -> str:
        """
        Regex breakdown:
        (?i)         : Case-insensitive (matches 'x' or 'X', 'u' or 'U')
        ^            : Start of string
        [_\(\[\s]*   : Matches any optional decorators like _, (, [, or spaces
        (\d+)        : Captures the integer 'n'
        [_\)\]\s]*   : Matches any optional trailing decorators like _, ), ], or spaces
        $            : End of string
        """
        if not isinstance(value, str):
            return value

        pattern = rf"(?i)^{target_letter}[_\(\[\s]*(\d+)[_\)\]\s]*$"
        match = re.match(pattern, value.strip())

        if match:
            # Reconstruct the string strictly as Letter[n]
            return f"{target_letter.upper()}[{match.group(1)}]"
        return value

    # Fix State Variables (Targeting 'X')
    if "state_variables" in data:
        for state in data["state_variables"]:
            if "variable_in_equation" in state:
                state["variable_in_equation"] = fix_format(state["variable_in_equation"], "X")

            # Optional: Catch malformed variable_names if they accidentally hold the equation identifier
            if "variable_name" in state:
                state["variable_name"] = fix_format(state["variable_name"], "X")

    # Fix Inputs (Targeting 'U')
    if "inputs" in data:
        for inp in data["inputs"]:
            if "variable_in_equation" in inp:
                inp["variable_in_equation"] = fix_format(inp["variable_in_equation"], "U")

            # In your standard format, input variable_names (e.g., "U1") also need adjustment
            if "variable_name" in inp:
                inp["variable_name"] = fix_format(inp["variable_name"], "U")

    return json.dumps(data, indent=4)