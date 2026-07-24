import json
import re
import numpy as np

from backend_api.Recommender.agents.file_management import clean_json
from backend_api.Trimmer.services.human_input import require_human_input
from backend_api.Trimmer.states import WorkflowState
from backend_api.Trimmer.agenticNodes.agents import Agents


def validate_config_only(state: WorkflowState, writer, agents) -> WorkflowState:
    """Node to validate and update operating conditions."""
    writer({"progress": 0.7, "text": "⏳ Validate System Configuration..."})

    logger = state['logger']
    logger.info("--- Entering Node: validate_config_only ---")

    # Validate and update the configuration
    config = state['config']

    try:
        validated_config = agents.validate_only(state)
        writer({"agent_tag": "⏳.Configue Validator", "log_history": clean_json(str(validated_config))})
        if validated_config:
            state['config'] = validated_config
            logger.info("Updated config via ParsingGraph.validate_only: %s",
                        json.dumps(agents.make_serializable(state['config']), indent=2))
            return state
    except Exception as e:
        logger.warning("ParsingGraph.validate_only failed, using local fallback validation: %s", e)

    # Ensure required fields exist
    required_fields = ['system_name', 'params', 'operating_conditions',
                       'bounds', 'n_x', 'n_u', 'state_vars', 'input_vars',
                       'param_vars', 'system_f_code']

    for field in required_fields:
        if field not in config or config[field] is None:
            if field in ['params', 'operating_conditions', 'bounds']:
                config[field] = {}
            elif field in ['n_x', 'n_u']:
                config[field] = 0
            elif field in ['state_vars', 'input_vars', 'param_vars']:
                config[field] = []
            elif field == 'system_name':
                config[field] = 'Unknown_System'
            elif field == 'system_f_code':
                config[field] = ''

    # Validate and prompt for missing params
    if not config.get('param_vars'):
        print("\n⚠️ No parameters identified. Please provide system parameters.")
    else:
        for param in config['param_vars']:
            if param not in config['params'] or config['params'][param] is None:
                # FIX: Pass 'state' into the prompt generator
                question, default = _generate_prompt_with_agent(
                    agents, dict(config), "params", param, logger, state
                )

                prompt_display = f"  {question}"
                if default is not None and default != "":
                    prompt_display += f" (default: {default})"
                prompt_display += ": "

                if state["ui_mode"] == "streamlit":
                    user_input = str(require_human_input(
                        state=state,
                        prompt=prompt_display,
                        key=f"specify_system_params_error",
                        default=str(default)
                    ))
                else:
                    user_input = input(prompt_display).strip()

                if user_input:
                    try:
                        if '.' in user_input:
                            config['params'][param] = float(user_input)
                        else:
                            config['params'][param] = int(user_input)
                    except ValueError:
                        config['params'][param] = user_input
                else:
                    try:
                        if '.' in default:
                            config['params'][param] = float(default)
                        else:
                            config['params'][param] = int(default)
                    except ValueError:
                        config['params'][param] = default

    # Validate and prompt for missing operating conditions
    if not config.get('operating_conditions'):
        output_text = "\n⚠️ No operating conditions specified.\n"
        specifiable, must_zero, arbitrary = _categorize_states(dict(config))

        explanation = _build_conditions_explanation(specifiable, must_zero, arbitrary, config.get('n_u', 0))
        output_text += f"\n{explanation}"

        if specifiable:
            adjusted_n_u = int(config.get('n_u', 0) or 0)
            output_text += f"\n🔧 For trimming systems, please specify the desired operating conditions:"
            output_text += f"\n  Suggested operating conditions:"
            for i, op_var in enumerate(specifiable, 1):
                output_text += f"\n    {i}) {op_var}"
            output_text += f"\n  You can:"
            output_text += f"\n    - Press Enter to choose the first suggested items, or"
            output_text += f"\n    - Enter indices (e.g. '1,3') to select a subset (up to {adjusted_n_u} items)."
            output_text += f"  Your choice:"

            if state["ui_mode"] == "streamlit":
                user_choice = require_human_input(
                    state=state,
                    prompt=output_text,
                    key="specify_trim_variable_error",
                    default="1"
                )
            else:
                user_choice = input("  ").strip()

            if user_choice:
                try:
                    user_choice = str(user_choice)
                    indices = [int(idx.strip()) - 1 for idx in user_choice.split(',')]
                    selected_vars = [specifiable[i] for i in indices if 0 <= i < len(specifiable)]
                    if adjusted_n_u > 0:
                        selected_vars = selected_vars[:adjusted_n_u]
                except (ValueError, IndexError):
                    limit = min(len(specifiable), adjusted_n_u) if adjusted_n_u > 0 else len(specifiable)
                    print(f"  ⚠️ Invalid input. Using first {limit} items.")
                    selected_vars = specifiable[:limit]
            else:
                num_to_select = min(len(specifiable), adjusted_n_u) if adjusted_n_u > 0 else len(specifiable)
                selected_vars = specifiable[:num_to_select] if num_to_select > 0 else []

            for op_var in selected_vars:
                # FIX: Pass 'state' into the prompt generator
                question, default = _generate_prompt_with_agent(
                    agents, dict(config), "operating_conditions", op_var, logger, state
                )

                prompt_display = f"  {question}"
                if default is not None and default != "":
                    prompt_display += f" (default: {default})"
                prompt_display += ": "

                if state["ui_mode"] == "streamlit":
                    user_input = str(require_human_input(
                        state=state,
                        prompt=prompt_display,
                        key=f"specify_op_condition_error",
                        default=str(default)
                    ))
                else:
                    user_input = input(prompt_display).strip()

                if user_input:
                    try:
                        if '.' in user_input:
                            config['operating_conditions'][op_var] = float(user_input)
                        else:
                            config['operating_conditions'][op_var] = int(user_input)
                    except ValueError:
                        config['operating_conditions'][op_var] = user_input
                else:
                    try:
                        if '.' in default:
                            config['operating_conditions'][op_var] = float(default)
                        else:
                            config['operating_conditions'][op_var] = int(default)
                    except ValueError:
                        config['operating_conditions'][op_var] = default

    # Validate and prompt for missing bounds
    if not config.get('bounds') or not all(k in config['bounds']
                                           for k in ['x_min', 'x_max', 'u_min', 'u_max']):
        print("\n⚠️ Bounds not fully specified. Please provide bounds.")

        n_x = config.get('n_x', 2)
        n_u = config.get('n_u', 1)

        for bound_type in ['x_min', 'x_max', 'u_min', 'u_max']:
            if bound_type not in config['bounds'] or config['bounds'][bound_type] is None:
                # FIX: Pass 'state' into the prompt generator
                question, default = _generate_prompt_with_agent(
                    agents, dict(config), "bounds", bound_type, logger, state
                )

                prompt_display = f"  {question}"
                if default is not None and default != "":
                    prompt_display += f" (default: {default})"
                prompt_display += ": "

                if state["ui_mode"] == "streamlit":
                    user_input = str(require_human_input(
                        state=state,
                        prompt=prompt_display,
                        key=f"out_of_bound_error",
                        default=str(default)
                    ))
                else:
                    user_input = input(prompt_display).strip()

                if user_input:
                    try:
                        values = [float(v.strip()) for v in user_input.split(',')]
                        config['bounds'][bound_type] = values
                    except ValueError:
                        print(f"    ⚠️ Invalid input. Using default: {default}")
                        parsed = None
                        try:
                            import re
                            s = str(default).strip()
                            if (s.startswith('[') and s.endswith(']')) or (s.startswith('(') and s.endswith(')')):
                                s = s[1:-1]
                            parts = [p.strip() for p in s.split(',') if p.strip()]
                            parsed = [float(p) for p in parts]
                        except Exception:
                            parsed = [float(default)] if default is not None else []
                        config['bounds'][bound_type] = parsed
                else:
                    s = str(default).strip()
                    if (s.startswith('[') and s.endswith(']')) or (s.startswith('(') and s.endswith(')')):
                        s = s[1:-1]
                    parts = [p.strip() for p in s.split(',') if p.strip()]
                    try:
                        config['bounds'][bound_type] = [float(p) for p in parts]
                    except Exception:
                        try:
                            config['bounds'][bound_type] = [float(default)]
                        except Exception:
                            config['bounds'][bound_type] = []

    # Compile system function
    system_f_code = config.get('system_f_code', '')
    if system_f_code and 'def system_f' in system_f_code:
        try:
            namespace = {"np": np}
            exec(system_f_code, namespace)
            config["system_f"] = namespace.get("system_f")
            if config["system_f"] is None:
                print("Warning: system_f function not found in provided code. Setting to None.")
                config["system_f"] = None
        except SyntaxError as e:
            print(f"SyntaxError compiling system_f_code: {e}")
            print("Continuing with system_f = None")
            config["system_f"] = None
        except Exception as e:
            print(f"Error compiling system_f_code: {e}")
            print("Continuing with system_f = None")
            config["system_f"] = None
    else:
        config["system_f"] = None

    state['config'] = config
    logger.info("Updated config: %s", json.dumps(agents.make_serializable(state['config']), indent=2))
    return state


def _generate_prompt_with_agent(agents, config, missing_key, item_name, logger, state):
    """Generate prompt using the generate_prompt agent if available."""
    try:
        # FIX: Pass 'state' into the factory
        generatePromptAgent = agents.generate_prompt(state)
        agent_state = {
            'system_name': config.get('system_name', 'Unknown'),
            'missing_key': missing_key,
            'item_name': item_name,
            'state_vars': config.get('state_vars', []),
            'input_vars': config.get('input_vars', []),
            'param_vars': config.get('param_vars', []),
            'current_params': config.get('params', {}),
            'n_x': config.get('n_x', 0),
            'n_u': config.get('n_u', 0),
            'system_type_hint': _infer_system_type(config),
            'trace': []
        }
        result_state = generatePromptAgent(agent_state)
        result = result_state.get('prompt_generation_result', {})
        if isinstance(result, dict):
            return result.get('prompt_text', f"Enter {item_name}:"), result.get('default_value', '0')
    except Exception as e:
        if logger:
            logger.warning(f"Direct YAML agent creation failed: {e}. Using heuristic fallback.")

    return _fallback_prompt(config, missing_key, item_name)

def _infer_system_type(config):
    system_name = config.get('system_name', '').lower()
    state_vars = [v.lower() for v in config.get('state_vars', [])]

    if any(ind in system_name for ind in ['aircraft', 'plane', 'flight']):
        return "aircraft"
    if any(ind in state_vars for ind in ['alpha', 'theta', 'airspeed']):
        return "aircraft"
    if any(ind in system_name for ind in ['mass', 'spring', 'pendulum']):
        return "mechanical"
    return "general"


def _fallback_prompt(config, missing_key, item_name):
    defaults = {
        'm': ('1.0', 'mass [kg]'),
        'c': ('0.5', 'damping [Ns/m]'),
        'k': ('10.0', 'stiffness [N/m]'),
        'g': ('9.81', 'gravity [m/s²]'),
        'rho': ('1.225', 'air density [kg/m³]'),
        'desired_force': ('1.0', 'force [N]'),
        'airspeed': ('50.0', 'speed [m/s]'),
    }

    if missing_key == "params":
        default_val, desc = defaults.get(item_name, ('1.0', 'value'))
        return f"{item_name} ({desc}, default: {default_val})", default_val

    elif missing_key == "bounds":
        n_x = config.get('n_x', 2)
        n_u = config.get('n_u', 1)

        defaults_map = {
            'x_min': (','.join(['-10.0'] * n_x), "state lower bounds"),
            'x_max': (','.join(['10.0'] * n_x), "state upper bounds"),
            'u_min': (','.join(['-1.0'] * n_u), "input lower bounds"),
            'u_max': (','.join(['1.0'] * n_u), "input upper bounds"),
        }
        default_val, desc = defaults_map.get(item_name, ('0', 'bounds'))
        return f"{item_name} ({desc}, default: {default_val})", default_val

    return f"{item_name} (default: 0):", "0"


def _categorize_states(config):
    state_vars = config.get('state_vars', [])
    system_name = config.get('system_name', '').lower()

    specifiable = []
    must_zero = []
    arbitrary = []

    rate_indicators = ['rate', 'velocity', 'speed', 'omega', 'accel', 'dot', 'q', 'p', 'r']
    position_indicators = ['position', 'angle', 'height', 'altitude', 'theta', 'phi', 'alpha', 'beta']
    arbitrary_indicators = ['heading', 'psi', 'x_pos', 'y_pos', 'absolute']

    for var in state_vars:
        var_lower = var.lower()

        if any(ind in var_lower for ind in rate_indicators):
            must_zero.append(var)
        elif any(ind in var_lower for ind in arbitrary_indicators):
            arbitrary.append(var)
        elif any(ind in var_lower for ind in position_indicators):
            specifiable.append(var)
        elif 'aircraft' in system_name or 'flight' in system_name:
            specifiable.append(var)
        else:
            if any(var.endswith(suffix) for suffix in ['_dot', '_rate', '_vel']):
                must_zero.append(var)
            else:
                specifiable.append(var)

    specifiable, must_zero, arbitrary = _ensure_specifiable_candidates(
        config, specifiable, must_zero, arbitrary
    )

    return specifiable, must_zero, arbitrary


def _ensure_specifiable_candidates(config, specifiable, must_zero, arbitrary):
    state_vars = list(config.get('state_vars') or [])
    n_u = int(config.get('n_u') or 0)
    target = min(n_u, len(state_vars))
    if target <= 0:
        return list(specifiable or []), list(must_zero or []), list(arbitrary or [])

    spec_orig = [s for s in (specifiable or []) if s in state_vars]
    must_orig = [s for s in (must_zero or []) if s in state_vars]
    arb_orig = [s for s in (arbitrary or []) if s in state_vars]

    def _norm(name):
        return re.sub(r'[^a-z0-9_]', '', str(name).strip().lower())

    def _is_abs_position(name):
        n = _norm(name)
        abs_names = {
            "x", "y", "z", "north", "east", "down", "n", "e", "d",
            "xpos", "ypos", "zpos", "x_pos", "y_pos", "z_pos",
            "posx", "posy", "posz", "positionx", "positiony", "positionz"
        }
        return n in abs_names

    def _is_heading(name):
        return _norm(name) in {"psi", "yaw", "heading", "chi"}

    def _is_rate_like(name):
        n = _norm(name)
        if n in {"p", "q", "r", "wx", "wy", "wz", "omega", "omegax", "omegay", "omegaz"}:
            return True
        return ("rate" in n) or ("accel" in n) or ("dot" in n) or ("omega" in n)

    def _is_speed_like(name):
        n = _norm(name)
        if n in {"v", "vx", "vy", "vz", "vt", "u", "speed", "airspeed", "mach"}:
            return True
        return ("velocity" in n) or ("airspeed" in n) or ("speed" in n)

    def _score(name):
        n = _norm(name)
        score = 0
        if _is_speed_like(n):
            score += 5
        if _is_rate_like(n):
            score -= 3
        if _is_abs_position(n):
            score -= 6
        if _is_heading(n):
            score -= 5
        if name in spec_orig:
            score += 2
        if name in must_orig:
            score -= 1
        if name in arb_orig:
            score -= 1
        return score

    spec_list = [s for s in spec_orig if _score(s) >= 1]

    remaining = [s for s in state_vars if s not in spec_list]
    remaining.sort(key=lambda s: (-_score(s), state_vars.index(s)))
    for s in remaining:
        if len(spec_list) >= target:
            break
        spec_list.append(s)

    for s in spec_orig:
        if s not in spec_list and _score(s) > 1:
            spec_list.append(s)

    spec_set = set(spec_list)
    must_zero_list = []
    arbitrary_list = []
    for s in state_vars:
        if s in spec_set:
            continue
        if s in must_orig:
            must_zero_list.append(s)
        elif s in arb_orig:
            arbitrary_list.append(s)
        elif _is_rate_like(s):
            must_zero_list.append(s)
        else:
            arbitrary_list.append(s)

    return spec_list, must_zero_list, arbitrary_list


def _build_conditions_explanation(specifiable, must_zero, arbitrary, n_u):
    parts = []
    if specifiable:
        parts.append(f"Specifiable: {', '.join(specifiable)}")
    else:
        parts.append("Specifiable: (none)")

    if must_zero:
        parts.append(f"Fixed at zero: {', '.join(must_zero)}")
    else:
        parts.append("Fixed at zero: (none)")

    if arbitrary:
        parts.append(f"Arbitrary/Determined: {', '.join(arbitrary)}")
    else:
        parts.append("Arbitrary/Determined: (none)")

    parts.append(f"You can specify up to {n_u} independent values.")

    return "Operating conditions:\n" + "\n".join(f"  {p}" for p in parts)