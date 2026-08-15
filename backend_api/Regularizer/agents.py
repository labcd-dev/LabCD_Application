import os
from backend_api.Regularizer.file_management import clean_json

# Assuming base_agent is located here based on your previous structure
from backend_api.base_agent import BaseLLMAgent


class Agents(BaseLLMAgent):
    def __init__(self, model_name="gpt-oss-120b", prompt_dir="backend_api/Regularizer/templates"):
        # Inherit all registry, LLMs, and prompt-loading logic from BaseLLMAgent
        super().__init__(model_name=model_name, prompt_dir=prompt_dir)

    def fix_syntax_error(self, static_errors, syntax_errors, previous_attempts):
        # Pass the formatted string of previous failed JSON attempts
        response_text, _ = self.generate_response(
            prompt_file='fix_error',
            prompt_key='fix_syntax_error',
            system=True,
            is_json=True,
            static_errors=static_errors,
            syntax_errors=syntax_errors,
            previous_attempts=previous_attempts
        )

        print("response is here")
        parsed_json = clean_json(str(response_text), True)
        return parsed_json

    def fix_whole_code(self, code):
        response_text, _ = self.generate_response(
            prompt_file='fix_error',
            prompt_key='fix_whole_code',
            system=True,
            is_json=False,
            code=code
        )
        return response_text

    def standardize_python_file(self, equation, silo_designer=True):
        # writer({"progress": 0.1, "text": "🛠️  Standardizing system equations..."})
        try:
            schema = self.prompts['standardize']['schema']

            code, _ = self.generate_response(
                prompt_file='standardize',
                prompt_key='standardize_equation',
                equation=equation,
                schema=schema
            )

            code = code.replace("```python\n", "").replace("```", "").replace("python", "").strip()
            code = code.replace("np.", "")
            if silo_designer:
                code = code.replace("system_dynamics", "dynamics")

            # writer({"agent_tag": "📝.Equation", "log_history": code})
            return code
        except Exception as e:
            return {"messages": f"Error: {e}"}


if __name__ == "__main__":
    from langchain_nvidia_ai_endpoints import ChatNVIDIA

    # Set your API key directly in code
    os.environ["NVIDIA_API_KEY"] = "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"

    # Now this will work
    llm = ChatNVIDIA()
    available_models = llm.get_available_models()

    print("Your available models:")
    for model in available_models:
        print(f"- {model.id}")