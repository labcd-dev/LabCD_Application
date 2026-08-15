import os
import re
import json
import time
from typing import Dict, Any

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage

from backend_api.MuloDesigner.GaAgent.src.logger import get_logger

# Import the centralized base agent
from backend_api.base_agent import BaseLLMAgent

load_dotenv()

logger = get_logger(__name__)


def extract_json_from_response(response_text: str) -> Dict[str, Any]:
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
        logger.error(f"Failed to parse JSON. Original response: {repr(response_text)}")
        logger.error(f"Extracted JSON text: {repr(json_text)}")
        raise e


def round_floats(obj, decimals=4):
    """Recursively round float values in a nested structure (dict/list) to specified decimals."""
    if isinstance(obj, float):
        return round(obj, decimals)
    elif isinstance(obj, dict):
        return {k: round_floats(v, decimals) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [round_floats(item, decimals) for item in obj]
    return obj


class LLMBaseAgent(BaseLLMAgent):
    """Adapter class bridging the local MuloDesigner agents to the global BaseLLMAgent"""
    def __init__(self, model="deepseek-r1-distill-llama-70b", temperature=0.0, seed=42, monitor=None):
        # Safely initialize the base class. If the model isn't in the global registry yet,
        # initialize using the fallback to prevent crashes, but retain the requested model name.
        try:
            super().__init__(model_name=model)
        except ValueError:
            logger.warning(f"Warning: '{model}' not found in BaseLLMAgent registry. Routing to fallback.")
            super().__init__(model_name=self.__class__._fallback_model)
            self.main_model_name = model

        self.model = model
        self.agent_name = self.__class__.__name__
        self.monitor = monitor


    def _compute_cost(self, in_tokens: int, out_tokens: int) -> float:
        """
        Backwards compatibility bridge for graph.py. 
        Routes the token count to the centralized BaseLLMAgent for exact pricing.
        """
        metrics = self.calculate_call_metrics(
            input_tokens=in_tokens, 
            output_tokens=out_tokens, 
            model_name=self.main_model_name
        )
        return metrics.get("call_cost", 0.0)


    def invoke_llm(self, system_prompt, user_prompt, max_retries=3):
        """Invoke LLM with separate system and user prompts, retry logic and logging"""
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    logger.info(f"Retry attempt {attempt + 1}/{max_retries} for {self.agent_name}")

                llm_start_time = time.time()

                # Delegate execution to the centralized BaseLLMAgent
                response_text, current_metrics = self.execute_llm_call(
                    model_key=self.main_model_name,
                    prompt_text=system_prompt,
                    system=True,
                    context_messages=[HumanMessage(content=user_prompt)],
                    is_json=False # Handled locally by extract_json_from_response
                )

                llm_duration = time.time() - llm_start_time

                # Map the globally generated metrics to the localized usage dict
                usage = {
                    'prompt_tokens': current_metrics.get('input_tokens', 0),
                    'completion_tokens': current_metrics.get('output_tokens', 0),
                    'call_cost': current_metrics.get('call_cost', 0.0),
                    'llm_time': llm_duration
                }

                if self.monitor:
                    full_prompt = f"System: {system_prompt}\n\nUser: {user_prompt}"
                    truncated_prompt = full_prompt[:200] + "..." if len(full_prompt) > 200 else full_prompt
                    self.monitor.add_llm_response(self.agent_name, truncated_prompt, response_text)

                return response_text, usage
            
            except Exception as e:
                logger.error(
                    f"Error invoking LLM (attempt {attempt + 1}/{max_retries}): {type(e).__name__}: {e}"
                )
                if attempt == max_retries - 1:
                    raise e
                    
        return None, {'prompt_tokens': 0, 'completion_tokens': 0, 'llm_time': 0.0, 'call_cost': 0.0}