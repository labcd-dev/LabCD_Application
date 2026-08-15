import os
import yaml
from typing import Any, Dict

from langchain_nvidia_ai_endpoints import ChatNVIDIA
from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend_api.Recommender.agents.file_management import get_content


class SingletonMeta(type):
    """Ensures multi-model caching by dynamically keying instances by class and model name."""
    _instances = {}

    def __call__(cls, *args, **kwargs):
        # Dynamically key instances by class and model name to support multi-model caching
        model_name = kwargs.get('model_name') or (args[0] if args else "gpt-4o")
        key = (cls, model_name)
        if key not in cls._instances:
            instance = super().__call__(*args, **kwargs)
            cls._instances[key] = instance

        return cls._instances[key]


class BaseLLMAgent(metaclass=SingletonMeta):
    # ==========================================
    # SHARED CLASS-LEVEL STATE
    # ==========================================
    _pricing_config: Dict[str, Dict[str, float]] = {
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-4o": {"input": 2.50, "output": 10.00},
        "gpt-5.4-mini": {"input": 0.75, "output": 4.50},
        "gpt-5.4": {"input": 2.50, "output": 15.00},
        "gpt-5.5": {"input": 5.00, "output": 30.00}
    }

    # FIX: Initialize as an empty dictionary to prevent import-time crashes
    _llm_registry: Dict[str, Any] = {}

    # New global fallback variable
    _fallback_model: str = "gpt-4o-mini"

    # NEW: Stores prices of deleted models for active in-flight requests
    _archived_pricing: Dict[str, Dict[str, float]] = {}

    def __init__(self, model_name="gpt-4o", prompt_dir="backend_api/Recommender/agents/templates"):
        """
        Initializes the agent, sets the primary LLM model, and pre-loads all prompts into memory.
        """
        # FIX: Lazy load the default models here on first instantiation
        if not self.__class__._llm_registry:
            self.__class__._llm_registry = {
                "gpt-4o": ChatOpenAI(model="gpt-4o", temperature=0),
                "gpt-4o-mini": ChatOpenAI(model="gpt-4o-mini", temperature=0),
                "gpt-5.4-mini": ChatOpenAI(model="gpt-5.4-mini", temperature=0),
                "gpt-5.4": ChatOpenAI(model="gpt-5.4", temperature=0),
                "gpt-5.5": ChatOpenAI(model="gpt-5.5", temperature=0)
            }

        self.openai_native = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        # Keep our main_model in a variable so it is more accessible
        if model_name not in self.__class__._llm_registry:
            raise ValueError(f"Model '{model_name}' not found in registry. Add it using add_model() first.")

        self.main_model_name = model_name

        # Take all prompts and save them locally so we don't need to load them each time
        self.prompts = {}
        if os.path.exists(prompt_dir):
            self._load_all_prompts(prompt_dir)

    def _load_all_prompts(self, directory):
        """Discovers and loads all .yaml files in the prompt directory into a local dictionary."""
        for filename in os.listdir(directory):
            if filename.endswith(".yaml"):
                name = filename.replace(".yaml", "")
                with open(os.path.join(directory, filename), 'r') as f:
                    self.prompts[name] = yaml.safe_load(f)

    # ==========================================
    # CLASS METHODS FOR DYNAMIC MANAGEMENT
    # ==========================================

    @classmethod
    def set_fallback_model(cls, model_key: str) -> str:
        """
        Safely updates the global fallback model used when a requested model is unavailable.
        """
        if model_key not in cls._llm_registry:
            return f"Cannot set fallback: Model '{model_key}' not found in registry."

        cls._fallback_model = model_key
        return f"Fallback model successfully set to '{model_key}'."

    @classmethod
    def add_model(cls, model_key: str, input_cost: float = 0.0, output_cost: float = 0.0) -> str:
        if model_key in cls._llm_registry:
            return f"Warning: Overwriting existing model '{model_key}'."
        cls._llm_registry[model_key] = ChatOpenAI(model=model_key, temperature=0)
        cls._pricing_config[model_key] = {"input": input_cost, "output": output_cost}
        return f"Model '{model_key}' added successfully."

    @classmethod
    def remove_model(cls, model_key: str) -> str:
        """Removes a model, but archives its pricing for active in-flight requests."""
        if model_key == cls._fallback_model:
            return f"Action Denied: '{model_key}' is the current fallback model. You must change the fallback model using set_fallback_model() before removing it."

        removed_llm = cls._llm_registry.pop(model_key, None)

        # Soft-delete the pricing to the archive
        if model_key in cls._pricing_config:
            cls._archived_pricing[model_key] = cls._pricing_config.pop(model_key)

        if removed_llm:
            return f"Model '{model_key}' removed successfully."
        else:
            return f"Model '{model_key}' not found in registry."

    @classmethod
    def update_pricing(cls, model_key: str, input_cost: float, output_cost: float) -> str:
        if model_key not in cls._pricing_config:
            return f"Cannot update pricing: Model '{model_key}' not found in pricing configuration."
        cls._pricing_config[model_key] = {"input": input_cost, "output": output_cost}
        return f"Pricing for '{model_key}' updated -> Input: ${input_cost}, Output: ${output_cost}."

    # ==========================================
    # CORE FUNCTIONALITIES
    # ==========================================

    def calculate_call_metrics(self, input_tokens: int, output_tokens: int, model_name: str) -> dict:
        """Calculates exact cost, checking active pricing first, then the archive."""
        model_pricing = None

        # 1. Search active pricing
        for key, price in self.__class__._pricing_config.items():
            if key in model_name:
                model_pricing = price
                break

        # 2. Search archived pricing if the model was deleted mid-flight
        if not model_pricing:
            for key, price in self.__class__._archived_pricing.items():
                if key in model_name:
                    model_pricing = price
                    break

        # 3. Absolute safety net fallback (only triggers if the model name is completely unknown)
        if not model_pricing:
            fallback_key = self.__class__._fallback_model
            model_pricing = self.__class__._pricing_config.get(fallback_key, {"input": 0.0, "output": 0.0})

        call_cost = (input_tokens * model_pricing["input"] / 1_000_000) + \
                    (output_tokens * model_pricing["output"] / 1_000_000)

        print(f"[{model_name}] Call: {input_tokens} in / {output_tokens} out | Call Cost: ${call_cost:.6f}")

        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "call_cost": call_cost
        }

    def update_state_metrics(self, state: dict, current_metrics: dict) -> dict:
        """Takes the state and current metrics, adds them together, and returns the LangGraph state update payload."""
        current_usage = state.get("token_usage") or {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        current_cost = state.get("total_cost") or 0.0

        updated_usage = {
            "input_tokens": current_usage.get("input_tokens", 0) + current_metrics["input_tokens"],
            "output_tokens": current_usage.get("output_tokens", 0) + current_metrics["output_tokens"],
            "total_tokens": current_usage.get("total_tokens", 0) + (
                        current_metrics["input_tokens"] + current_metrics["output_tokens"]),
        }
        updated_cost = current_cost + current_metrics["call_cost"]

        print(f"Total State Cost Updated: ${updated_cost:.6f}")
        return {"token_usage": updated_usage, "total_cost": updated_cost}


    def execute_llm_call(self, model_key: str, prompt_text: str, system=False, context_messages=None, is_json=False):
        """Executes the LLM call without touching the global state."""
        if model_key not in self.__class__._llm_registry:
            fallback = self.__class__._fallback_model
            print(f"⚠️ WARNING: Model '{model_key}' was removed or not found. Rerouting to fallback '{fallback}'.")
            model_key = fallback

            if model_key not in self.__class__._llm_registry:
                raise ValueError("Catastrophic error: The designated fallback model is also missing from the registry.")

        llm = self.__class__._llm_registry[model_key]
        messages = [SystemMessage(content=prompt_text) if system else HumanMessage(content=prompt_text)]

        if context_messages:
            messages = messages + context_messages

        if is_json:
            llm_formatted = llm.bind(response_format={"type": "json_object"})
            response = llm_formatted.invoke(messages)
        else:
            response = llm.invoke(messages)

        model_name = getattr(llm, 'model', getattr(llm, 'model_name', 'unknown'))
        in_tokens = out_tokens = 0

        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            in_tokens = response.usage_metadata.get('input_tokens', 0)
            out_tokens = response.usage_metadata.get('output_tokens', 0)
        elif hasattr(response, 'response_metadata') and 'token_usage' in response.response_metadata:
            usage = response.response_metadata['token_usage']
            in_tokens = usage.get('prompt_tokens', 0)
            out_tokens = usage.get('completion_tokens', 0)

        # Retrieve isolated metrics instead of updating state
        current_metrics = self.calculate_call_metrics(in_tokens, out_tokens, model_name)
        return get_content(response), current_metrics


    def generate_response(self, prompt_file: str, prompt_key: str, main_model: str = None,
                          system: bool = False, context_messages: list = None,
                          is_json: bool = False, **prompt_kwargs):
        """Formats the prompt and executes the LLM call, returning the response and isolated call metrics."""
        if prompt_file not in self.prompts or prompt_key not in self.prompts[prompt_file]:
            raise KeyError(f"Prompt key '{prompt_key}' not found in '{prompt_file}.yaml'.")

        formatted_prompt = self.prompts[prompt_file][prompt_key].format(**prompt_kwargs)

        if main_model is None:
            main_model = self.main_model_name

        response_content, current_metrics = self.execute_llm_call(
            model_key=main_model,
            prompt_text=formatted_prompt,
            system=system,
            context_messages=context_messages,
            is_json=is_json
        )

        return response_content, current_metrics


    @staticmethod
    def extract_responses_text(response) -> str:
        output_text = getattr(response, "output_text", None)
        if isinstance(output_text, str) and output_text.strip():
            return output_text

        chunks: list[str] = []
        for item in getattr(response, "output", None) or []:
            if getattr(item, "type", None) != "message":
                continue
            for part in getattr(item, "content", None) or []:
                text = getattr(part, "text", None)
                if text is None and isinstance(part, dict):
                    text = part.get("text")
                if text:
                    chunks.append(str(text))
        return "".join(chunks)