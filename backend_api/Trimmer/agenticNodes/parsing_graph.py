"""
parsing_graph.py - LangGraph workflow for system configuration parsing

This module provides a LangGraph-based workflow for parsing system definitions
from files or natural language descriptions, with validation and completion.
"""

import os
import numpy as np
import re
from typing import Dict, Any, TypedDict, Optional
from langgraph.graph import StateGraph, END
import html
import ast

from backend_api.Trimmer.agenticNodes.create_agent import create_agent
from ..services.human_input import require_human_input

try:
    from Trimmer.agenticNodes.input_handlers import InputHandlers
except ImportError:
    from .input_handlers import InputHandlers


class SystemConfig(TypedDict):
    """Type definition for system configuration."""
    system_name: str
    params: Dict[str, Any]
    operating_conditions: Dict[str, Any]
    bounds: Dict[str, Any]
    n_x: int
    n_u: int
    state_vars: list
    input_vars: list
    param_vars: list
    system_f_code: str
    system_f: Any  # Compiled function


class GraphState(TypedDict):
    """Type definition for parsing graph state."""
    input_text: str
    equation: str
    ui_mode: str
    ui_inputs: Dict[str, Any]
    parsed_config: Optional[SystemConfig]
    final_config: Optional[SystemConfig]


class ParsingGraph:
    """
    LangGraph-based workflow for parsing and validating system configurations.
    
    This graph handles:
    1. Input parsing (file or natural language)
    2. Configuration validation and completion
    3. System function compilation
    """

    def __init__(self, llm, logger=None):
        """
        Initialize the parsing graph.
        
        Args:
            llm: LLM client for agent operations
                shared agent configuration.
            logger: Optional logger instance
        """
        self.llm = llm
        self.logger = logger
        self.graph = self._build_parsing_graph()

    def _parse_input(self, state: GraphState) -> GraphState:
        """
        Parse the input description or file.

        Handles both file paths and natural language descriptions.
        """
        if "equation" in state:
            new_state = state.copy()
            new_state["input_text"] = state["equation"]
            return new_state


        input_text = state["input_text"]

        # Check if input_text is a file path
        if input_text and (input_text.endswith('.py') or
                           input_text.endswith('.m') or
                           input_text.endswith('.txt')):
            # Attempt to read as file
            if os.path.isfile(input_text):
                try:
                    print(f"\n📂 Loading system from file: {input_text}")
                    with open(input_text, 'r', encoding='utf-8') as f:
                        content = f.read()
                    input_text = f"Code file content:\n{content}"
                    print(f"✓ File loaded successfully ({len(content)} characters)")
                except Exception as e:
                    print(f"⚠️ Error reading file: {e}")
                    raise ValueError(f"Error reading file {input_text}: {e}")
            else:
                print(f"⚠️ File not found: {input_text}")
                raise ValueError(f"File not found: {input_text}")

        # Store processed input
        new_state = state.copy()
        new_state["input_text"] = input_text
        return new_state

    def _parse_system(self, state: GraphState, run_config: dict = None) -> GraphState:
        """
        Use LLM agent to parse the input_text into parsed_config.
        """
        try:
            # 1. FIX: Safely extract existing operating conditions from initial parsed_config
            existing_config = state.get("parsed_config") or {}
            op_conditions = existing_config.get("operating_conditions", {})

            # Extract callbacks if provided via config
            callbacks = run_config.get("callbacks") if run_config else None

            parse_agent = create_agent(self.llm, "parse_system", callbacks=callbacks)
            agent_state = {
                'input_text': state['input_text'],
                # 2. FIX: Pass the correctly extracted op_conditions
                'operating_conditions': op_conditions,
                'trace': []
            }
            result_state = parse_agent(agent_state)
            parsed_config = result_state.get('parsed_config', {})

            if not parsed_config:
                raise ValueError("LLM parsing failed to produce configuration")

            # Normalize keys by removing 'parsed_' prefix if present
            normalized_config = {}
            for key, value in parsed_config.items():
                if key.startswith('parsed_'):
                    new_key = key[7:]  # remove 'parsed_'
                    normalized_config[new_key] = value
                else:
                    normalized_config[key] = value

            # 3. FIX: Merge the original operating conditions back in if the LLM dropped them
            if op_conditions and not normalized_config.get("operating_conditions"):
                normalized_config["operating_conditions"] = op_conditions
            # Optional: If you want agents.py to ALWAYS override the LLM's operating conditions,
            # you can change the above if-statement to:
            # if op_conditions:
            #     normalized_config["operating_conditions"].update(op_conditions)

            new_state = state.copy()
            new_state["parsed_config"] = normalized_config
            return new_state

        except Exception as e:
            if self.logger:
                self.logger.error(f"LLM parsing failed: {e}")
            raise ValueError(f"Failed to parse system configuration: {e}")

    def _validate_config(self, state: GraphState, run_config: dict = None) -> GraphState:
        """
        Validate and complete the parsed configuration.

        Ensures all required fields are present and prompts for missing information.
        """
        config = state.get("parsed_config", {})

        if config is None:
            raise ValueError("No parsed configuration available")

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
                    # Use agent-based prompt generation if available
                    question, default = self._generate_prompt_with_agent(
                        dict(config), "params", param, run_config
                    )

                    prompt_display = f"  {question}"
                    if default is not None and default != "":
                        prompt_display += f" (default: {default})"
                    prompt_display += ": "
                    user_input = input(prompt_display).strip()
                    if user_input:
                        try:
                            # Try to parse as number
                            if '.' in user_input:
                                config['params'][param] = float(user_input)
                            else:
                                config['params'][param] = int(user_input)
                        except ValueError:
                            # Keep as string
                            config['params'][param] = user_input
                    else:
                        # Use default
                        try:
                            if '.' in default:
                                config['params'][param] = float(default)
                            else:
                                config['params'][param] = int(default)
                        except ValueError:
                            config['params'][param] = default

        # Extract param_vars from system_f_code if not set
        if not config.get('param_vars') and config.get('system_f_code'):
            param_matches = re.findall(r"params\['(\w+)'\]", config['system_f_code'])
            config['param_vars'] = list(set(param_matches))
            # Ensure these params are in params dict
            for param in config['param_vars']:
                if param not in config['params'] or config['params'][param] is None:
                    config['params'][param] = 0.0

        # Ensure all params are numeric (not None or string)
        for param in config.get('param_vars', []):
            if param in config['params']:
                try:
                    config['params'][param] = float(config['params'][param])
                except (ValueError, TypeError):
                    config['params'][param] = 0.0
            else:
                config['params'][param] = 0.0

        # Compile system function
        system_f_code = config.get('system_f_code', '')
        if system_f_code and 'def system_f' in system_f_code:
            try:
                # Execute the code to define the function
                # Make params available in the namespace to avoid None errors
                namespace = {"np": np}
                # Add each param individually to avoid None values
                for param_name, param_value in config.get('params', {}).items():
                    namespace[param_name] = param_value
                exec(system_f_code, namespace)
                # Extract the function
                config["system_f"] = namespace.get("system_f")
                if config["system_f"] is None:
                    print("Warning: system_f function not found in provided code. Setting to None.")
                    config["system_f"] = None
            except SyntaxError as e:
                print(f"SyntaxError compiling system_f_code: {e}")
                print(f"Code was:\n{system_f_code}")
                print("Continuing with system_f = None")
                config["system_f"] = None
            except Exception as e:
                print(f"Error compiling system_f_code: {e}")
                print(f"Code was:\n{system_f_code}")
                print("Continuing with system_f = None")
                config["system_f"] = None
        else:
            config["system_f"] = None

        operating_conds = config.get('operating_conditions') or {}
        does_have_operating_point = bool(operating_conds) and all(v not in ('', None) for v in operating_conds.values())

        # Validate and prompt for missing operating conditions
        # print(config.get('operating_conditions') )
        if not config.get('operating_conditions') or not does_have_operating_point:
            print("\n⚠️ Operating conditions are missing or incomplete.")

            # Only fetch suggestions if we don't already have keys to prompt for
            if not config.get('operating_conditions'):
                # Use LLM-based categorization
                op_conditions_list, explanation, adjusted_n_u, zeroed_list, arbitrary_list = self._get_operating_conditions_list(
                    dict(config), run_config)

                print(f"\n{explanation}")

                # Parse specifiable states from the list
                specifiable = [s.strip() for s in op_conditions_list.split(',') if
                               s and s.strip()] if op_conditions_list else []
            else:
                # If keys already exist (like 'zs'), use them directly as the selected variables
                specifiable = list(config.get("operating_conditions").keys())
                adjusted_n_u = len(specifiable)

            if specifiable:
                # If we entered with an incomplete dict, skip selecting indices and go straight to filling values
                if does_have_operating_point or not config.get('operating_conditions'):
                    output_text = f"\n🔧 For trimming systems, please specify the desired operating conditions:"
                    output_text += f"\n  Suggested operating conditions:"
                    for i, op_var in enumerate(specifiable, 1):
                        output_text += f"\n    {i}) {op_var}"
                    output_text += f"\n  You can:"
                    output_text += f"\n    - Press Enter to choose the first suggested items, or"
                    output_text += f"\n    - Enter indices (e.g. '1,3') to select a subset (up to {adjusted_n_u} items)."
                    output_text += f"\n  Your choice:"

                    if state["ui_mode"] == "streamlit":
                        user_choice = str(require_human_input(
                            state=state,
                            prompt=output_text,
                            key="specify_trim_variable",
                            default="1"
                        ))
                    else:
                        print(output_text)
                        user_choice = input("  ").strip()

                    if user_choice:
                        try:
                            user_choice = str(user_choice)
                            indices = [int(idx.strip()) - 1 for idx in user_choice.split(',')]
                            selected_vars = [specifiable[i] for i in indices if 0 <= i < len(specifiable)]
                            selected_vars = selected_vars[:adjusted_n_u]
                        except (ValueError, IndexError):
                            print(f"  ⚠️ Invalid input. Using first {min(len(specifiable), adjusted_n_u)} items.")
                            selected_vars = specifiable[:adjusted_n_u]
                    else:
                        num_to_select = min(len(specifiable), adjusted_n_u)
                        selected_vars = specifiable[:num_to_select]
                else:
                    # Dict exists but values are empty -> prompt for all existing keys directly
                    selected_vars = specifiable
                # Prompt for values of selected variables
                for op_var in selected_vars:
                    question, default = self._generate_prompt_with_agent(
                        dict(config), "operating_conditions", op_var, run_config
                    )

                    prompt_display = f"  {question}"
                    if default is not None and default != "":
                        prompt_display += f" (default: {default})"
                    prompt_display += ": "

                    if state["ui_mode"] == "streamlit":
                        user_input = str(require_human_input(
                            state=state,
                            prompt=prompt_display,
                            key="specify_op_condition",
                            default="1"
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

        # Normalize bounds
        n_x = config['n_x']
        n_u = config['n_u']
        bounds = config.get('bounds', {})

        # Set default bounds if missing (required for differential_evolution)
        if bounds.get('x_min') is None: bounds['x_min'] = [-1e8] * n_x
        if bounds.get('x_max') is None: bounds['x_max'] = [1e8] * n_x
        if bounds.get('u_min') is None: bounds['u_min'] = [-1e8] * n_u
        if bounds.get('u_max') is None: bounds['u_max'] = [1e8] * n_u

        if isinstance(bounds.get('x_min'), (int, float)): bounds['x_min'] = [bounds['x_min']] * n_x
        if isinstance(bounds.get('x_max'), (int, float)): bounds['x_max'] = [bounds['x_max']] * n_x
        if isinstance(bounds.get('u_min'), (int, float)): bounds['u_min'] = [bounds['u_min']] * n_u
        if isinstance(bounds.get('u_max'), (int, float)): bounds['u_max'] = [bounds['u_max']] * n_u
        config['bounds'] = bounds

        # Compile system function
        system_f_code = config.get('system_f_code', '')
        if system_f_code and 'def system_f' in system_f_code:
            # Clean up escaped sequences if present
            code = system_f_code
            try:
                code_decoded = code.encode('utf-8').decode('unicode_escape')
                if '\\n' not in code_decoded or '\\' not in code_decoded:
                    code = code_decoded
            except Exception:
                code = code.replace('\\r\\n', '\r\n').replace('\\n', '\n').replace('\\"', '"')

            # Strip markdown fences if any
            m = re.search(r'```(?:\w+)?\s*(.*?)```', code, re.DOTALL)
            if m:
                code = m.group(1)
            else:
                mm = re.search(r'(?:import\s+|from\s+|def\s+system_f).*', code, re.DOTALL)
                if mm:
                    code = mm.group(0)

            try:
                namespace = {"np": np, "params": config.get('params', {})}
                exec(code, namespace)
                config["system_f"] = namespace.get("system_f")
                if config["system_f"] is None:
                    print("Warning: system_f function not found in provided code. Setting to None.")
                    config["system_f"] = None
            except SyntaxError as e:
                print(f"SyntaxError compiling system_f_code: {e}")
                print(f"Code was:\n{code}")
                print("Continuing with system_f = None")
                config["system_f"] = None
            except Exception as e:
                print(f"Error compiling system_f_code: {e}")
                print(f"Code was:\n{code}")
                print("Continuing with system_f = None")
                config["system_f"] = None
        else:
            config["system_f"] = None

        self._clean_system_f_code(config)
        self._compile_system_f(config)
        self._ensure_callable_system_f(config)
        self._normalize_bounds(config)

        new_state = state.copy()
        new_state["final_config"] = config
        return new_state

    def _clean_system_f_code(self, config: dict):
        code = config.get('system_f_code')
        if not code or not isinstance(code, str):
            return

        code = html.unescape(code)

        # Decode escaped sequences
        try:
            decoded = code.encode('utf-8').decode('unicode_escape')
            if '\\n' not in decoded or '\\' not in decoded:
                code = decoded
        except Exception:
            code = code.replace('\\r\\n', '\r\n').replace('\\n', '\n')
            code = code.replace("\\'", "'").replace('\\"', '"')

        # Strip markdown fences
        m = re.search(r'```(?:\w+)?\s*(.*?)```', code, re.DOTALL)
        if m:
            code = m.group(1)
        else:
            mm = re.search(r'(?:import\s+|from\s+|def\s+system_f).*', code, re.DOTALL)
            if mm:
                code = mm.group(0)

        code = code.strip()

        # AST clean trailing junk
        try:
            ast.parse(code)
        except SyntaxError:
            lines = code.split('\n')
            for i in range(len(lines) - 1, 0, -1):
                candidate = '\n'.join(lines[:i])
                try:
                    ast.parse(candidate)
                    code = candidate
                    break
                except SyntaxError:
                    continue

        config['system_f_code'] = code

    def _compile_system_f(self, config: dict):
        code = config.get('system_f_code')
        if not code or 'def system_f' not in code:
            config['system_f'] = None
            return

        try:
            namespace = {"np": np, "numpy": np, "params": config.get('params', {})}
            exec(code, namespace)
            config["system_f"] = namespace.get("system_f")
        except Exception as e:
            if self.logger:
                self.logger.error(f"Compilation failed: {e}")
            config["system_f"] = None

    def _ensure_callable_system_f(self, config: dict):
        if config.get('system_f') is None or not callable(config.get('system_f')):

            if self.logger:
                self.logger.warning("system_f missing or invalid. Using fallback.")

            def fallback_system_f(x, u, p):
                return np.full_like(x, 1e9)

            config['system_f'] = fallback_system_f

    def _normalize_bounds(self, config: dict):
        n_x = config.get('n_x', 0)
        n_u = config.get('n_u', 0)
        bounds = config.get('bounds') or {}

        def to_list(val, length):
            if val is None:
                return None
            if isinstance(val, (int, float)):
                return [float(val)] * length
            if isinstance(val, (list, tuple)):
                try:
                    return [float(v) for v in val]
                except Exception:
                    return None
            return None

        bounds['x_min'] = to_list(bounds.get('x_min'), n_x) or [-1e8] * n_x
        bounds['x_max'] = to_list(bounds.get('x_max'), n_x) or [1e8] * n_x
        bounds['u_min'] = to_list(bounds.get('u_min'), n_u) or [-1e8] * n_u
        bounds['u_max'] = to_list(bounds.get('u_max'), n_u) or [1e8] * n_u

        config['bounds'] = bounds

    def _build_parsing_graph(self):
        """
        Build LangGraph for parsing workflow.

        Returns:
            Compiled StateGraph
        """
        workflow = StateGraph(GraphState)

        workflow.add_node("parse_input", self._parse_input)
        workflow.add_node("parse_system", self._parse_system)
        workflow.add_node("validate_config", self._validate_config)
        workflow.add_edge("parse_input", "parse_system")
        workflow.add_edge("parse_system", "validate_config")
        workflow.add_edge("validate_config", END)
        workflow.set_entry_point("parse_input")

        return workflow.compile()

    def invoke(self, initial_state: GraphState, config: dict = None, **kwargs) -> list[Any] | dict[str, Any] | Any:
        """
        Execute the parsing graph with initial state.

        Args:
            initial_state: Starting state with input_text
            config: Optional RunnableConfig for propagating callbacks and settings

        Returns:
            Final state with parsed and validated config
        """
        return self.graph.invoke(initial_state, config=config, **kwargs)

    def _generate_prompt_with_agent(self, config: Dict[str, Any], missing_key: str, item_name: str, run_config: dict = None):
        """
        Generate prompt using the generate_prompt agent if available.

        Falls back to heuristic generation if agent is not available.
        """
        callbacks = run_config.get("callbacks") if run_config else None

        try:
            agent = create_agent(self.llm, "generate_prompt", callbacks=callbacks)
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
                'system_type_hint': self._infer_system_type(config),
                'trace': []
            }
            result_state = agent(agent_state)
            result = result_state.get('prompt_generation_result', {})
            if isinstance(result, dict):
                return result.get('prompt_text', f"Enter {item_name}:"), result.get('default_value', '0')
        except Exception as e:
            if self.logger:
                self.logger.warning(f"Prompt agent failed: {e}. Using fallback.")

        # attempt to create a YAML-driven agent directly from templates (Product_Tempelate style).
        try:
            agent = create_agent(self.llm, "generate_prompt", callbacks=callbacks)
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
                'system_type_hint': self._infer_system_type(config),
                'trace': []
            }
            result_state = agent(agent_state)
            result = result_state.get('prompt_generation_result', {})
            if isinstance(result, dict):
                return result.get('prompt_text', f"Enter {item_name}:"), result.get('default_value', '0')
        except Exception as e:
            if self.logger:
                self.logger.warning(f"YAML prompt agent creation failed: {e}. Using heuristic fallback.")

        # Final fallback to simple heuristic
        return self._fallback_prompt(config, missing_key, item_name)

    def _infer_system_type(self, config: Dict[str, Any]) -> str:

        """Infer system type from configuration."""
        system_name = config.get('system_name', '').lower()
        state_vars = [v.lower() for v in config.get('state_vars', [])]

        if any(ind in system_name for ind in ['aircraft', 'plane', 'flight']):
            return "aircraft"
        if any(ind in state_vars for ind in ['alpha', 'theta', 'airspeed']):
            return "aircraft"
        if any(ind in system_name for ind in ['mass', 'spring', 'pendulum']):
            return "mechanical"

        return "general"

    def _fallback_prompt(self, config: Dict[str, Any], missing_key: str, item_name: str):

        """Heuristic prompt generation fallback."""
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

    def _parse_default_list(self, default_val):
        """Parse a default string or list into a list of floats.

        Handles formats like "[0.0, 250.0]", "0.0,250.0", or single scalar strings.
        Returns a list of floats (may be empty) or raises ValueError.
        """
        if default_val is None:
            return []
        # If already a list/tuple/ndarray
        if isinstance(default_val, (list, tuple, np.ndarray)):
            out = []
            for v in default_val:
                out.append(float(v))
            return out

        # Try to extract numeric tokens from string
        if isinstance(default_val, str):
            s = default_val.strip()
            # Remove surrounding brackets or parentheses
            if (s.startswith('[') and s.endswith(']')) or (s.startswith('(') and s.endswith(')')):
                s = s[1:-1]
            # First try simple split
            parts = [p.strip() for p in s.split(',') if p.strip()]
            nums = []
            for p in parts:
                try:
                    nums.append(float(p))
                except ValueError:
                    # Fallback to regex search for numbers
                    import re
                    found = re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", p)
                    for f in found:
                        nums.append(float(f))
            if nums:
                return nums

        # Last resort: attempt to cast to float single value
        try:
            return [float(default_val)]
        except Exception:
            raise ValueError(f"Could not parse default bounds value: {default_val}")

    def _get_operating_conditions_list(self, config: dict, run_config: dict = None) -> tuple[str, str, int, str, str]:
        """
        Use LLM agent to determine the relevant operating conditions for this system.
        Returns: (specifiable_list_str, explanation_str, num_independent_vals, zeroed_list_str, arbitrary_list_str)
        Uses YAML-driven agent for state categorization.
        """
        callbacks = run_config.get("callbacks") if run_config else None

        system_info = f"System: {config.get('system_name', 'Unknown')}\n"
        if config.get('system_f_code'):
            system_info += f"System equations:\n{config['system_f_code']}\n"
        if config.get('state_vars'):
            system_info += f"State variables: {', '.join(config['state_vars'])}\n"
        if config.get('input_vars'):
            system_info += f"Input variables: {', '.join(config['input_vars'])}\n"

        if self.logger:
            self.logger.debug(f"System Info for Classification:\n{system_info}")

        # Use YAML-driven agent for categorization
        try:
            categorize_agent = create_agent(self.llm, "categorize_states", callbacks=callbacks)
            agent_state = {
                'system_info': system_info,
                'state_vars': config.get('state_vars', []),
                'n_u': config.get('n_u', 0),
                'trace': []
            }
            result_state = categorize_agent(agent_state)
            categorization = result_state.get('state_categorization', {})

            specifiable_states = categorization.get("specifiable_states", [])
            must_be_zero_states = categorization.get("must_be_zero_states", [])
            arbitrary_states = categorization.get("arbitrary_states", [])

        except Exception as e:
            if self.logger:
                self.logger.warning(f"LLM categorization failed: {e}. Using heuristic fallback.")
            # Fallback to heuristic categorization
            specifiable_states, must_be_zero_states, arbitrary_states = self._categorize_states(config)

        # Ensure there are always enough specifiable candidates for user selection.
        # Prefer promoting from arbitrary states first, then from remaining states.
        specifiable_states, must_be_zero_states, arbitrary_states = self._ensure_specifiable_candidates(
            config,
            specifiable_states,
            must_be_zero_states,
            arbitrary_states
        )

        # Sort states based on their order in config['state_vars'] for consistent display
        state_vars_order = config.get('state_vars') or []
        if state_vars_order:
            def get_order(name):
                try:
                    return state_vars_order.index(name)
                except ValueError:
                    return 999

            specifiable_states.sort(key=get_order)
            must_be_zero_states.sort(key=get_order)
            arbitrary_states.sort(key=get_order)

        # Convert to comma-separated strings for backward compatibility
        op_conditions_list = ','.join(specifiable_states) if specifiable_states else ""
        zeroed_list = ','.join(must_be_zero_states) if must_be_zero_states else ""
        arbitrary_list = ','.join(arbitrary_states) if arbitrary_states else ""

        # Generate clearer explanation
        n_x = config.get('n_x', 0)
        n_u = config.get('n_u', 0)

        # adjusted_n_u represents the number of specifiable states the user can choose from
        adjusted_n_u = n_u

        # Build description strings for each category
        if specifiable_states:
            states_desc = f"Specifiable: {', '.join(specifiable_states)}"
        else:
            states_desc = "Specifiable: (none)"

        if must_be_zero_states:
            zeroed_desc = f"Fixed at zero: {', '.join(must_be_zero_states)}"
        else:
            zeroed_desc = "Fixed at zero: (none)"

        if arbitrary_states:
            arbitrary_desc = f"Arbitrary/Determined: {', '.join(arbitrary_states)}"
        else:
            arbitrary_desc = "Arbitrary/Determined: (none)"

        explanation = f"Operating conditions: \n {states_desc}.\n {zeroed_desc}.\n {arbitrary_desc}. \n You can specify {adjusted_n_u} independent values."

        # Return: specifiable states, explanation, num_specifiable, zeroed_list, arbitrary_list
        return op_conditions_list, explanation, adjusted_n_u, zeroed_list, arbitrary_list

    def _ensure_specifiable_candidates(
        self,
        config: Dict[str, Any],
        specifiable_states,
        must_be_zero_states,
        arbitrary_states
    ):
        """
        Deterministically ensure sensible specifiable candidates.

        Rules:
        1) Preserve plausible specifiable states.
        2) Avoid promoting clearly arbitrary absolute positions/headings unless necessary.
        3) Ensure at least n_u specifiable candidates when possible.
        """
        state_vars = list(config.get('state_vars') or [])
        n_u = int(config.get('n_u') or 0)
        target = min(n_u, len(state_vars))
        if target <= 0:
            return list(specifiable_states or []), list(must_be_zero_states or []), list(arbitrary_states or [])

        spec_orig = [s for s in (specifiable_states or []) if s in state_vars]
        must_orig = [s for s in (must_be_zero_states or []) if s in state_vars]
        arb_orig = [s for s in (arbitrary_states or []) if s in state_vars]

        def _norm(name: str) -> str:
            return re.sub(r'[^a-z0-9_]', '', str(name).strip().lower())

        def _is_abs_position(name: str) -> bool:
            n = _norm(name)
            abs_names = {
                "x", "y", "z", "north", "east", "down", "n", "e", "d",
                "xpos", "ypos", "zpos", "x_pos", "y_pos", "z_pos",
                "posx", "posy", "posz", "positionx", "positiony", "positionz"
            }
            return n in abs_names

        def _is_heading(name: str) -> bool:
            return _norm(name) in {"psi", "yaw", "heading", "chi"}

        def _is_rate_like(name: str) -> bool:
            n = _norm(name)
            if n in {"p", "q", "r", "wx", "wy", "wz", "omega", "omegax", "omegay", "omegaz"}:
                return True
            return ("rate" in n) or ("accel" in n) or ("dot" in n) or ("omega" in n)

        def _is_speed_like(name: str) -> bool:
            n = _norm(name)
            if n in {"v", "vx", "vy", "vz", "vt", "u", "speed", "airspeed", "mach"}:
                return True
            return ("velocity" in n) or ("airspeed" in n) or ("speed" in n)

        def _score(name: str) -> int:
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

        # Keep only reasonable pre-classified specifiable states.
        spec = [s for s in spec_orig if _score(s) >= 1]

        # Fill up to target deterministically by score, then state order.
        remaining = [s for s in state_vars if s not in spec]
        remaining.sort(key=lambda s: (-_score(s), state_vars.index(s)))
        for s in remaining:
            if len(spec) >= target:
                break
            spec.append(s)

        # Keep additional positive-confidence specifiable suggestions (if any).
        for s in spec_orig:
            if s not in spec and _score(s) > 1:
                spec.append(s)

        spec_set = set(spec)
        must_zero = []
        arbitrary = []
        for s in state_vars:
            if s in spec_set:
                continue
            if s in must_orig:
                must_zero.append(s)
            elif s in arb_orig:
                arbitrary.append(s)
            elif _is_rate_like(s):
                must_zero.append(s)
            else:
                arbitrary.append(s)

        return spec, must_zero, arbitrary

    def _categorize_states(self, config: Dict[str, Any]):

        """Heuristic state categorization."""
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

        return specifiable, must_zero, arbitrary

    def _build_conditions_explanation(self, specifiable, must_zero, arbitrary, n_u):
        """Build explanation string for operating conditions."""
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

    def validate_only(self, config: SystemConfig, run_config: dict = None):
        """
        Validate and complete an existing config without re-parsing.

        Args:
            config: Existing system configuration
            run_config: Optional execution config (e.g., callbacks)

        Returns:
            Validated and completed configuration, or None if validation fails
        """
        # Create a state that starts with the existing config as parsed_config
        parsing_state: GraphState = {
            "input_text": "",  # Not used
            "parsed_config": config,
            "final_config": None
        }

        # Call _validate_config directly
        result_state = self._validate_config(parsing_state, run_config=run_config)
        return result_state.get("final_config")


    def build_initial_state(self, input_dict):
        initial_state = GraphState()
        initial_config = SystemConfig()

        initial_state["ui_mode"] = input_dict["ui_mode"]
        if "equation" in input_dict:
            initial_state["equation"] = input_dict["equation"]
        if "input_text" in input_dict:
            initial_state["input_text"] = input_dict["input_text"]
        if "ui_inputs" in input_dict:
            initial_state["ui_inputs"] = input_dict["ui_inputs"]

        if "operating_conditions" in input_dict:
            initial_config["operating_conditions"] = input_dict["operating_conditions"]

        initial_state["parsed_config"] = initial_config

        return initial_state