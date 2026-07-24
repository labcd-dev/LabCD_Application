from langchain_core.callbacks import BaseCallbackHandler
from langchain_groq import ChatGroq
from langchain_nvidia_ai_endpoints import ChatNVIDIA
# from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
import json

from backend_api.Recommender.agents.file_management import clean_json
from backend_api.Trimmer.states import WorkflowState
from backend_api.Trimmer.agenticNodes.parsing_graph import ParsingGraph
from backend_api.Trimmer.agenticNodes.input_handlers import InputHandlers
from backend_api.Trimmer.agenticNodes.create_agent import create_agent, _load_template


class SingletonMeta(type):
    _instances = {}

    def __call__(cls, *args, **kwargs):
        model_name = kwargs.get('model_name') or (args[0] if args else None)
        if not model_name and cls._instances:
            return list(cls._instances.values())[-1]

        model_name = model_name or "gpt-oss-120b"
        key = (cls, model_name)
        if key not in cls._instances:
            instance = super().__call__(*args, **kwargs)
            cls._instances[key] = instance
        return cls._instances[key]


class TokenCostCallback(BaseCallbackHandler):
    def __init__(self, state: WorkflowState, pricing_config: dict):
        self.state = state
        self.pricing_config = pricing_config

    def on_llm_end(self, response, **kwargs):
        message = response.generations[0][0].message

        model_id = kwargs.get('invocation_params', {}).get('model_name', '')
        if not model_id and hasattr(message, 'response_metadata'):
            model_id = message.response_metadata.get('model_name', 'unknown')

        in_tokens = out_tokens = 0
        if hasattr(message, 'usage_metadata') and message.usage_metadata:
            in_tokens = message.usage_metadata.get('input_tokens', 0)
            out_tokens = message.usage_metadata.get('output_tokens', 0)
        elif hasattr(message, 'response_metadata') and 'token_usage' in message.response_metadata:
            usage = message.response_metadata['token_usage']
            in_tokens = usage.get('prompt_tokens', 0)
            out_tokens = usage.get('completion_tokens', 0)

        if 'token_usage' not in self.state or not self.state['token_usage']:
            self.state['token_usage'] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        if 'total_cost' not in self.state:
            self.state['total_cost'] = 0.0

        self.state['token_usage']['input_tokens'] += in_tokens
        self.state['token_usage']['output_tokens'] += out_tokens
        self.state['token_usage']['total_tokens'] += (in_tokens + out_tokens)

        matched_price = {"input": 0, "output": 0}
        for key, price in self.pricing_config.items():
            if key in model_id:
                matched_price = price
                break

        cost = (in_tokens * matched_price["input"] / 1_000_000) + \
               (out_tokens * matched_price["output"] / 1_000_000)

        self.state['total_cost'] += cost

        print(
            f"Trimmer Usage for {model_id}: {in_tokens} In, {out_tokens} Out. Cost: ${cost:.6f} | Session Total: ${self.state['total_cost']:.6f}")


class Agents(metaclass=SingletonMeta):
    PRICING_CONFIG = {
        "nvidia/llama-3.3-nemotron-super-49b-v1": {"input": 0.05, "output": 0.05},
        "gpt-oss-120b": {"input": 0.039, "output": 0.19},
        "gpt-4o": {"input": 2.50, "output": 10.00},
        "gpt-5.4-mini": {"input": 0.75, "output": 4.50},
        "gpt-5.4": {"input": 2.50, "output": 15.00},
        "gpt-5.5": {"input": 5.00, "output": 30.00}
    }

    def __init__(self, model_name="gpt-oss-120b"):
        self.llm_nvidia = ChatNVIDIA(model="nvidia/llama-3.3-nemotron-super-49b-v1", temperature=0,
                                     max_completion_tokens=8000)
        if model_name == "gpt-oss-120b":
            self.llm_think = ChatGroq(model="openai/gpt-oss-120b", temperature=0.1)
        elif model_name.startswith("gpt-"):
            self.llm_think = ChatOpenAI(model=model_name, temperature=0.1)

    def get_callbacks(self, state: WorkflowState):
        """Generates a tracking callback explicitly tied to the provided state."""
        return [TokenCostCallback(state, self.PRICING_CONFIG)]

    def parse_system(self, state: WorkflowState, writer) -> WorkflowState:
        writer({"progress": 0.1, "text": "⚙️ Parsing System..."})
        logger = state['logger']
        logger.info("--- Entering Node: parse_system ---")

        parsing_graph = ParsingGraph(self.llm_think, logger=logger)
        cbs = self.get_callbacks(state)

        if state["ui_mode"] == "terminal":
            file_path = InputHandlers.get_file_path()
            result = parsing_graph.invoke({"input_text": file_path, "ui_mode": "terminal"}, config={"callbacks": cbs})

        elif state["ui_mode"] == "streamlit":
            inputContent = state['input_content']
            operating_conditions = state["trimming_params"]
            initial_state = parsing_graph.build_initial_state(
                {"equation": inputContent, "ui_mode": "streamlit", "ui_inputs": state["ui_inputs"],
                 "operating_conditions": operating_conditions})
            result = parsing_graph.invoke(initial_state, config={"callbacks": cbs})

        config = result.get("final_config", {})
        logger.info("Parsed config: %s", json.dumps(self.make_serializable(config), indent=2))
        state['config'] = config
        writer({"agent_tag": "⚙️. Parsing System", "log_history": clean_json(str(config), False)})
        return state

    # FIXED: Added `state` to all factories and forcefully bound it to the callback generator
    def generate_prompt(self, state: WorkflowState):
        return create_agent(self.llm_think, "generate_prompt", get_callbacks=lambda _: self.get_callbacks(state))

    def validate_only(self, state: WorkflowState):
        logger = state['logger']
        parsing_graph = ParsingGraph(self.llm_think, logger=logger)
        config = state['config']
        return parsing_graph.validate_only(config, run_config={"callbacks": self.get_callbacks(state)})

    def plan_strategy(self, state: WorkflowState):
        return create_agent(self.llm_think, "plan_strategy", get_callbacks=lambda _: self.get_callbacks(state))

    def equilibrium_check(self, state: WorkflowState):
        return create_agent(self.llm_think, "equilibrium_check", get_callbacks=lambda _: self.get_callbacks(state))

    def human_intervention(self, state: WorkflowState):
        return create_agent(self.llm_think, "human_intervention", get_callbacks=lambda _: self.get_callbacks(state))

    def generate_narratives(self, result: dict, config: dict, system_identification: dict = None,
                            controller_json: dict = None, state: WorkflowState = None) -> dict:
        from langchain_core.prompts import ChatPromptTemplate
        from langchain_core.output_parsers import JsonOutputParser

        parser = JsonOutputParser()
        prompt = _load_template("generate_narratives")

        prompt_template = ChatPromptTemplate.from_messages([
            ("system", prompt["system_prompt"]),
            ("human", prompt["human_prompt"])
        ])

        chain = prompt_template | self.llm_think | parser
        cbs = self.get_callbacks(state) if state else []

        try:
            narratives = chain.invoke({
                "config": self.make_serializable(config),
                "result": self.make_serializable(result),
                "sys_id": self.make_serializable(system_identification) if system_identification else "Not provided",
                "ctrl_json": self.make_serializable(controller_json) if controller_json else "Not provided"
            }, config={"callbacks": cbs})
            return narratives
        except Exception as e:
            print(f"Error generating LLM narratives: {e}")
            return {}

    def make_serializable(self, obj):
        if callable(obj):
            return str(obj)
        elif hasattr(obj, 'tolist'):
            return obj.tolist()
        elif isinstance(obj, dict):
            return {k: self.make_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self.make_serializable(item) for item in obj]
        else:
            try:
                json.dumps(obj)
                return obj
            except TypeError:
                return str(obj)