from dotenv import load_dotenv
import os
import re
import pprint
import json


from backend_api.Regularizer.MatlabToPython.matlab_to_numpy import matlab_to_numpy
from backend_api.Regularizer.syntax_error_check import analyze_static_eom
from backend_api.Regularizer.agents import Agents


def fix_code(code, model="meta/llama-4-maverick-17b-128e-instruct", file_type="python"):
    load_dotenv()
    change_applied = False

    if file_type == "matlab":
        code = matlab_to_numpy(code)
        change_applied = True
        # After conversion the content is Python; treat it as such for all subsequent steps.
        file_type = "python"

    results = {"status": "FAIL"}
    fixed_code = code
    agents = Agents(model_name=model)

    # Track ONLY the immediate previous error messages
    previous_error_messages = set()
    previous_changes = []
    max_tries = 3
    tries = 0
    human_intervention = False

    while results["status"] == "FAIL":
        if tries > max_tries:
            if human_intervention:
                break
            print("FIX WHOLE CODE")
            fixed_code = agents.fix_whole_code(fixed_code)
            # Reset tries after running the macro critic to allow normal patching again
            tries = 0
            human_intervention = True

        # Fixing indentation
        if file_type != "matlab":
            fixed_code = _fix_indent(fixed_code)
        results = analyze_static_eom(fixed_code)

        if results["status"] == "FAIL":
            change_applied = True
            static_errors = _remove_unrelated_errors(results["static_errors"])
            syntax_errors = _remove_unrelated_errors(results["syntax_errors"])

            if len(syntax_errors) == 0 and len(static_errors) == 0:
                break

            print(20 * "_" + "SYNTAX ERRORS" + 20 * "_")
            pprint.pprint(syntax_errors)

            print(20 * "_" + "STATIC ERRORS" + 20 * "_")
            pprint.pprint(static_errors)

            # Combine errors and extract ONLY their 'Message' keys
            current_errors = syntax_errors + static_errors
            current_error_messages = {err.get("Message") for err in current_errors if err.get("Message")}

            # Check if there is any intersection between current error messages and previous ones
            has_repeated_error = bool(current_error_messages & previous_error_messages)

            if has_repeated_error:
                tries += 1
            else:
                tries = 0

            # Pass the previous changes ONLY if an error message repeated
            history_to_pass = previous_changes if has_repeated_error else []

            if len(syntax_errors) > 0 or len(static_errors) > 0:
                fixed_code, new_changes = _fix_syntax_and_static_errors(
                    fixed_code, static_errors, syntax_errors, agents, history_to_pass
                )

                # Update trackers for the next iteration using the message strings
                previous_error_messages = current_error_messages
                previous_changes = new_changes

    return fixed_code, change_applied, human_intervention


def _fix_syntax_and_static_errors(code, static_errors, syntax_errors, agents, history_to_pass):
    # --- PRE-PROCESS INDENTATION ERRORS ---
    lines = code.split('\n')
    if len(syntax_errors) == 0 and len(static_errors) == 0:
        return code, []

    # 1. Capture original indentation for LLM context
    line_indentations = ["".join(l.split(l.strip())[:-1]) if l.strip() else "" for l in lines]

    # 2. Format conditional history and pass to LLM
    history_str = json.dumps(history_to_pass, indent=2) if history_to_pass else "None"
    response = agents.fix_syntax_error(static_errors, syntax_errors, history_str)

    changes = response.get("changes", [])

    print(20 * "_" + "CHANGES" + 20 * "_")
    pprint.pprint(changes)

    # 3. Apply "change" flags
    for change in changes:
        if change.get("flag") == "change":
            line_idx = change.get("line") - 1
            if 0 <= line_idx < len(lines):
                print(change.get("code_line"))
                raw_code = _ensure_balanced_quotes(change.get("code_line"))

                # Trust the LLM if it provided explicit indentation
                if raw_code.startswith(" ") or raw_code.startswith("\t"):
                    lines[line_idx] = raw_code.rstrip()
                else:
                    indent = line_indentations[line_idx]
                    lines[line_idx] = indent + raw_code.strip()

    # 4. Apply "add" flags (FORWARD order with offset to preserve new context)
    additions = [c for c in changes if c.get("flag") == "add"]
    additions.sort(key=lambda x: x.get("line"))

    offset = 0
    for add in additions:
        target_line = add.get("line") + offset
        raw_code = _ensure_balanced_quotes(add.get("code_line"))

        # Trust the LLM if it explicitly provided indentation
        if raw_code.startswith(" ") or raw_code.startswith("\t"):
            new_line = raw_code.rstrip()
        else:
            if target_line >= len(lines):
                target_line = len(lines) - 1

            # Smart Indentation: Determine spacing dynamically based on the parent line

            prev_line = lines[target_line - 1] if target_line > 0 else ""
            base_indent = len(prev_line) - len(prev_line.lstrip())
            indent_str = " " * base_indent

            # If the previous line opened a new block, drop in 4 spaces deeper
            if prev_line.strip().endswith(":"):
                indent_str += "    "

            # Special case: these keywords should align with their parent block, not the block body
            if raw_code.strip().startswith(("except", "elif", "else", "finally")):
                indent_str = indent_str[:-4] if len(indent_str) >= 4 else ""

            new_line = indent_str + raw_code.strip()

        lines.insert(target_line, new_line)
        offset += 1  # Shift all future insertions down by 1 to maintain accuracy

    # Return both the stitched code and the changes list for the history tracker
    return "\n".join(lines), changes


def _remove_unrelated_errors(errors):
    unhandled_syntax_errors = []

    for err in errors:
        msg = err.get("Message", "").lower()

        if "expected an indented block" not in msg and "unexpected indent" not in msg:
            unhandled_syntax_errors.append(err)

    return unhandled_syntax_errors



def _fix_indent(code: str) -> str:
    """
    Analyzes code line-by-line and structurally fixes indentation for Python blocks.
    Tracks colons, open brackets, and structural dedent keywords to reconstruct scope.
    """
    lines = code.split('\n')
    fixed_lines = []

    indent_stack = [0]  # Tracks the valid indentation depths (e.g., [0, 4, 8])
    expected_indent = 0  # What the next line's indent *should* be
    open_brackets = 0  # Tracks if we are inside a multi-line list/tuple/dict

    # Keywords that structurally belong to a parent block and must be dedented
    dedent_keywords = ("elif", "elif:", "else", "else:", "except", "except:", "finally", "finally:")

    for line in lines:
        stripped = line.strip()

        # 1. Handle empty lines
        if not stripped:
            fixed_lines.append(line)
            continue

        # Capture the original whitespace depth to understand the user/LLM's intent
        original_indent = len(line) - len(line.lstrip())

        # 2. Apply Indentation
        # If we are inside an unclosed bracket, preserve the original relative spacing
        if open_brackets > 0:
            fixed_lines.append(line)
        else:
            # Did the previous line force us to indent? (e.g. it ended with ':')
            if expected_indent > indent_stack[-1]:
                current_indent = expected_indent
                if current_indent not in indent_stack:
                    indent_stack.append(current_indent)
            else:
                if stripped.startswith(dedent_keywords):
                    if len(indent_stack) > 1:
                        indent_stack.pop()
                        current_indent = indent_stack[-1]
                else:
                    # If not forced, trust the original indent to tell us if we are exiting a block
                    while len(indent_stack) > 1 and original_indent < indent_stack[-1]:
                        indent_stack.pop()
                    current_indent = indent_stack[-1]

            fixed_lines.append(" " * current_indent + stripped)

        # 3. State Tracking for the NEXT line
        # Strip strings and comments so we don't accidentally count brackets or colons inside them
            # 3. State Tracking for the NEXT line
            no_strings = re.sub(r'(""".*?"""|\'\'\'.*?\'\'\'|".*?"|\'.*?\')', '', stripped)
            code_part = no_strings.split('#')[0].strip()

            open_brackets += code_part.count('(') + code_part.count('[') + code_part.count('{')
            open_brackets -= code_part.count(')') + code_part.count(']') + code_part.count('}')
            open_brackets = max(0, open_brackets)

            # Keywords that structurally require a block
            block_starters = (
                "def ", "class ", "if ", "elif ", "else",
                "for ", "while ", "try", "except", "finally", "with "
            )

            if open_brackets == 0:
                # --- NEW: Pre-emptive Colon Injection ---
                # If the line starts with a block keyword but is missing the colon
                if stripped.startswith(block_starters) and not code_part.endswith(':'):
                    # 1. Modify the actual string we just appended to fixed_lines
                    fixed_lines[-1] = fixed_lines[-1] + ":"
                    # 2. Update the local state variable so the indent logic below catches it
                    code_part += ":"
                    # ----------------------------------------

                if code_part.endswith(':'):
                    expected_indent = current_indent + 4
                else:
                    expected_indent = current_indent

    return "\n".join(fixed_lines)


def _ensure_balanced_quotes(code_line: str) -> str:
    """
    Patches an unterminated trailing string literal.
    Intelligently places the missing quote BEFORE trailing brackets
    that belong to the outer Python scope.
    """
    in_string = False
    quote_type = ""
    bracket_stack = []

    # Dictionary to map closing brackets to opening brackets
    bracket_map = {')': '(', ']': '[', '}': '{'}

    i = 0
    n = len(code_line)

    while i < n:
        # Skip escaped characters so they don't falsely trigger quote matching
        if code_line[i] == '\\':
            i += 2
            continue

        if not in_string:
            # Check for opening triple quotes first
            if code_line[i:i + 3] in ('"""', "'''"):
                in_string = True
                quote_type = code_line[i:i + 3]
                i += 3
                continue
            # Check for opening single/double quotes
            elif code_line[i] in ('"', "'"):
                in_string = True
                quote_type = code_line[i]
                i += 1
                continue
            # Track structural brackets opened OUTSIDE the string
            elif code_line[i] in "([{":
                bracket_stack.append(code_line[i])
            elif code_line[i] in ")]}":
                if bracket_stack and bracket_stack[-1] == bracket_map[code_line[i]]:
                    bracket_stack.pop()
        else:
            # Check if the current sequence matches the active opening quote
            if code_line[i:i + len(quote_type)] == quote_type:
                in_string = False
                i += len(quote_type)
                quote_type = ""
                continue

        i += 1

    # If we finished parsing and a string is still open
    if in_string:
        tail_idx = n
        temp_stack = list(bracket_stack)

        # Walk backwards from the end of the line to find where the quote actually belongs
        while tail_idx > 0:
            char = code_line[tail_idx - 1]

            # Ignore trailing whitespace
            if char.isspace():
                tail_idx -= 1
                continue

            # If it's a closing bracket, does it match an unclosed bracket from outside the string?
            if char in bracket_map:
                if temp_stack and temp_stack[-1] == bracket_map[char]:
                    temp_stack.pop()  # Match found, step past it
                    tail_idx -= 1
                    continue

            # Once we hit normal string characters, break
            break

        # Insert the quote at the calculated position, leaving trailing brackets outside
        code_line = code_line[:tail_idx] + quote_type + code_line[tail_idx:]

    return code_line


def load_file(file_name):
    """Reads the .m file and returns the file content."""
    print("=== reading file ===")
    file_path = os.path.join(os.getcwd(), file_name)
    if os.path.exists(file_path):
        with open(file_path, 'r') as file:
            file_content = file.read()
        return file_content
    else:
        raise FileNotFoundError(f"The file {file_name} does not exist in the current directory.")


if __name__ == "__main__":
    import time

    start_time = time.perf_counter()
    code = """
import numpy as np

def dynamics(t, x, u):
ms, mu, ks, kt = 300, 60, 16000, 190000
    zs, vs, zu, vu = x[0], x[1], x[2], x[3]
    xdot = vs,
            (-ks*(zs-zu) - bs*(vs-vu) + u) / ms,
            vu
            (ks*(zs-zu) + bs*(vs-vu)  kt*zu - u) / mu]
    return np.array(xdot)
    """

    code = load_file("corrupted.txt")

    code = fix_code(code, "meta/llama-4-maverick-17b-128e-instruct")
    end_time = time.perf_counter()

    pprint.pprint(code)
    print(end_time - start_time)







