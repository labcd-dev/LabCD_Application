import json
from langchain_core.messages import HumanMessage

from backend_api.Recommender.agents.file_management import clean_json, load_m_file
from backend_api.Recommender.functionalNodes.validate_structural_rules import validate_structural_rules, \
    apply_system_names
from backend_api.Recommender.functionalNodes.standardize_output import standardize_system_variables
from backend_api.base_agent import BaseLLMAgent


class Agents(BaseLLMAgent):
    def __init__(self, model_name="gpt-4o", prompt_dir="backend_api/Recommender/agents/templates"):
        # Inherit all registry, LLMs, and prompt-loading logic from BaseLLMAgent
        super().__init__(model_name=model_name, prompt_dir=prompt_dir)

    def standardize_python_file(self, state, writer):
        writer({"progress": 0.1, "text": "🛠️  Standardizing system equations..."})
        try:
            equation = state.get("file_content") or load_m_file(state["file_name"])
            schema = self.prompts['standardize']['schema']

            code, current_metrics = self.generate_response(
                prompt_file='standardize',
                prompt_key='standardize_equation',
                equation=equation,
                schema=schema
            )

            code = code.replace("```python\n", "").replace("```", "").replace("python", "").strip()
            code = code.replace("np.", "")

            writer({"agent_tag": "📝.Equation", "log_history": code})

            state_update = self.update_state_metrics(state, current_metrics)
            return {"messages": code, "equation": code, **state_update}

        except Exception as e:
            return {"messages": f"Error: {e}"}

    def system_analyser(self, state, writer):
        writer({"progress": 0.3, "text": "🔍 Analyzing system dynamics..."})

        response, current_metrics = self.generate_response(
            prompt_file='system_analyser',
            prompt_key='analyse_system',
            system=True,
            context_messages=state.get("messages", []),
            equation=state["equation"]
        )

        response_content = clean_json(response, False)
        response_content = standardize_system_variables(response_content)

        writer({"agent_tag": "🔍.System Analysis", "log_history": response_content})

        state_update = self.update_state_metrics(state, current_metrics)
        return {"messages": [response_content], "system_identification": response_content, **state_update}

    def control_loop_analyser(self, state, writer):
        writer({"progress": 0.5, "text": "👨‍🔧 Analyzing control loop structure..."})

        sys_id = state["system_identification"]
        sys_id_json = json.loads(sys_id)
        inputs_string = str(sys_id_json.get("inputs", ""))

        user_prompt = state.get("user_prompt", "").strip()
        context_msgs = [HumanMessage(content=f"User Instructions: {user_prompt}")] if user_prompt else None

        rag_key = [key for key in ["web_search_result", "RAG_result"] if key in state]

        if rag_key:
            reasoning, current_metrics = self.generate_response(
                prompt_file='control_loop',
                prompt_key='design_rag',
                context_messages=context_msgs,
                equation=state["equation"],
                system_identification=sys_id,
                inputs_string=inputs_string,
                rag_result=state.get("RAG_result", "No RAG Data available; ignore this block."),
                web_search_result=state.get("web_search_result", "No web search Data available; ignore this block."),
                block_diagram_json=state.get("block_diagram_json",
                                             "No reference block diagram topology available; ignore this block.")
            )
        elif "block_diagram_json" in state:
            feedback = state.get("supervisor_comment", "No previous errors. Design the initial architecture.")
            reasoning, current_metrics = self.generate_response(
                prompt_file='block_diagram_search',
                prompt_key='design_controller',
                context_messages=context_msgs,
                diagram_json=state["block_diagram_json"],
                system_json=sys_id,
                supervisor_comment=feedback
            )
        else:
            feedback = state.get("supervisor_comment", "No previous errors. Design the initial architecture.")
            reasoning, current_metrics = self.generate_response(
                prompt_file='control_loop',
                prompt_key='design_standard',
                context_messages=context_msgs,
                equation=state["equation"],
                system_identification=sys_id,
                inputs_string=inputs_string,
                supervisor_comment=feedback
            )

        # Set process that designed controller
        rag_name = {"web_search_result": "Web Search", "RAG_result": "RAG",
                    "block_diagram_json": "Block Diagram Search"}
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

        state_update = self.update_state_metrics(state, current_metrics)
        return {
            "messages": [reasoning],
            "control_loop_analysis_reasoning": reasoning,
            "control_design_process": process,
            **state_update
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

        formatted_resp, current_metrics = self.generate_response(
            prompt_file='control_loop',
            prompt_key='structure',
            reason=reasoning
        )

        final_json = clean_json(formatted_resp, False)
        final_json = apply_system_names(final_json, sys_id_str)

        writer({"agent_tag": "🔍  .Control Loop", "log_history": final_json})

        state_update = self.update_state_metrics(state, current_metrics)
        return {"messages": [final_json], "control_loop_analysis": final_json, **state_update}

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

        response_content, current_metrics = self.generate_response(
            prompt_file='supervisor',
            prompt_key='audit',
            structure=controller_data
        )

        if "FAILED" in response_content or "CRITICAL" in response_content:
            new_retries = current_retries + 1
        else:
            new_retries = 0

        writer({"agent_tag": "🤖 .Supervisor", "log_history": response_content})

        state_update = self.update_state_metrics(state, current_metrics)
        return {
            "messages": [response_content],
            "supervisor_comment": response_content,
            "supervisor_retry_count": new_retries,
            **state_update
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
            })

        input_tokens = getattr(response.usage, "input_tokens", 0) if hasattr(response, "usage") else 0
        output_tokens = getattr(response.usage, "output_tokens", 0) if hasattr(response, "usage") else 0

        current_metrics = self.calculate_call_metrics(input_tokens, output_tokens, model)
        response_content = self.extract_responses_text(response)

        writer({"agent_tag": "🌐.Web Search Result", "log_history": response_content})

        state_update = self.update_state_metrics(state, current_metrics)
        return {"messages": [response_content], "web_search_result": response_content, **state_update}

    def openai_image_recognition(self, state, writer):
        writer({"progress": 0.5, "text": "👀 Image Recognition ..."})

        image_url = state["block_diagram_url"]
        model = state.get("RAG_decision")["Model"]

        prompt = (self.prompts['block_diagram_search']['prompt'].format(image_url=image_url))
        schema = self.prompts['block_diagram_search']['schema']

        response = self.openai_native.responses.create(
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

        current_metrics = self.calculate_call_metrics(input_tokens, output_tokens, model)
        response_content = self.extract_responses_text(response)

        if not response_content.strip():
            response_content = json.dumps({
                "flag": "FAILED",
                "message": "Image recognition returned no usable content",
                "control_architecture": "NONE",
                "pid_loops": [],
            })

        writer({"agent_tag": "🤖.Image Recognition Result", "log_history": response_content})

        state_update = self.update_state_metrics(state, current_metrics)
        return {"messages": [response_content], "block_diagram_json": response_content, **state_update}

    def judge_controller(self, state: dict) -> dict:
        """Standard graph node to evaluate generated controllers against user prompts."""
        system_id = state.get("system_identification", "{}")
        controllers = state.get("controller_json", {})
        user_prompt = state.get("user_prompt", "").strip()

        if not controllers:
            return {"score": 0.0, "detailed_scores": {}}

        context_msgs = [
            HumanMessage(content=f"Grade the controllers based on these explicit user instructions: {user_prompt}")
        ] if user_prompt else None

        response_content, current_metrics = self.generate_response(
            prompt_file='judge',
            prompt_key='evaluate',
            system=True,
            context_messages=context_msgs,
            is_json=True,
            system_id=system_id,
            controllers=json.dumps(controllers)
        )

        try:
            scores = json.loads(clean_json(response_content, False))
        except (json.JSONDecodeError, TypeError):
            scores = {k: 0 for k in controllers.keys()}

        best_score = float(max(scores.values())) if scores else 0.0

        # Note: Your original function didn't update state metrics here, but we enforce it now to ensure LangGraph tracks costs.
        state_update = self.update_state_metrics(state, current_metrics)

        return {
            "best_score": best_score,
            "detailed_scores": scores,
            **state_update
        }