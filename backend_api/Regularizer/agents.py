import yaml
import os

from langchain_groq import ChatGroq
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from openai import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend_api.Regularizer.file_management import clean_json, get_content


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
    def __init__(self, model_name="gpt-oss-120b", prompt_dir="backend_api/Regularizer/templates"):
        self.main_model = self._choose_model(model_name)
        self.gpt_oss = ChatNVIDIA(model="openai/gpt-oss-120b", temperature=0, max_completion_tokens=16000)

        self.prompts = {}
        self._load_all_prompts(prompt_dir)


    def _choose_model(self, model_name):
        if model_name == "gpt-oss-120b":
            return ChatNVIDIA(model="openai/gpt-oss-120b", temperature=0, max_completion_tokens=16000)
        elif model_name.startswith("gpt"):
            print("gpt")

            return ChatOpenAI(model=model_name, temperature=0)
        else:
            return ChatNVIDIA(model= model_name, temperature=0, max_completion_tokens=16000)
            # self.qwen_coder = ChatNVIDIA(model="qwen/qwen3-next-80b-a3b-instruct", temperature=0,
            #                              max_completion_tokens=16000)
            # self.llama_4 = ChatNVIDIA(model="meta/llama-4-maverick-17b-128e-instruct", temperature=0,
            #                           max_completion_tokens=16000)
            # self.openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


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


    def fix_syntax_error(self, static_errors, syntax_errors, previous_attempts):
        # Pass the formatted string of previous failed JSON attempts
        prompt = self.prompts['fix_error']['fix_syntax_error'].format(
            static_errors=static_errors,
            syntax_errors=syntax_errors,
            previous_attempts=previous_attempts
        )
        response_text = self._call_llm(self.main_model, prompt, system=True, is_json=True)
        print("response is here")
        parsed_json = clean_json(str(response_text), True)
        return parsed_json

    def fix_whole_code(self, code):
        prompt = self.prompts['fix_error']['fix_whole_code'].format(
            code = code
        )
        response_text = self._call_llm(self.main_model, prompt, system=True, is_json=False)
        return response_text


    def standardize_python_file(self, equation, silo_designer = True):
        # writer({"progress": 0.1, "text": "ðŸ› ï¸ Standardizing system equations..."})
        try:
            schema = self.prompts['standardize']['schema']

            prompt = self.prompts['standardize']['standardize_equation'].format(
                equation=equation, schema=schema
            )

            code = self._call_llm(self.main_model, prompt)
            code = code.replace("```python\n", "").replace("```", "").replace("python", "").strip()
            code = code.replace("np.", "")
            if silo_designer:
                code = code.replace("system_dynamics", "dynamics")

            # writer({"agent_tag": "ðŸ“.Equation", "log_history": code})
            return code
        except Exception as e:
            return {"messages": f"Error: {e}"}


if __name__ == "__main__":
    import os

    # Set your API key directly in code
    os.environ["NVIDIA_API_KEY"] = "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"

    # Now this will work
    llm = ChatNVIDIA()
    available_models = llm.get_available_models()

    print("Your available models:")
    for model in available_models:
        print(f"- {model.id}")

