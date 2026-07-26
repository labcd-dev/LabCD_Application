import json
import re
import numpy as np
from typing import Dict, Any
from datetime import datetime
from backend_api.SiloDesigner.src.utils import log_to_file
from langchain_core.messages import AIMessage
import yaml
import os
import time
from langchain_openai import ChatOpenAI
from langchain_groq import ChatGroq
from langchain_cerebras import ChatCerebras
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from dotenv import load_dotenv
load_dotenv()

# Set API keys
os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY")
os.environ["GROQ_API_KEY"] = os.getenv("GROQ_API_KEY")
os.environ["CEREBRAS_API_KEY"] = os.getenv("CEREBRAS_API_KEY")
os.environ["NVIDIA_API_KEY"] = os.getenv("NVIDIA_API_KEY")

# Set random seed for reproducibility
np.random.seed(42)


def extract_json_from_response(response_text: str) -> Dict[str, Any]:
    """
    Extract JSON from LLM response that may contain thinking tags and markdown formatting.

    This function handles responses in formats like:
    - Plain JSON: {"key": "value"}
    - Markdown JSON: ```json\n{"key": "value"}\n```
    - With thinking: <think>...</think>\n```json\n{"key": "value"}\n```
    """
    if not response_text:
        raise json.JSONDecodeError("Empty response", "", 0)

    # Remove thinking tags and their content
    response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL)

    # Try to find JSON within markdown code blocks
    json_pattern = r'```json\s*\n?(.*?)\n?```'
    json_match = re.search(json_pattern, response_text, re.DOTALL)

    if json_match:
        json_text = json_match.group(1).strip()
    else:
        # Try to find JSON without markdown formatting
        # Look for content that starts with { and ends with }
        brace_pattern = r'\{.*\}'
        brace_match = re.search(brace_pattern, response_text, re.DOTALL)

        if brace_match:
            json_text = brace_match.group(0).strip()
        else:
            # Last resort: use the entire cleaned response
            json_text = response_text.strip()

    try:
        return json.loads(json_text)
    except json.JSONDecodeError as e:
        # Log the problematic text for debugging
        log_to_file(f"Failed to parse JSON. Original response: {repr(response_text)}")
        log_to_file(f"Extracted JSON text: {repr(json_text)}")
        raise e


def formatted_log(agent_name, prompt, response):
    """Create a formatted log entry with timestamp, agent, prompt and response"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    log_message = f"""
================================================================================
TIMESTAMP: [{timestamp}]
AGENT: [{agent_name}]
--------------------------------------------------------------------------------
PROMPT:
{prompt}

--------------------------------------------------------------------------------
RESPONSE:
{response}

================================================================================
"""
    log_to_file(log_message)


def round_floats(obj, decimals=4):
    """Recursively round float values in a nested structure (dict/list) to specified decimals."""
    if isinstance(obj, float):
        return round(obj, decimals)
    elif isinstance(obj, dict):
        return {k: round_floats(v, decimals) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [round_floats(item, decimals) for item in obj]
    return obj


class LLMBaseAgent:
    """Base class for all LLM agents in the control system"""

    def __init__(self, model="deepseek-r1-distill-llama-70b", temperature=0.0, seed=42, monitor=None):
        self.model = model
        self.llm = self._initialize_llm_client(model, temperature, seed)
        self.agent_name = self.__class__.__name__
        self.monitor = monitor

    def _initialize_llm_client(self, model, temperature, seed):
        """Initialize the appropriate LLM client based on the model name"""

        # OpenAI models
        openai_models = [
            "gpt-5.5", "gpt-5.4", "gpt-5.4-mini",
            "gpt-3.5-turbo", "gpt-3.5-turbo-0125", "gpt-3.5-turbo-1106",
            "gpt-4", "gpt-4-turbo", "gpt-4-turbo-preview", "gpt-4-0125-preview",
            "gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini"
        ]

        # Groq models
        groq_models = [
            "deepseek-r1-distill-llama-70b", "deepseek-r1-distill-qwen-32b",
            "llama-3.3-70b-versatile", "llama-3.2-90b-text-preview",
            "llama-3.2-11b-text-preview", "llama-3.2-3b-preview", "llama-3.2-1b-preview",
            "llama3-groq-70b-8192-tool-use-preview", "llama3-groq-8b-8192-tool-use-preview",
            "llama-3.1-70b-versatile", "llama-3.1-8b-instant",
            "mixtral-8x7b-32768", "gemma2-9b-it", "gemma-7b-it"#,"openai/gpt-oss-20b", "groq/compound"
        ]

        # Cerebras models
        cerebras_models = [
            "gpt-oss-120b", "llama-3.3-70b", "qwen-3-32b", "llama3.1-8b"
        ]

        # NVIDIA models (detected by provider prefix)
        nvidia_prefixes = [
            "aisingapore/", "databricks/", "google/", "ibm/", "meta/", "microsoft/",
            "mistralai/", "seallms/", "snowflake/", "openai/", "deepseek-ai/"
        ]

        if any(openai_model in model for openai_model in openai_models):
            return ChatOpenAI(
                model=model,
                temperature=temperature,
                seed=seed,
                model_kwargs={
                    "response_format": {"type": "json_object"} if "gpt-" in model else {}
                }
            )
        elif any(groq_model in model for groq_model in groq_models):
            return ChatGroq(
                model=model,
                temperature=temperature,
                model_kwargs={
                    "seed": seed
                }
            )
        elif any(cerebras_model in model for cerebras_model in cerebras_models):
            return ChatCerebras(
                model=model,
                temperature=temperature,
                seed=seed,
                max_tokens=None,
                timeout=None,
                max_retries=2
            )
        elif any(prefix in model for prefix in nvidia_prefixes):
            return ChatNVIDIA(
                model=model,
                temperature=temperature,
                model_kwargs={
                    "seed": seed  # Note: seed support may vary; check NVIDIA docs
                }
            )
        else:
            # Default to Groq for unknown models (backward compatibility)
            print(f"Warning: Unknown model '{model}', defaulting to Groq client")
            return ChatGroq(
                model=model,
                temperature=temperature,
                model_kwargs={
                    "seed": seed
                }
            )

    def _ensure_running(self) -> None:
        if self.monitor is not None and not getattr(self.monitor, "is_running", True):
            from backend_api.SiloDesigner.app import DesignCancelledError

            raise DesignCancelledError("Design cancelled by user")

    def invoke_llm(self, system_prompt, user_prompt, max_retries=3):
        """Invoke LLM with separate system and user prompts, retry logic and logging"""
        for attempt in range(max_retries):
            try:
                self._ensure_running()

                # Log the prompts
                if attempt > 0:
                    log_to_file(f"Retry attempt {attempt + 1}/{max_retries} for {self.agent_name}")

                # Create messages with system and user prompts
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]

                # NEW: Measure LLM inference time
                llm_start_time = time.time()
                response = self.llm.invoke(messages)
                llm_duration = time.time() - llm_start_time

                # Handle response format
                if isinstance(response, AIMessage):
                    response_text = response.content
                    # Extract usage metadata with better fallback handling
                    if hasattr(response, 'usage_metadata') and response.usage_metadata:
                        usage = {
                            'prompt_tokens': response.usage_metadata.get('input_tokens', 0),
                            'completion_tokens': response.usage_metadata.get('output_tokens', 0)
                        }
                    elif hasattr(response, 'response_metadata') and response.response_metadata:
                        # Some providers put usage in response_metadata
                        usage_data = response.response_metadata.get('usage', {})
                        usage = {
                            'prompt_tokens': usage_data.get('prompt_tokens', 0),
                            'completion_tokens': usage_data.get('completion_tokens', 0)
                        }
                    else:
                        usage = {'prompt_tokens': 0, 'completion_tokens': 0}
                else:
                    response_text = str(response)
                    usage = {'prompt_tokens': 0, 'completion_tokens': 0}

                # NEW: Add LLM inference duration to usage
                usage['llm_time'] = llm_duration

                # Log the interaction with usage info
                formatted_log(self.agent_name, f"System: {system_prompt}\nUser: {user_prompt}",
                              f"{response_text}\n\n[Usage: {usage['prompt_tokens']} in, {usage['completion_tokens']} out, {llm_duration:.2f}s LLM time]")

                # Add to monitor if available
                if self.monitor:
                    full_prompt = f"System: {system_prompt}\n\nUser: {user_prompt}"
                    truncated_prompt = full_prompt[:200] + "..." if len(full_prompt) > 200 else full_prompt
                    self.monitor.add_llm_response(self.agent_name, truncated_prompt, response_text)

                return response_text, usage

            except Exception as e:
                # NEW: Accumulate retry time as well (though minimal)
                llm_duration = time.time() - (time.time() - 0.01)  # Approximate minimal overhead for failed attempt
                log_to_file(
                    f"âŒError invoking LLM (attempt {attempt + 1}/{max_retries}): {e} [~{llm_duration:.2f}s overhead]",
                    True)
                if attempt == max_retries - 1:
                    raise e

        return None, {'prompt_tokens': 0, 'completion_tokens': 0, 'llm_time': 0.0}

    # NEW: Compute cost based on model and tokens (price_table in $/1M tokens)
    def _compute_cost(self, in_tokens: int, out_tokens: int) -> float:
        """Compute cost based on model and tokens (price_table in $/1M tokens)"""
        price_table = {
            # OpenAI models
            "gpt-4o": {"in": 3.0, "out": 10.0},
            "gpt-4o-mini": {"in": 0.15, "out": 0.60},

            # Groq Llama variants
            "llama3.1-8b": {"in": 0.05, "out": 0.08},
            "llama-3.3-70b": {"in": 0.50, "out": 0.64},

            # Cerebras models
            "qwen-3-32b": {"in": 0.40, "out": 0.80},
            "gpt-oss-120b": {"in": 0.25, "out": 0.69},

            # DeepSeek
            "deepseek-r1-distill-llama-70b": {"in": 0.23, "out": 0.69},

            # Placeholders
            "llama-3.1-70b": {"in": 0.59, "out": 0.79},
            "qwen-3-max": {"in": 1.20, "out": 6.00},

            # NVIDIA models (add more as needed)
            "llama-4-maverick": {"in": 0.50, "out": 0.64},  # Estimated, adjust based on actual pricing
            "llama-3": {"in": 0.50, "out": 0.64},  # Fallback for Llama 3.x variants
            "llama3": {"in": 0.50, "out": 0.64},  # Alternative naming
            "llama-4": {"in": 0.60, "out": 0.80},  # Fallback for Llama 4.x variants
            "llama4": {"in": 0.60, "out": 0.80},  # Alternative naming
        }

        model_name = getattr(self, "model", "unknown").lower()

        # Remove vendor prefixes (e.g., "meta/", "nvidia/")
        if "/" in model_name:
            model_name = model_name.split("/", 1)[1]

        # Try exact match first
        if model_name in price_table:
            prices = price_table[model_name]
            cost = (prices["in"] * in_tokens + prices["out"] * out_tokens) / 1_000_000
            return cost

        # Try to extract base model name (e.g., "llama-4-maverick-17b-128e-instruct" -> "llama-4")
        # Pattern 1: "llama-X-something" -> "llama-X"
        llama_match = re.match(r'(llama-?\d+(?:\.\d+)?)', model_name)
        if llama_match:
            base_model = llama_match.group(1)
            if base_model in price_table:
                prices = price_table[base_model]
                cost = (prices["in"] * in_tokens + prices["out"] * out_tokens) / 1_000_000
                log_to_file(f"Using base model '{base_model}' pricing for '{self.model}'")
                return cost

        # Pattern 2: Try "llama-X-maverick" for maverick variants
        if "maverick" in model_name:
            maverick_match = re.match(r'(llama-\d+-maverick)', model_name)
            if maverick_match:
                base_model = maverick_match.group(1)
                if base_model in price_table:
                    prices = price_table[base_model]
                    cost = (prices["in"] * in_tokens + prices["out"] * out_tokens) / 1_000_000
                    log_to_file(f"Using maverick model '{base_model}' pricing for '{self.model}'")
                    return cost

        # If no match found, log warning and return 0
        log_to_file(f"Warning: No price for model '{self.model}'; cost=0. Consider adding to price_table.")
        return 0.0

    # NEW: Update buffer metrics if present (called after each successful invoke)
    def _update_metrics(self, buffer, usage):
        if (hasattr(buffer, 'current_scenario_metrics') and
                buffer.current_scenario_metrics is not None):
            m = buffer.current_scenario_metrics
            m['tokens_in'] += usage.get('prompt_tokens', 0)
            m['tokens_out'] += usage.get('completion_tokens', 0)
            m['time'] += usage.get('llm_time', 0.0)  # NEW: Accumulate LLM inference time
            m['cost'] += self._compute_cost(
                usage.get('prompt_tokens', 0),
                usage.get('completion_tokens', 0)
            )


class LLMActor(LLMBaseAgent):
    """Generalized LLM Actor that works with arbitrary parameter schemas"""

    def __init__(self, model, seed, yaml_file=None, monitor=None):
        super().__init__(model=model, temperature=0, seed=seed, monitor=monitor)
        self.parser = re.compile(r'{.*?}', re.DOTALL)

        # Compute absolute path to YAML file relative to this module
        if yaml_file is None:
            yaml_dir = os.path.dirname(__file__)
            yaml_file = os.path.join(yaml_dir, 'agents', 'actor.yaml')

        # Load prompts from YAML
        with open(yaml_file, 'r') as file:
            config = yaml.safe_load(file)
        self.system_prompt_template = config['system_prompt']
        self.user_prompt_template = config['user_prompt_template']

    def generate_parameters(self, buffer, controller_type, iter_number, max_iter,
                            system, max_retries=3):
        """Generate parameters for any system with any controller type"""

        # Get parameter schema from the system
        param_ranges = self._extract_parameter_ranges(buffer, controller_type, system)

        system_prompt, user_prompt = self._build_system_user_prompts(
            buffer, controller_type, iter_number, max_iter,
            system, param_ranges
        )

        # MODIFIED: Get usage from invoke_llm
        response_text, usage = self.invoke_llm(system_prompt, user_prompt, max_retries)
        # NEW: Update metrics for this call
        self._update_metrics(buffer, usage)

        params = self._parse_generalized_response(
            response_text, controller_type, param_ranges, system
        )

        # Retry logic for fallback responses
        if 'reasoning' in params and 'Fallback' in params['reasoning']:
            for attempt in range(max_retries):
                system_prompt, user_prompt = self._build_system_user_prompts(
                    buffer, controller_type, iter_number, max_iter,
                    system, param_ranges
                )
                # MODIFIED: Get usage
                response_text, usage = self.invoke_llm(system_prompt, user_prompt)
                # NEW: Update metrics for this retry call
                self._update_metrics(buffer, usage)
                params = self._parse_generalized_response(
                    response_text, controller_type, param_ranges, system
                )
                if 'reasoning' in params and 'Fallback' not in params['reasoning']:
                    return params
                log_to_file(f"â—ï¸Retry {attempt + 1}/{max_retries}: Failed to parse response", True)

        return params

    def _extract_parameter_ranges(self, buffer, controller_type, system):
        """Extract parameter ranges from buffer or system defaults"""
        if hasattr(buffer, 'param_ranges') and buffer.param_ranges:
            return buffer.param_ranges
        else:
            # Get default ranges from system
            return system.get_control_param_schema(controller_type)

    def _build_system_user_prompts(self, buffer, controller_type, iter_number,
                                   max_iter, system, param_ranges):
        """Build separate system and user prompts that adapt to any system and parameter schema"""

        system_prompt = self.system_prompt_template.format(
            controller_type=controller_type,
            system_name=buffer.system_name,
            system_description=buffer.system_description,
            control_objective=buffer.control_objective if buffer.control_objective else "Design a stable controller with minimal settling time, overshoot, and steady-state error.",
            num_states=system.num_states,
            state_variables=', '.join(system.state_names),
            control_inputs=', '.join(system.control_input_names),
            current_iteration=iter_number + 1,
            max_iter=max_iter
        )

        user_prompt = self._build_user_prompt_content(
            buffer, controller_type, iter_number, max_iter, system, param_ranges
        )

        return system_prompt, user_prompt

    def _build_user_prompt_content(self, buffer, controller_type, iter_number,
                                   max_iter, system, param_ranges):
        """Build the user prompt with specific task details"""

        # Get recent entries
        lambda_val = min(iter_number + 1, 50)
        recent_entries = buffer.get_entries(lambda_val)
        best_entries = buffer.get_best_entries(2)

        # Build controller_details
        controller_details = ""
        if controller_type == 'FSF':
            controller_details += f"""
    FULL-STATE FEEDBACK DETAILS:
    - Control gains: {', '.join([f'K{i + 1}' for i in range(system.num_states)])}
    - Control law: u = -K1*x1 - K2*x2 - ... - K{system.num_states}*x{system.num_states}"""
            for i, state_name in enumerate(system.state_names):
                controller_details += f"\n- K{i + 1} controls feedback from {state_name}"

        elif controller_type in ['P', 'PI', 'PD', 'PID']:
            controller_details += f"""
    {controller_type} CONTROLLER DETAILS:
    - Output feedback controller using {system.state_names[0]}"""
            if 'Kp' in param_ranges:
                controller_details += "\n- Kp: Proportional gain (response speed vs overshoot)"
            if 'Ki' in param_ranges:
                controller_details += "\n- Ki: Integral gain (steady-state error vs oscillations)"
            if 'Kd' in param_ranges:
                controller_details += "\n- Kd: Derivative gain (damping vs noise sensitivity)"

        # Build parameter_constraints
        parameter_constraints = ""
        if param_ranges:
            parameter_constraints += "\n\nPARAMETER CONSTRAINTS:"
            for param_name, range_info in param_ranges.items():
                if isinstance(range_info, dict):
                    min_val, max_val = range_info['min'], range_info['max']
                else:
                    min_val, max_val = range_info[0], range_info[1]
                parameter_constraints += f"\n- {param_name}: [{min_val:.4f}, {max_val:.4f}]"
            parameter_constraints += "\n\nALL PARAMETERS MUST BE WITHIN THESE RANGES."

        # Build recent_performance_history
        recent_performance_history = ""
        if recent_entries:
            recent_performance_history += f"\n\nRECENT PERFORMANCE HISTORY ({len(recent_entries)} attempts):"

            # Parameter trends
            recent_performance_history += "\nParameter Trends:"
            for param_name in param_ranges.keys():
                if param_name in recent_entries[0]['params']:
                    values = [entry['params'][param_name] for entry in recent_entries]
                    values_str = ' â†’ '.join([f'{val:.4f}' for val in values])
                    recent_performance_history += f"\n- {param_name}: {values_str}"

            # Performance metrics trends
            recent_performance_history += "\n\nPerformance Trends:"
            for metric in ['mse', 'settling_time', 'overshoot', 'zero_crossings',
                           'control_zero_crossings', 'control_effort', 'stable']:
                if metric in recent_entries[0]['metrics']:
                    metric_values = [entry['metrics'][metric] for entry in recent_entries]
                    if metric == 'settling_time':
                        values_str = ' â†’ '.join([f'{val:.2f}' if np.isfinite(val) else 'inf'
                                                 for val in metric_values])
                    elif metric in ['mse', 'overshoot', 'control_effort']:
                        values_str = ' â†’ '.join([f'{val:.4f}' for val in metric_values])
                    elif metric in ['zero_crossings', 'control_zero_crossings']:
                        values_str = ' â†’ '.join([str(int(val)) for val in metric_values])
                    elif metric == 'stable':
                        values_str = ' â†’ '.join(['Yes' if val else 'No' for val in metric_values])
                    recent_performance_history += f"\n- {metric.replace('_', ' ').title()}: {values_str}"

            # Latest feedback
            latest_entry = recent_entries[-1]
            if latest_entry['feedback']:
                try:
                    feedback_json = json.loads(latest_entry['feedback'])
                    strategy = feedback_json.get('strategy', 'EXPLORE')
                    analysis = feedback_json.get('result_analysis', 'No analysis')
                    suggestions = feedback_json.get('suggested_improvements', [])

                    recent_performance_history += f"\n\nLATEST FEEDBACK:"
                    recent_performance_history += f"\n- Strategy: {strategy}"
                    recent_performance_history += f"\n- Analysis: {analysis}"
                    if suggestions:
                        recent_performance_history += "\n- Suggestions:"
                        for s in suggestions:
                            recent_performance_history += f"\n  â€¢ {s}"
                except json.JSONDecodeError:
                    recent_performance_history += f"\n\nLATEST FEEDBACK:\n{latest_entry['feedback']}"

        # Build best_performing_attempts
        best_performing_attempts = ""
        if best_entries:
            best_performing_attempts += "\n\nBEST PERFORMING ATTEMPTS:"
            for i, entry in enumerate(best_entries, 1):
                best_performing_attempts += f"\n\nBest #{i} (Iteration #{entry.get('iteration', 'Unknown')}):"

                # Parameters
                param_strs = []
                for param_name, param_value in entry['params'].items():
                    if param_name != 'reasoning':
                        param_strs.append(f"{param_name}={param_value:.4f}")
                best_performing_attempts += f"\n- Parameters: {', '.join(param_strs)}"

                # Key metrics
                metrics = entry['metrics']
                best_performing_attempts += f"\n- Performance: MSE={metrics['mse']:.4f}, "
                best_performing_attempts += f"Settling Time={metrics['settling_time']:.2f}s, "
                best_performing_attempts += f"Stable={'Yes' if metrics['stable'] else 'No'}"

        # Build juror_feedback
        juror_feedback = ""
        if hasattr(buffer, 'latest_juror_feedback') and buffer.latest_juror_feedback:
            juror_feedback += f"\nRECENT JUROR FEEDBACK:\n{buffer.latest_juror_feedback}\n"
            juror_feedback += "Consider this feedback when proposing new parameters to refine your exploration within the current range.\n"

        # Build param_lines
        param_lines = ""
        for param_name in param_ranges.keys():
            param_lines += f'    "{param_name}": value,\n'
        param_lines = param_lines.rstrip(',\n')

        # Format the template
        user_prompt = self.user_prompt_template.format(
            controller_details=controller_details,
            parameter_constraints=parameter_constraints,
            recent_performance_history=recent_performance_history,
            best_performing_attempts=best_performing_attempts,
            juror_feedback=juror_feedback,
            param_lines=param_lines
        )

        return user_prompt


    def _parse_generalized_response(self, response, controller_type, param_ranges, system):
        """Parse response for arbitrary parameter schemas"""
        try:
            params = extract_json_from_response(response)

            # Initialize result with expected parameters
            result_params = {}

            # Process each parameter in the schema
            for param_name, range_info in param_ranges.items():
                if param_name in params:
                    value = float(params[param_name])

                    # Apply range constraints
                    if isinstance(range_info, dict):
                        min_val, max_val = range_info['min'], range_info['max']
                    else:
                        min_val, max_val = range_info[0], range_info[1]

                    result_params[param_name] = max(min(value, max_val), min_val)
                else:
                    # Use default value (midpoint of range) if parameter missing
                    if isinstance(range_info, dict):
                        min_val, max_val = range_info['min'], range_info['max']
                    else:
                        min_val, max_val = range_info[0], range_info[1]
                    result_params[param_name] = (min_val + max_val) / 2

            result_params['reasoning'] = params.get('reasoning', 'Parsed from response')
            return result_params

        except Exception as e:
            log_to_file(f"â—ï¸Error parsing actor response: {e}", True)

            # Fallback: use midpoint of each parameter range
            result_params = {}
            for param_name, range_info in param_ranges.items():
                if isinstance(range_info, dict):
                    min_val, max_val = range_info['min'], range_info['max']
                else:
                    min_val, max_val = range_info[0], range_info[1]
                result_params[param_name] = (min_val + max_val) / 2

            result_params['reasoning'] = 'Fallback due to parsing error'
            return result_params


class LLMCritic(LLMBaseAgent):
    """LLM that analyzes controller performance and provides structured feedback"""

    def __init__(self, model, seed, yaml_file=None, monitor=None):
        super().__init__(model=model, temperature=0, seed=seed, monitor=monitor)
        self.parser = re.compile(r'{.*?}', re.DOTALL)  # Pattern to extract JSON

        # Compute absolute path to YAML file relative to this module
        if yaml_file is None:
            yaml_dir = os.path.dirname(__file__)
            yaml_file = os.path.join(yaml_dir, 'agents', 'critic.yaml')

        # Load prompts from YAML
        with open(yaml_file, 'r') as file:
            config = yaml.safe_load(file)
        self.system_prompt = config['system_prompt']
        self.user_prompt_template = config['user_prompt_template']


    def analyze_results(self, current_params, current_metrics, current_data, buffer, target_metrics, iter_number,
                        max_iter):
        """Analyze controller performance with trends and exploration/exploitation guidance"""
        # Sample trajectory data
        n_samples = 10
        trajectory_len = len(current_data['trajectory'])
        if trajectory_len == 0:
            trajectory_sample = []
            control_sample = []
            errors_sample = []
        else:
            indices = np.linspace(0, trajectory_len - 1, num=n_samples, dtype=int, endpoint=False)
            trajectory_sample = current_data['trajectory'][indices].tolist()
            control_sample = current_data['control_signals'][indices].tolist()
            errors_sample = current_data['errors'][indices].tolist()

        # Define lambda and get recent entries
        lambda_val = min(iter_number + 1, 50)  # cap at 50
        recent_entries = buffer.get_entries(lambda_val)
        param_keys = [k for k in current_params if k != 'reasoning']
        metric_keys = list(current_metrics.keys())

        # Format trend text
        if recent_entries:
            param_trends = {}
            for param in param_keys:
                values = [entry['params'].get(param, 'N/A') for entry in recent_entries]
                param_trends[param] = " â†’ ".join(
                    [f"{v:.4f}" if isinstance(v, (int, float)) else str(v) for v in values])

            metric_trends = {}
            for metric in metric_keys:
                values = [entry['metrics'].get(metric, 'N/A') for entry in recent_entries]
                metric_trends[metric] = " â†’ ".join(
                    [f"{v:.4f}" if isinstance(v, (int, float)) else str(v) for v in values])

            trend_text = f"TREND FROM PREVIOUS {len(recent_entries)} RESULTS:\n"
            trend_text += "Parameters:\n"
            for param, trend in param_trends.items():
                trend_text += f"{param}: {trend}\n"
            trend_text += "\nMetrics:\n"
            for metric, trend in metric_trends.items():
                trend_text += f"{metric}: {trend}\n"
        else:
            trend_text = "No previous attempts available."

        # Get system information from buffer to determine parameter structure
        system = getattr(buffer, 'system', None)
        controller_type = buffer.controller_type

        # Get permissible parameter ranges from buffer
        param_ranges = {}
        if hasattr(buffer, 'param_ranges') and buffer.param_ranges:
            param_ranges = buffer.param_ranges
        elif system:
            # Fallback to system's parameter schema if available
            try:
                param_ranges = {k: [v['min'], v['max']] for k, v in
                                system.get_control_param_schema(controller_type).items()}
            except:
                param_ranges = {}

        # Format permissible parameter ranges - GENERALIZED
        ranges_text = "PERMISSIBLE PARAMETER RANGES:\n"
        if controller_type in ['P', 'PI', 'PD', 'PID']:
            # PID controller parameters
            for param in ['Kp', 'Ki', 'Kd']:
                if param in param_ranges:
                    ranges_text += f"- {param}: [{param_ranges[param][0]:.2f}, {param_ranges[param][1]:.2f}]\n"
        elif controller_type == 'FSF':
            # Full-state feedback - generalized for any number of states
            # Sort FSF parameters by their numeric suffix for consistent display
            fsf_params = {k: v for k, v in param_ranges.items() if k.startswith('K')}
            sorted_fsf_params = sorted(fsf_params.items(), key=lambda x: int(x[0][1:]) if x[0][1:].isdigit() else 0)
            for param, range_vals in sorted_fsf_params:
                ranges_text += f"- {param}: [{range_vals[0]:.2f}, {range_vals[1]:.2f}]\n"
        else:
            # Generic case - display all parameters
            for param, range_vals in param_ranges.items():
                ranges_text += f"- {param}: [{range_vals[0]:.2f}, {range_vals[1]:.2f}]\n"

        # Get best performance
        best_entries = buffer.get_best_entries(1)
        if best_entries:
            best_params = best_entries[0]['params']
            best_metrics = best_entries[0]['metrics']

            # Format best parameters - generalized
            best_param_str = ', '.join([f"{k} = {v:.4f}" for k, v in best_params.items() if k != 'reasoning'])

            best_params_text = f"""
BEST PERFORMANCE SO FAR:
Parameters:
{best_param_str}

Metrics:
- Mean Squared Error: {best_metrics['mse']:.4f}
- Settling Time: {best_metrics['settling_time']:.2f}s
- Maximum Overshoot: {best_metrics['overshoot']:.2f} percent
- Zero-Crossings: {best_metrics['zero_crossings']}
- Control Effort: {best_metrics['control_effort']:.4f}
- System Stable: {'Yes' if best_metrics['stable'] else 'No'}
"""
        else:
            best_params = None
            best_metrics = None
            best_params_text = "No best performance yet."

        # Determine exploration vs exploitation strategy
        progress_ratio = (iter_number + 1) / max_iter
        mse_threshold = target_metrics['mse'] * 1.5  # 50% worse than target
        if (progress_ratio < 0.3 or not current_metrics['stable'] or
                current_metrics['mse'] > mse_threshold):
            strategy = "EXPLORE"
        elif (progress_ratio > 0.7 and current_metrics['stable'] and
              best_metrics and current_metrics['mse'] < best_metrics['mse'] * 1.1):
            strategy = "EXPLOIT"
        else:
            strategy = "EXPLORE" if current_metrics['mse'] > best_metrics['mse'] else "exploit"

        strategy_text = (
            f"IMPORTANT: At iteration {iter_number + 1} of {max_iter}, the recommended strategy is to {strategy}. "
            f"Early in the process (first 30% of iterations) or with poor performance, EXPLORE the FULL RANGE of permissible parameters. "
            f"Later with stable and near-optimal performance, EXPLOIT by fine-tuning around the best parameters.")

        # Format current parameters - generalized
        current_param_str = ', '.join([f"{k} = {v:.4f}" for k, v in current_params.items() if k != 'reasoning'])

        # Create system prompt
        system_prompt = self.system_prompt.format(
            system_name=buffer.system_name or "Unknown",
            system_description=buffer.system_description or "No description available",
            control_objective=buffer.control_objective or "Design a stable controller with minimal settling time, overshoot, and steady-state error."
        )

        # Create user prompt
        user_prompt = self.user_prompt_template.format(
            current_iteration=iter_number + 1,
            max_iter=max_iter,
            ranges_text=ranges_text,
            current_param_str=current_param_str,
            trend_text=trend_text,
            best_params_text=best_params_text,
            mse=f"{current_metrics['mse']:.4f}",
            target_mse=f"{target_metrics['mse']:.4f}",
            settling_time=f"{current_metrics['settling_time']:.2f}",
            target_settling_time=f"{target_metrics['settling_time']:.2f}",
            overshoot=f"{current_metrics['overshoot']:.2f}",
            target_overshoot=f"{target_metrics['overshoot']:.4f}",
            zero_crossings=current_metrics['zero_crossings'],
            control_zero_crossings=current_metrics['control_zero_crossings'],
            control_effort=f"{current_metrics['control_effort']:.4f}",
            stable='Yes' if current_metrics['stable'] else 'No',
            strategy_text=strategy_text
        )

        # MODIFIED: Capture usage and update metrics
        response_text, usage = self.invoke_llm(system_prompt, user_prompt)
        # NEW: Update buffer metrics for this call
        self._update_metrics(buffer, usage)

        # Parse the response (unchanged)
        try:
            parsed_feedback = extract_json_from_response(response_text)
            return json.dumps(parsed_feedback)
        except Exception as e:
            log_to_file(f"â—ï¸Error parsing critic response: {e}", True)
            fallback_feedback = {
                "result_analysis": "Analysis could not be parsed. System appears functional with current parameters.",
                "suggested_improvements": [
                    "Consider small parameter adjustments based on metrics",
                    "Manually review system response for insights"
                ]
            }
            return json.dumps(fallback_feedback)

    def get_best_performance(self):
        """Helper method to get the best performance from buffer.
        In actual implementation, this would access the buffer."""
        # This is a placeholder - in real implementation,
        # you would need to either pass the buffer in or have it accessible
        return None, None


class LLMTerminator(LLMBaseAgent):
    """LLM that judges whether to terminate or continue optimization"""

    def __init__(self, model, seed, yaml_file=None, monitor=None):
        super().__init__(model=model, temperature=0, seed=seed, monitor=monitor)

        # Compute absolute path to YAML file relative to this module
        if yaml_file is None:
            yaml_dir = os.path.dirname(__file__)
            yaml_file = os.path.join(yaml_dir, 'agents', 'terminator.yaml')

        # Load prompts from YAML
        with open(yaml_file, 'r') as file:
            config = yaml.safe_load(file)
        self.system_prompt = config['system_prompt']
        self.user_prompt_template = config['user_prompt_template']

    def create_system_prompt(self, system_name, system_description, control_objective):
        """Create the system prompt for the termination judge"""
        return self.system_prompt.format(
            system_name=system_name or "Unknown",
            system_description=system_description or "No description available",
            control_objective=control_objective or "Design a stable controller with minimal settling time, overshoot, and steady-state error."
        )

    def create_user_prompt(self, buffer, current_metrics, target_metrics, max_iterations, controller_type,
                           system_description, num_iter):
        """Create the user prompt with specific optimization context"""
        # Get recent performance trend
        recent_entries = buffer.get_entries(min(5, len(buffer.history)))

        # Create trend text similar to LLMCritic
        if recent_entries:
            # Define metric keys to display
            metric_keys = ['mse', 'settling_time', 'overshoot', 'stable', 'zero_crossings', 'control_effort',
                           'control_zero_crossings']

            # Extract parameter keys (if available)
            param_keys = []
            if recent_entries[0].get('params'):
                param_keys = [k for k in recent_entries[0]['params'] if k != 'reasoning']

            # Format parameter trends
            param_trends = {}
            for param in param_keys:
                values = [entry['params'].get(param, 'N/A') for entry in recent_entries]
                param_trends[param] = " â†’ ".join(
                    [f"{v:.4f}" if isinstance(v, (int, float)) else str(v) for v in values])

            # Format metric trends
            metric_trends = {}
            for metric in metric_keys:
                values = []
                for entry in recent_entries:
                    value = entry['metrics'].get(metric, 'N/A')
                    if metric == 'settling_time' and not np.isfinite(value):
                        value = 'inf'
                    elif isinstance(value, (int, float)):
                        value = f"{value:.4f}" if metric != 'settling_time' else f"{value:.2f}"
                    else:
                        value = str(value)
                    values.append(value)
                metric_trends[metric] = " â†’ ".join(values)

            # Build trend text
            trend_text = f"TREND FROM PREVIOUS {len(recent_entries)} RESULTS:\n"
            if param_trends:
                trend_text += "Parameters:\n"
                for param, trend in param_trends.items():
                    trend_text += f"{param}: {trend}\n"
            trend_text += "\nMetrics:\n"
            for metric, trend in metric_trends.items():
                trend_text += f"{metric}: {trend}\n"
        else:
            trend_text = "No previous attempts available."

        # Calculate improvement trends if we have multiple entries
        improvement_data = {}
        if len(recent_entries) >= 2:
            first = recent_entries[0]['metrics']
            last = recent_entries[-1]['metrics']

            # Convert metrics to floats
            mse_first = float(first['mse'])
            settling_time_first = float(first['settling_time']) if np.isfinite(first['settling_time']) else float('inf')
            overshoot_first = float(first['overshoot'])
            mse_last = float(last['mse'])
            settling_time_last = float(last['settling_time']) if np.isfinite(last['settling_time']) else float('inf')
            overshoot_last = float(last['overshoot'])

            improvement_data = {
                "mse_change": ((mse_first - mse_last) / mse_first) * 100 if mse_first > 0 else 0,
                "settling_time_change": (
                    ((settling_time_first - settling_time_last) / settling_time_first * 100)
                    if (settling_time_first > 0 and np.isfinite(settling_time_first) and np.isfinite(
                        settling_time_last)) else 0
                ),
                "overshoot_change": ((
                                                 overshoot_first - overshoot_last) / overshoot_first) * 100 if overshoot_first > 0 else 0,
                "iterations_analyzed": len(recent_entries)
            }

        # Parameter convergence analysis
        param_convergence_data = {}
        if len(recent_entries) >= 2 and param_keys:
            param_changes = {}
            for param in param_keys:
                values = [entry['params'].get(param, 0) for entry in recent_entries if
                          isinstance(entry['params'].get(param), (int, float))]
                if len(values) >= 2:
                    # Calculate percentage change between consecutive iterations
                    changes = [
                        abs(values[i] - values[i - 1]) / abs(values[i - 1]) * 100 if abs(values[i - 1]) > 0 else 0 for i
                        in range(1, len(values))]
                    avg_change = sum(changes) / len(changes) if changes else 0
                    param_changes[param] = avg_change
            param_convergence_data = {
                "parameter_changes": param_changes,
                "max_change_percent": max(param_changes.values()) if param_changes else 0,
                "converged": all(change < 10 for change in param_changes.values()) if param_changes else False,
                "iterations_analyzed": len(recent_entries)
            }

        # Determine current iteration and minimum required iterations
        current_iteration = buffer.history[-1]['iteration'] if buffer.history else 0  # This is Global iteration number
        min_iterations_required = min(6, max(max_iterations // 4, 4))

        # Extract critic's strategy
        critic_strategy = "UNKNOWN"
        if buffer.history:
            latest_entry = buffer.history[-1]
            latest_feedback = latest_entry.get('feedback')
            if latest_feedback:
                try:
                    feedback_json = json.loads(latest_feedback)
                    critic_strategy = feedback_json.get("strategy", "UNKNOWN")
                except json.JSONDecodeError:
                    critic_strategy = "UNKNOWN"

        rounded_improvement_data = round_floats(improvement_data) if improvement_data else None
        rounded_param_convergence_data = round_floats(param_convergence_data) if param_convergence_data else None

        # Compute settling time display and status
        settling_time_display = 'Failed to settle' if not np.isfinite(
            current_metrics['settling_time']) else f"{current_metrics['settling_time']:.2f}s"
        settling_time_status = 'SUCCESS' if np.isfinite(current_metrics['settling_time']) and current_metrics[
            'settling_time'] <= target_metrics['settling_time'] else 'NOT YET'

        # Build additional variables for formatting
        mse = f"{current_metrics['mse']:.6f}"
        mse_status = 'SUCCESS' if current_metrics['mse'] <= target_metrics['mse'] else 'NOT YET'
        target_mse = f"{target_metrics['mse']:.6f}"
        target_settling_time = f"{target_metrics['settling_time']:.2f}"
        overshoot = f"{current_metrics['overshoot']:.4f}"
        overshoot_status = 'SUCCESS' if current_metrics['overshoot'] <= target_metrics['overshoot'] else 'NOT YET'
        target_overshoot = f"{target_metrics['overshoot']:.4f}"
        stable = 'Yes' if current_metrics['stable'] else 'No'
        zero_crossings = current_metrics['zero_crossings']
        control_effort = f"{current_metrics['control_effort']:.4f}"
        control_zero_crossings = current_metrics['control_zero_crossings']
        improvement_analysis = json.dumps(rounded_improvement_data,
                                          indent=2) if improvement_data else 'No improvement data available.'
        parameter_convergence_analysis = json.dumps(rounded_param_convergence_data,
                                                    indent=2) if param_convergence_data else 'No parameter convergence data available.'

        # Format the template
        return self.user_prompt_template.format(
            system_description=system_description,
            num_iter=num_iter,
            max_iterations=max_iterations,
            controller_type=controller_type,
            min_iterations_required=min_iterations_required,
            target_mse=target_mse,
            target_settling_time=target_settling_time,
            target_overshoot=target_overshoot,
            mse=mse,
            mse_status=mse_status,
            settling_time_display=settling_time_display,
            settling_time_status=settling_time_status,
            overshoot=overshoot,
            overshoot_status=overshoot_status,
            stable=stable,
            zero_crossings=zero_crossings,
            control_effort=control_effort,
            control_zero_crossings=control_zero_crossings,
            critic_strategy=critic_strategy,
            trend_text=trend_text,
            improvement_analysis=improvement_analysis,
            parameter_convergence_analysis=parameter_convergence_analysis
        )

    def judge_termination(self, buffer, current_metrics, target_metrics, max_iterations, controller_type,
                          system_description, num_iter):
        """Judge whether optimization should terminate"""
        # Create system and user prompts
        system_prompt = self.create_system_prompt(
            buffer.system_name,
            buffer.system_description,
            buffer.control_objective
        )
        user_prompt = self.create_user_prompt(buffer, current_metrics, target_metrics, max_iterations, controller_type,
                                              system_description, num_iter)

        # MODIFIED: Capture usage and update metrics
        response_text, usage = self.invoke_llm(system_prompt, user_prompt)
        # NEW: Update buffer metrics for this call
        self._update_metrics(buffer, usage)

        # Determine current iteration and minimum required iterations
        current_iteration = buffer.history[-1]['iteration'] if buffer.history else 0
        min_iterations_required = min(6, max(max_iterations // 4, 4))

        # Extract JSON data
        try:
            termination_data = extract_json_from_response(response_text)

            # Force CONTINUE if iteration count is too low
            if current_iteration < min_iterations_required:
                if termination_data["decision"] != "CONTINUE":
                    termination_data["decision"] = "CONTINUE"
                    termination_data["reasoning"] = (
                            f"Modified decision to CONTINUE because iteration count ({current_iteration}) "
                            f"is below minimum required ({min_iterations_required}). " + termination_data[
                                "reasoning"]
                    )

            return termination_data, response_text
        except Exception as e:
            log_to_file(f"â—ï¸Error parsing termination JSON: {e}", True)
            backup_decision = {
                "decision": "CONTINUE",
                "reasoning": f"â—ï¸Error parsing response: {str(e)}. Continuing by default.",
                "recommendations": "Fix JSON parsing error in LLM response."
            }
            return backup_decision, response_text

class LLMJuror(LLMBaseAgent):

    def __init__(self, model, seed, max_tries=2, yaml_file=None, monitor=None):
        super().__init__(model=model, seed=seed, temperature=0, monitor=monitor)
        self.max_tries = max_tries

        # Compute absolute path to YAML file relative to this module
        if yaml_file is None:
            yaml_dir = os.path.dirname(__file__)
            yaml_file = os.path.join(yaml_dir, 'agents', 'juror.yaml')

        # Load prompts from YAML
        with open(yaml_file, 'r') as file:
            config = yaml.safe_load(file)
        self.system_prompt = config['system_prompt']
        self.user_prompt_template = config['user_prompt_template']

    def decide(self, state: Dict) -> Dict:
        """Make a decision about controller parameter exploration using LLM reasoning."""
        buffer = state['buffer']
        controller_type = state['controller_type']
        param_ranges = buffer.param_ranges

        # Track range reconsideration count
        range_reconsider_count = state.get('range_reconsider_count', {}).get(controller_type, 0)

        # HARDCODED DECISION: If max_tries reached, approve redesign without consulting LLM
        if range_reconsider_count >= self.max_tries:
            return {
                "decision": "REDESIGN_APPROVED",
                "new_range": None,
                "reasoning": f"Max tries ({self.max_tries}) reached for {controller_type}. Approving controller redesign."
            }

        # Prepare data for LLM analysis
        analysis_data = self._prepare_analysis_data(buffer, param_ranges, controller_type, range_reconsider_count)

        # MODIFIED: Pass buffer to _call_llm_for_judgment for metrics
        result = self._call_llm_for_judgment(analysis_data, buffer)

        # Process LLM response
        decision_data = self._process_llm_response(result, param_ranges)

        # Update reconsideration count if needed
        if decision_data["decision"] == "RECONSIDER_RANGE":
            if 'range_reconsider_count' not in state:
                state['range_reconsider_count'] = {}
            state['range_reconsider_count'][controller_type] = range_reconsider_count + 1

        return decision_data

    def _prepare_analysis_data(self, buffer, param_ranges, controller_type, range_reconsider_count):
        """Prepare the data for LLM analysis."""
        history = buffer.history
        if not history:
            return {
                "controller_type": controller_type,
                "param_ranges": param_ranges,
                "history": [],
                "summary": {"message": "No history available"},
                "range_reconsider_count": range_reconsider_count,
                "system_name": buffer.system_name,
                "system_description": buffer.system_description,
                "control_objective": buffer.control_objective,
            }

        # Extract tried parameters and metrics
        tried_params = []
        for entry in history:
            param_entry = {k: v for k, v in entry['params'].items() if k not in ['reasoning']}
            metrics_entry = {
                "mse": entry['metrics'].get('mse', float('inf')),
                "settling_time": entry['metrics'].get('settling_time', float('inf')),
                "rise_time": entry['metrics'].get('rise_time', float('inf')),
                "overshoot": entry['metrics'].get('overshoot', float('inf')),
                "stable": entry['metrics'].get('stable', False)
            }
            tried_params.append({"params": param_entry, "metrics": metrics_entry})

        # Calculate parameter statistics
        param_stats = {}
        for param in param_ranges:
            values = [p["params"][param] for p in tried_params if param in p["params"]]
            if values:
                param_stats[param] = {
                    'min': min(values),
                    'max': max(values),
                    'mean': sum(values) / len(values),
                    'std': np.std(values),
                    'values': values,
                    'range': param_ranges[param]
                }

        # Best performance metrics
        best_entry = None
        best_mse = float('inf')
        for entry in tried_params:
            if entry["metrics"]["stable"] and entry["metrics"]["mse"] < best_mse:
                best_mse = entry["metrics"]["mse"]
                best_entry = entry

        return {
            "controller_type": controller_type,
            "param_ranges": param_ranges,
            "history": tried_params,
            "param_stats": param_stats,
            "best_performance": best_entry,
            "num_iterations": len(history),
            "range_reconsider_count": range_reconsider_count
        }

    def _call_llm_for_judgment(self, analysis_data, buffer):  # MODIFIED: Add buffer param
        """Call the LLM to make a judgment about parameter exploration."""
        system_prompt = self.system_prompt.format(
            system_name=analysis_data.get("system_name", "Unknown"),
            system_description=analysis_data.get("system_description", "No description available"),
            control_objective=analysis_data.get("control_objective",
                                                "Design a stable controller with minimal settling time, overshoot, and steady-state error.")
        )
        user_prompt = self._create_user_prompt(analysis_data)

        # MODIFIED: Capture usage and update metrics
        response, usage = self.invoke_llm(system_prompt, user_prompt)
        # NEW: Update buffer metrics for this call
        self._update_metrics(buffer, usage)

        return response

    def _create_user_prompt(self, data):
        """Create the user prompt for the LLM to judge parameter exploration."""
        controller_type = data["controller_type"]
        param_ranges = data["param_ranges"]
        param_stats = data.get("param_stats", {})
        best_performance = data.get("best_performance")
        range_reconsider_count = data.get("range_reconsider_count", 0)
        num_iterations = data["num_iterations"]

        # Round floats as in original
        rounded_param_stats = round_floats(param_stats) if param_stats else {}
        rounded_best_performance = round_floats(best_performance) if best_performance else None

        # Build strings for formatting
        current_parameter_ranges = json.dumps(param_ranges, indent=2)
        parameter_exploration_statistics = json.dumps(rounded_param_stats,
                                                      indent=2) if rounded_param_stats else "No exploration statistics available"
        best_performance_achieved = json.dumps(rounded_best_performance,
                                               indent=2) if rounded_best_performance else "No stable controller configuration found yet"

        return self.user_prompt_template.format(
            controller_type=controller_type,
            current_parameter_ranges=current_parameter_ranges,
            parameter_exploration_statistics=parameter_exploration_statistics,
            best_performance_achieved=best_performance_achieved,
            num_iterations=num_iterations,
            range_reconsider_count=range_reconsider_count
        )

    def _process_llm_response(self, llm_response, current_param_ranges):
        """Process the LLM response to extract the decision."""
        try:
            decision_data = extract_json_from_response(llm_response)

            # Validate and clean up decision data
            if "decision" not in decision_data:
                raise ValueError("Decision not found in LLM response")

            # Normalize decision string
            decision = decision_data["decision"].upper()

            # Map old decision format to new format if needed
            if decision == "SATISFACTORY_EXPLORATION":
                decision = "EXPLORE_FURTHER"

            # Validate decision is one of the allowed types
            if decision not in ["RECONSIDER_RANGE", "EXPLORE_FURTHER"]:
                raise ValueError(f"Invalid decision: {decision}")

            # Process new range if present and decision is RECONSIDER_RANGE
            if decision == "RECONSIDER_RANGE" and decision_data.get("new_range"):
                new_range = decision_data["new_range"]
                # NEW: Skip strict param-in-current check if current_param_ranges is empty (allow initial range definition)
                if current_param_ranges:
                    # Validate new range entries only if current ranges exist
                    for param, range_values in new_range.items():
                        if param not in current_param_ranges:
                            raise ValueError(f"Parameter {param} not in current parameter ranges")
                        if not isinstance(range_values, list) or len(range_values) != 2:
                            raise ValueError(f"Range for {param} must be a list of two values")
                        if range_values[0] >= range_values[1]:
                            raise ValueError(f"Range min must be less than max for {param}")
                # NEW: If current is empty, just validate basic structure (min < max) without param membership check
                else:
                    for param, range_values in new_range.items():
                        if not isinstance(range_values, list) or len(range_values) != 2:
                            raise ValueError(f"Range for {param} must be a list of two values")
                        if range_values[0] >= range_values[1]:
                            raise ValueError(f"Range min must be less than max for {param}")
            elif decision == "RECONSIDER_RANGE":
                # If decision is to reconsider but no valid range provided, suggest our own
                new_range = self._suggest_range_fallback(current_param_ranges)
                decision_data["new_range"] = new_range
            else:
                decision_data["new_range"] = None

            decision_data["decision"] = decision
            if "reasoning" not in decision_data:
                decision_data["reasoning"] = "No reasoning provided by LLM"

            return decision_data

        except Exception as e:
            # NEW: Only fallback on total JSON/parse failure; preserve original decision/reasoning if partial (e.g., no override on validation error)
            # For validation errors (e.g., bad range), log but don't override - let caller handle or re-invoke if needed
            print(f"Partial error processing LLM response (non-fatal): {e}. Preserving response as-is where possible.")
            log_to_file(f"âš ï¸ Partial LLM response error: {e}. Decision may be incomplete.", True)
            # NEW: Return original parsed data if available, or safe fallback without error in reasoning
            try:
                # Attempt to return partial valid data (e.g., decision without new_range)
                fallback_data = {
                    "decision": decision_data.get("decision", "EXPLORE_FURTHER").upper(),  # Preserve if parsed
                    "new_range": None,
                    "reasoning": decision_data.get("reasoning", f"Partial processing succeeded; full error: {str(e)}")
                    # Include error only if no original reasoning
                }
                # Map if needed
                if fallback_data["decision"] == "SATISFACTORY_EXPLORATION":
                    fallback_data["decision"] = "EXPLORE_FURTHER"
                return fallback_data
            except:
                # True total failure: safe fallback
                return {
                    "decision": "EXPLORE_FURTHER",
                    "new_range": None,
                    "reasoning": "Fallback due to unparseable response (no error details propagated to avoid feedback pollution)"
                }

    def _suggest_range_fallback(self, current_param_ranges):
        """Fallback method to suggest new parameter ranges if LLM fails to do so."""
        new_range = {}
        for param, range_vals in current_param_ranges.items():
            min_val, max_val = range_vals
            range_width = max_val - min_val

            # Shift the range by 25% in a random direction
            if np.random.random() < 0.5:
                # Shift to higher values
                new_min = min_val + 0.25 * range_width
                new_max = max_val + 0.25 * range_width
            else:
                # Shift to lower values
                new_min = max(0, min_val - 0.25 * range_width)
                new_max = max_val - 0.25 * range_width

            new_range[param] = [float(new_min), float(new_max)]

        return new_range


class LLMScenarist(LLMBaseAgent):
    """LLM that designs scenarios for the control system and passes nominal controllers"""

    def __init__(self):
        super().__init__(temperature=0)

    def design_scenario(self, scenario_level, system_description, buffer=None):
        """Design a scenario based on the difficulty level and prior results"""
        pass


class LLMSelector(LLMBaseAgent):
    """LLM that suggests controller types and thresholds"""

    def __init__(self):
        super().__init__(temperature=0)

    def _build_prompt(self, scenario, system_description, buffer=None, redesign_requested=False):
        pass

    def suggest_controller(self, scenario, buffer=None, redesign_requested=False):
        pass
