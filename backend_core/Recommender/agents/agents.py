import os
import yaml
import json

from langchain_groq import ChatGroq
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from backend_core.Recommender.agents.file_management import clean_json, get_content, load_m_file


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
    def __init__(self, model_name="gpt-oss-120b", prompt_dir="backend_core/Recommender/agents/templates"):
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

    @staticmethod
    def _extract_responses_text(response) -> str:
        """Pull text from an OpenAI Responses API result without returning None."""
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

    def _load_all_prompts(self, directory):
        """Discovers and loads all .yaml files in the prompt directory."""
        for filename in os.listdir(directory):
            if filename.endswith(".yaml"):
                name = filename.replace(".yaml", "")
                with open(os.path.join(directory, filename), 'r') as f:
                    self.prompts[name] = yaml.safe_load(f)


    def _call_llm(self, llm, prompt_text, system=False, context_messages=None, is_json=False):
        # Initialize messages
        messages = [SystemMessage(content=prompt_text) if system else HumanMessage(content=prompt_text)]
        if context_messages:
            messages = messages + context_messages

        if is_json:
            llm_formatted = llm.bind(response_format={"type": "json_object"})
            response = llm_formatted.invoke(messages)
        else:
            response = llm.invoke(messages)

        return get_content(response)

    def standardize_python_file(self, state, writer):
        writer({"progress": 0.1, "text": "🛠️ Standardizing system equations..."})
        try:
            equation = state.get("file_content") or load_m_file(state["file_name"])
            schema = self.prompts['standardize']['schema']

            prompt = self.prompts['standardize']['standardize_equation'].format(
                equation=equation, schema=schema
            )

            code = self._call_llm(self.llm_nvidia, prompt)
            code = code.replace("```python\n", "").replace("```", "").replace("python", "").strip()
            code = code.replace("np.", "")

            writer({"agent_tag": "📐.Equation", "log_history": code})
            return {"messages": code, "equation": code}
        except Exception as e:
            return {"messages": f"Error: {e}"}

    def system_analyser(self, state, writer):
        writer({"progress": 0.3, "text": "🔍 Analyzing system dynamics..."})
        prompt = self.prompts['system_analyser']['analyse_system'].format(equation=state["equation"])

        response = self._call_llm(self.llm_nvidia, prompt, system=True, context_messages=state.get("messages", []))
        response_content = clean_json(response, False)

        writer({"agent_tag": "🔍.System Analysis", "log_history": response_content})
        return {"messages": [response_content], "system_identification": response_content}

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
                web_search_result = state.get("web_search_result", "No web search Data available; ignore this block."),
                block_diagram_json=state.get("block_diagram_json", "No reference block diagram topology available; ignore this block.")
            )
        elif "block_diagram_json" in state:
            design_prompt = self.prompts['block_diagram_search']['design_controller']
            design_prompt = design_prompt.replace("{diagram_json}", state["block_diagram_json"])
            design_prompt = design_prompt.replace("{system_json}", sys_id)
        else:
            feedback = state.get("supervisor_comment", "No previous errors. Design the initial architecture.")
            design_prompt = self.prompts['control_loop']['design_standard'].format(
                equation=state["equation"], system_identification=sys_id,
                inputs_string=inputs_string, supervisor_comment=feedback
            )

        # 2. Get reasoning from Thinking Model
        if rag_key:
            reasoning = self._call_llm(self.llm_think, design_prompt)
        elif "block_diagram_json" in state:
            reasoning = self._call_llm(self.llm_nvidia, design_prompt)
        else:
            reasoning = self._call_llm(self.llm_think, design_prompt)

        # 3. Setting process that designed controller
        rag_name = {"web_search_result": "Web Search", "RAG_result": "RAG", "block_diagram_json":"Block Diagram Search"}
        rag_key = [key for key in rag_name.keys() if key in state]
        if rag_key:
            process = ""
            for idx, key in enumerate(rag_key):
                process += rag_name[key]
                if idx < len(rag_key)-1:
                    process += "_"
        else:
            process = "Initial"

        writer({"agent_tag": "👨‍🔧.Control Loop Analysis", "log_history": reasoning})
        return {"messages": [reasoning], "control_loop_analysis_reasoning": reasoning, "control_design_process": process}


    def control_loop_structure(self, state, writer):
        writer({"progress": 0.75, "text": "🧱 Putting results in standard format ..."})
        reasoning = state["control_loop_analysis_reasoning"]
        if "FAILED" in reasoning:
            return {"messages": ["FAILED"], "control_loop_analysis": "FAILED"}

        # 3. Format into JSON using Structure Prompt
        struct_prompt = self.prompts['control_loop']['structure'].format(reason=reasoning)
        final_json = clean_json(self._call_llm(self.llm_nvidia, struct_prompt), False)

        writer({"agent_tag": "🔁.Control Loop", "log_history": final_json})
        return {"messages": [final_json], "control_loop_analysis": final_json}



    def control_loop_supervisor(self, state, writer):
        writer({"progress": 0.8, "text": "🧐 Supervising and validating control loop..."})
        prompt = self.prompts['supervisor']['audit'].format(structure=state["control_loop_analysis"])

        response_content = self._call_llm(self.llm_think, prompt)
        writer({"agent_tag": "🧐.Supervisor", "log_history": response_content})
        return {"messages": [response_content], "supervisor_comment": response_content}


    def openai_web_search(self, state, writer):
        writer({"progress": 0.3, "text": "🌐 Searching Web ..."})

        sys_id_json = json.loads(state["system_identification"])
        file_name = state["file_name"]
        system_name = str(sys_id_json.get("system_name", ""))
        model = state.get("RAG_decision")["Model"]

        print(f"openai_web_search {model}")

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

        if hasattr(response, "usage"):
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            total_tokens = response.usage.total_tokens

            print("Input Tokens :", input_tokens)
            print("Output Tokens:", output_tokens)
            print("Total Tokens :", total_tokens)

        response_content = self._extract_responses_text(response)
        with open("output.txt", "w", encoding="utf-8") as f:
            f.write(response_content)
        # response_content = clean_json(response_content, False)

        writer({"agent_tag": "🌐.Web Search Result", "log_history": response_content})
        return{"messages": [response_content], "web_search_result": response_content}


    def openai_image_recognition(self, state, writer):
        writer({"progress": 0.5, "text": "👀 Image Recognition ..."})

        image_url = state["block_diagram_url"]
        model = state.get("RAG_decision")["Model"]

        print(f"openai_image_recognition {model}")

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

        if hasattr(response, "usage"):
            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens
            total_tokens = response.usage.total_tokens

            print("Input Tokens :", input_tokens)
            print("Output Tokens:", output_tokens)
            print("Total Tokens :", total_tokens)

        response_content = self._extract_responses_text(response)
        if not response_content.strip():
            response_content = json.dumps({
                "flag": "FAILED",
                "message": "Image recognition returned no usable content",
                "control_architecture": "NONE",
                "pid_loops": [],
            })

        writer({"agent_tag": "🤖.Image Recognition Result", "log_history": response_content})
        return {"messages": [response_content], "block_diagram_json": response_content}
