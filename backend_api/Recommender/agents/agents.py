import os
import yaml
import json

from langchain_groq import ChatGroq
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend_api.Recommender.agents.file_management import clean_json, get_content, load_m_file
from backend_api.Recommender.functionalNodes.validate_structural_rules import validate_structural_rules, apply_system_names
from backend_api.Recommender.functionalNodes.standardize_output import standardize_system_variables


class SingletonMeta(type):
    _instances = {}

    def __call__(cls, *args, **kwargs):
        # Dynamically key instances by class and model name to support multi-model caching
        model_name = kwargs.get('model_name') or (args[0] if args else "gpt_os-120b")
        key = (cls, model_name)
        if key not in cls._instances:
            instance = super().__call__(*args, **kwargs)
            cls._instances[key] = instance
        return cls._instances[key]


class Agents(metaclass=SingletonMeta):
    PRICING_CONFIG = {
        "openai/gpt-oss-120b": {"input": 0.039, "output": 0.19},
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-4o": {"input": 2.50, "output": 10.00},
        "gpt-5.4-mini": {"input": 0.75, "output": 4.50},
        "gpt-5.4": {"input": 2.50, "output": 15.00},
        "gpt-5.5": {"input": 5.00, "output": 30.00}
    }

    def __init__(self, model_name="gpt-oss-120b", prompt_dir="backend_api/Recommender/agents/templates"):
        self.llm_nvidia = ChatNVIDIA(model="nvidia/llama-3.3-nemotron-super-49b-v1", temperature=0,
                                     max_completion_tokens=16000)
        self.openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.llm_groq = ChatGroq(model="openai/gpt-oss-120b", temperature=0, max_completion_tokens=16000)

        if model_name == "gpt-oss-120b":
            self.llm_think = ChatNVIDIA(model="openai/gpt-oss-120b", temperature=0, max_completion_tokens=16000)
        elif model_name.startswith("gpt"):
            self.llm_think = ChatOpenAI(model=model_name, temperature=0)

        self.prompts = {}
        self._load_all_prompts(prompt_dir)

    def _load_all_prompts(self, directory):
        """Discovers and loads all .yaml files in the prompt directory."""
        for filename in os.listdir(directory):
            if filename.endswith(".yaml"):
                name = filename.replace(".yaml", "")
                with open(os.path.join(directory, filename), 'r') as f:
                    self.prompts[name] = yaml.safe_load(f)

    def _accumulate_state_metrics(self, state: dict, input_tokens: int, output_tokens: int, model_name: str) -> dict:
        """
        Calculates the cost of the current LLM call, adds it to the existing state totals,
        and returns the dictionary payload required to update the LangGraph state.
        """
        model_pricing = {"input": 0.0, "output": 0.0}
        for key, price in self.PRICING_CONFIG.items():
            if key in model_name:
                model_pricing = price
                break

        call_cost = (input_tokens * model_pricing["input"] / 1_000_000) + \
                    (output_tokens * model_pricing["output"] / 1_000_000)

        current_usage = state.get("token_usage") or {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        current_cost = state.get("total_cost") or 0.0

        updated_usage = {
            "input_tokens": current_usage.get("input_tokens", 0) + input_tokens,
            "output_tokens": current_usage.get("output_tokens", 0) + output_tokens,
            "total_tokens": current_usage.get("total_tokens", 0) + (input_tokens + output_tokens),
        }
        updated_cost = current_cost + call_cost

        print(
            f"[{model_name}] Call: {input_tokens} in / {output_tokens} out | Call Cost: ${call_cost:.6f} | Total State Cost: ${updated_cost:.6f}")

        return {
            "token_usage": updated_usage,
            "total_cost": updated_cost
        }

    def _call_llm(self, llm, prompt_text, state: dict, system=False, context_messages=None, is_json=False):
        """Helper to invoke LangChain LLMs and return response text along with updated state metrics."""
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

        metrics_update = self._accumulate_state_metrics(state, in_tokens, out_tokens, model_name)
        return get_content(response), metrics_update

    def standardize_python_file(self, state, writer):
        writer({"progress": 0.1, "text": "🛠️  Standardizing system equations..."})
        try:
            equation = state.get("file_content") or load_m_file(state["file_name"])
            schema = self.prompts['standardize']['schema']

            prompt = self.prompts['standardize']['standardize_equation'].format(
                equation=equation, schema=schema
            )

            code, metrics = self._call_llm(self.llm_nvidia, prompt, state=state)
            code = code.replace("```python\n", "").replace("```", "").replace("python", "").strip()
            code = code.replace("np.", "")

            writer({"agent_tag": "📝.Equation", "log_history": code})
            return {"messages": code, "equation": code, **metrics}
        except Exception as e:
            return {"messages": f"Error: {e}"}

    def system_analyser(self, state, writer):
        writer({"progress": 0.3, "text": "🔍 Analyzing system dynamics..."})
        prompt = self.prompts['system_analyser']['analyse_system'].format(equation=state["equation"])

        response, metrics = self._call_llm(self.llm_think, prompt, state=state, system=True, context_messages=state.get("messages", []))
        response_content = clean_json(response, False)
        response_content = standardize_system_variables(response_content)

        writer({"agent_tag": "🔍.System Analysis", "log_history": response_content})
        return {"messages": [response_content], "system_identification": response_content, **metrics}

    def control_loop_analyser(self, state, writer):
        writer({"progress": 0.5, "text": "👨‍🔧 Analyzing control loop structure..."})

        sys_id = state["system_identification"]
        sys_id_json = json.loads(sys_id)
        inputs_string = str(sys_id_json.get("inputs", ""))
        rag_key = [key for key in ["web_search_result", "RAG_result"] if key in state]

        if rag_key:
            design_prompt = self.prompts['control_loop']['design_rag'].format(
                equation=state["equation"], system_identification=sys_id,
                inputs_string=inputs_string, rag_result=state.get("RAG_result", "No RAG Data available; ignore this block."),
                web_search_result=state.get("web_search_result", "No web search Data available; ignore this block."),
                block_diagram_json=state.get("block_diagram_json", "No reference block diagram topology available; ignore this block.")
            )
        elif "block_diagram_json" in state:
            feedback = state.get("supervisor_comment", "No previous errors. Design the initial architecture.")
            design_prompt = self.prompts['block_diagram_search']['design_controller']
            design_prompt = design_prompt.replace("{diagram_json}", state["block_diagram_json"])
            design_prompt = design_prompt.replace("{system_json}", sys_id)
            design_prompt = design_prompt.replace("{supervisor_comment}", feedback)
        else:
            feedback = state.get("supervisor_comment", "No previous errors. Design the initial architecture.")
            design_prompt = self.prompts['control_loop']['design_standard'].format(
                equation=state["equation"], system_identification=sys_id,
                inputs_string=inputs_string, supervisor_comment=feedback
            )

        # --- NEW: Inject User Prompt as a HumanMessage ---
        user_prompt = state.get("user_prompt", "").strip()
        context_msgs = [HumanMessage(content=f"User Instructions: {user_prompt}")] if user_prompt else None

        # 2. Get reasoning from Thinking Model (passing context_msgs)
        reasoning, metrics = self._call_llm(
            self.llm_think,
            design_prompt,
            state=state,
            context_messages=context_msgs
        )

        # 3. Setting process that designed controller
        rag_name = {"web_search_result": "Web Search", "RAG_result": "RAG", "block_diagram_json": "Block Diagram Search"}
        rag_key = [key for key in rag_name.keys() if key in state]
        if rag_key:
            process = ""
            for idx, key in enumerate(rag_key):
                process += rag_name[key]
                if idx < len(rag_key) - 1:
                    process += "_"
        else:
            process = "Initial"

        writer({"agent_tag": "👨‍🔧.Control Loop Analysis", "log_history": reasoning})
        return {
            "messages": [reasoning],
            "control_loop_analysis_reasoning": reasoning,
            "control_design_process": process,
            **metrics
        }

    def control_loop_structure(self, state, writer):
        writer({"progress": 0.75, "text": "🧱  Putting results in standard format ..."})
        reasoning = state["control_loop_analysis_reasoning"]
        sys_id_str = state.get("system_identification", "{}")

        if "FAILED" in reasoning:
            return {"messages": ["FAILED"], "control_loop_analysis": "FAILED"}

        try:
            final_json = clean_json(reasoning, False)
            json.loads(final_json)
            final_json = apply_system_names(final_json, sys_id_str)

            return {"messages": [final_json], "control_loop_analysis": final_json}
        except (json.JSONDecodeError, TypeError):
            pass

        struct_prompt = self.prompts['control_loop']['structure'].format(reason=reasoning)
        formatted_resp, metrics = self._call_llm(self.llm_nvidia, struct_prompt, state=state)
        final_json = clean_json(formatted_resp, False)
        final_json = apply_system_names(final_json, sys_id_str)

        writer({"agent_tag": "🔍  .Control Loop", "log_history": final_json})
        return {"messages": [final_json], "control_loop_analysis": final_json, **metrics}

    def control_loop_supervisor(self, state, writer):
        writer({"progress": 0.8, "text": "🤖  Supervising and validating control loop..."})

        controller_data = json.loads(state["control_loop_analysis"])
        system_data = json.loads(state["system_identification"])
        passed, audit_logs, feedback = validate_structural_rules(controller_data, system_data)

        current_retries = state.get("supervisor_retry_count", 0)

        if not passed:
            formatted_comment = (
                f"STATUS: FAILED\n"
                f"FLAG: BACK TO GENERATOR\n"
                f"AUDIT_LOG:\n{chr(10).join(audit_logs)}\n"
                f"FEEDBACK: {feedback}"
            )

            writer({"agent_tag": "🤖 .Supervisor", "log_history": formatted_comment})
            return {
                "messages": [formatted_comment],
                "supervisor_comment": formatted_comment,
                "supervisor_retry_count": current_retries + 1
            }

        prompt = self.prompts['supervisor']['audit'].format(structure=controller_data)
        response_content, metrics = self._call_llm(self.llm_think, prompt, state=state)

        if "FAILED" in response_content or "CRITICAL" in response_content:
            new_retries = current_retries + 1
        else:
            new_retries = 0

        writer({"agent_tag": "🤖 .Supervisor", "log_history": response_content})

        return {
            "messages": [response_content],
            "supervisor_comment": response_content,
            "supervisor_retry_count": new_retries,
            **metrics
        }

    def openai_web_search(self, state, writer):
        writer({"progress": 0.3, "text": "🌐  Searching Web ..."})

        sys_id_json = json.loads(state["system_identification"])
        file_name = state["file_name"]
        system_name = str(sys_id_json.get("system_name", ""))
        model = state.get("RAG_decision")["Model"]

        prompt = (self.prompts['openai_web_search']['prompt']
                  .format(file_name=file_name, system_name=system_name))
        schema = self.prompts['openai_web_search']['schema']

        response = self.openai.responses.create(
            model=model,
            max_output_tokens=16000,
            tools=[{"type": "web_search_preview"}],
            input=prompt,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "rag_result",
                    "schema": dict(schema),
                    "strict": True
                }
            })

        input_tokens = getattr(response.usage, "input_tokens", 0) if hasattr(response, "usage") else 0
        output_tokens = getattr(response.usage, "output_tokens", 0) if hasattr(response, "usage") else 0

        metrics_update = self._accumulate_state_metrics(state, input_tokens, output_tokens, model)

        response_content = ""
        for item in response.output:
            if item.type == "message":
                response_content += item.content[0].text

        writer({"agent_tag": "🌐.Web Search Result", "log_history": response_content})
        return {"messages": [response_content], "web_search_result": response_content, **metrics_update}

    def openai_image_recognition(self, state, writer):
        writer({"progress": 0.5, "text": "👀 Image Recognition ..."})

        image_url = state["block_diagram_url"]
        model = state.get("RAG_decision")["Model"]

        prompt = (self.prompts['block_diagram_search']['prompt'].format(image_url=image_url))
        schema = self.prompts['block_diagram_search']['schema']

        response = self.openai.responses.create(
            model=model,
            input=prompt,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "block_diagram",
                    "schema": dict(schema),
                    "strict": True
                }
            }
        )

        input_tokens = getattr(response.usage, "input_tokens", 0) if hasattr(response, "usage") else 0
        output_tokens = getattr(response.usage, "output_tokens", 0) if hasattr(response, "usage") else 0

        metrics_update = self._accumulate_state_metrics(state, input_tokens, output_tokens, model)

        response_content = ""
        for item in response.output:
            if item.type == "message":
                response_content += item.content[0].text

        writer({"agent_tag": "🤖.Image Recognition Result", "log_history": response_content})
        return {"messages": [response_content], "block_diagram_json": response_content, **metrics_update}

    def judge_controller(self, state: dict) -> dict:
        """Standard graph node to evaluate generated controllers against user prompts."""
        system_id = state.get("system_identification", "{}")
        controllers = state.get("controller_json", {})

        # --- NEW: Extract the user prompt from the state ---
        user_prompt = state.get("user_prompt", "").strip()

        if not controllers:
            return {"score": 0.0, "detailed_scores": {}}

        prompt = self.prompts['judge']['evaluate'].format(
            system_id=system_id,
            controllers=json.dumps(controllers)
        )

        # --- NEW: Wrap the prompt in a HumanMessage for context ---
        context_msgs = [
            HumanMessage(content=f"Grade the controllers based on these explicit user instructions: {user_prompt}")
        ] if user_prompt else None

        # Pass the state in so your existing cost/token accumulation works normally
        response_content, _ = self._call_llm(
            self.llm_think,
            prompt,
            state=state,
            system=True,
            context_messages=context_msgs,  # <--- NEW: Inject the context here
            is_json=True
        )

        try:
            scores = json.loads(clean_json(response_content, False))
        except (json.JSONDecodeError, TypeError):
            scores = {k: 0 for k in controllers.keys()}

        best_score = float(max(scores.values())) if scores else 0.0

        # Return the updates to be appended to the global state
        return {
            "best_score": best_score,
            "detailed_scores": scores
        }