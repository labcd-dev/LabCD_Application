import yaml
import os
import json
import re
from typing import Dict, Any, Callable, Optional
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.runnables import RunnableLambda


def make_serializable(obj):
    if callable(obj):
        return str(obj)
    elif hasattr(obj, 'tolist'):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: make_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [make_serializable(item) for item in obj]
    else:
        try:
            json.dumps(obj)
            return obj
        except TypeError:
            return str(obj)


# FIXED: Added back the static 'callbacks' argument to support nested graphs
def create_agent(llm, template_name: str, state_keys: Optional[Dict[str, str]] = None, callbacks: Optional[list] = None,
                 get_callbacks: Optional[Callable] = None) -> Callable:
    config = _load_template(template_name)
    prompt_template = _build_prompt_template(config)
    chain = _build_chain(llm, prompt_template, config)

    def agent_node(state):
        """LangGraph node function that processes state and returns updated state."""
        inputs = _extract_inputs(state, config)

        # Support both static callbacks (from parsing_graph) and dynamic state-bound callbacks (from agents.py)
        run_callbacks = []
        if callbacks:
            run_callbacks.extend(callbacks)
        if get_callbacks:
            run_callbacks.extend(get_callbacks(state))

        invoke_config = {"callbacks": run_callbacks} if run_callbacks else {}

        # The callback mutates the tracker's 'state' directly in-place during this invocation
        result = chain.invoke(inputs, config=invoke_config)

        # _update_state safely copies the state
        updated_state = _update_state(state, result, config)
        return updated_state

    return agent_node


def _load_template(template_name: str) -> Dict[str, Any]:
    """Load YAML template configuration."""
    templates_dir = "backend_api/Trimmer/agenticNodes/templates"
    template_path = os.path.join(templates_dir, f"{template_name}.yaml")

    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Template not found: {template_path}")

    with open(template_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    return config


def _build_prompt_template(config: Dict[str, Any]) -> ChatPromptTemplate:
    """Build ChatPromptTemplate from configuration."""
    system_message = config.get('system_message', '')
    human_message = config.get('human_message', '') or config.get('prompt', '')

    if not human_message:
        raise ValueError("human_message is required in template")

    messages = []
    if system_message:
        messages.append(("system", system_message))
    messages.append(("human", human_message))

    return ChatPromptTemplate.from_messages(messages)


def _clean_llm_json_output(output):
    """Removes comments from LLM generated JSON strings before parsing."""
    text = output.content if hasattr(output, 'content') else str(output)
    text = re.sub(r'//.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)

    if hasattr(output, 'content'):
        output.content = text
        return output
    return text


def _build_chain(llm, prompt_template: ChatPromptTemplate, config: Dict[str, Any]):
    """Build the LangChain runnable chain."""
    output_parser = config.get('output_parser', 'json')
    if output_parser == 'json':
        parser = JsonOutputParser()
    else:
        parser = None

    chain = prompt_template | llm

    if parser:
        chain = chain | RunnableLambda(_clean_llm_json_output) | parser

    return chain


def _extract_inputs(state: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """Extract required inputs from state based on template configuration."""
    input_keys = config.get('input_keys', [])
    inputs = {}

    for key in input_keys:
        if key in state:
            inputs[key] = make_serializable(state[key])
        else:
            inputs[key] = make_serializable(_get_nested_value(state, key))

    return inputs


def _update_state(state: Dict[str, Any], result: Any, config: Dict[str, Any]) -> Dict[str, Any]:
    """Update state with the result of the agent execution."""
    output_key = config.get('output_key', 'result')

    new_state = state.copy()
    new_state[output_key] = result

    if 'trace' in new_state:
        trace_entry = {
            'agent': config.get('name', 'unknown_agent'),
            'template': config.get('template_name', 'unknown'),
            'result': result
        }
        new_state['trace'].append(trace_entry)

    return new_state


def _get_nested_value(obj: Any, key: str) -> Any:
    """Get nested value from object using dot notation."""
    keys = key.split('.')
    current = obj

    for k in keys:
        if isinstance(current, dict):
            current = current.get(k)
        elif hasattr(current, k):
            current = getattr(current, k)
        else:
            return None

    return current