import os
from dotenv import load_dotenv

from backend_api.Recommender.agents.file_management import load_m_file

# Assuming base_agent is located here based on your previous imports
from backend_api.base_agent import BaseLLMAgent


class Agents(BaseLLMAgent):
    def __init__(self, model_name="gpt-oss-120b", prompt_dir="templates"):
        # Inherit all registry, LLMs, and prompt-loading logic from BaseLLMAgent
        super().__init__(model_name=model_name, prompt_dir=prompt_dir)

    def constraint_estimator(self, controller_structure, trimming_result):
        # writer({"progress": 0.3, "text": "🔍 Analyzing system dynamics..."})

        response_content, current_metrics = self.generate_response(
            prompt_file='constraint_estimator',
            prompt_key='constraint_estimator',
            system=True,
            is_json=True,
            CONTROLLER_STRUCTURE_JSON=controller_structure,
            TRIM_JSON=trimming_result
        )

        # writer({"agent_tag": "🔍.System Analysis", "log_history": response_content})
        return response_content

    def constraint_estimator_web(self, controller_structure, trimming_result, model):
        # writer({"progress": 0.3, "text": "🌐 Searching Web ..."})

        prompt = self.prompts['constraint_estimator_web']['constraint_estimator_web'].format(
            CONTROLLER_STRUCTURE_JSON=controller_structure,
            TRIM_JSON=trimming_result
        )
        schema = self.prompts['constraint_estimator_web']['schema']

        # Tool calls bypass execute_llm_call, so we use self.openai_native directly
        response = self.openai_native.responses.create(
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
            }
        )

        input_tokens = getattr(response.usage, "input_tokens", 0) if hasattr(response, "usage") else 0
        output_tokens = getattr(response.usage, "output_tokens", 0) if hasattr(response, "usage") else 0

        # Delegate pricing calculation and logging to the base class
        current_metrics = self.calculate_call_metrics(input_tokens, output_tokens, model)

        # Delegate response extraction to the base class
        response_content = self.extract_responses_text(response)

        # writer({"agent_tag": "🌐.Web Search Result", "log_history": response_content})
        return response_content


if __name__ == '__main__':
    load_dotenv()

    controller = load_m_file("inputs/aircraft.json")
    trimming = load_m_file("inputs/aircraft_trim.json")

    # Initialize using the base class parameters
    agents = Agents(model_name="gpt-oss-120b")

    import pprint

    # pprint.pprint(agents.constraint_estimator(controller, trimming))
    pprint.pprint(agents.constraint_estimator_web(controller, trimming, 'gpt-5.4'))