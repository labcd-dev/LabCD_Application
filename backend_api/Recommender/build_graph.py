from backend_api.Recommender.agents.agents import Agents
from backend_api.Recommender.rag.search_engine import SearchEngine
from backend_api.Recommender.functionalNodes.create_controller_graph import create_controller_graph
from backend_api.Recommender.states import OverallState

from dotenv import load_dotenv
from langgraph.graph import START, StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

MAX_SUPERVISOR_RETRIES = 5


def reset_retry_node(state: OverallState):
    """Explicitly resets the supervisor retry counter to 0."""
    return {"supervisor_retry_count": 0}


def route_after_reset(state: OverallState):
    """Routes the graph to the correct next step after resetting the counter."""
    last_message = state.get("supervisor_comment", "")

    # If we exited because of success, move to graph creation
    if "CONTINUE" in last_message:
        return "create_controller_graph"

    # If we exited because of max retries, end the flow (or route to human review)
    return "end"


def supervisor_edge(state: OverallState):
    last_message = state.get("supervisor_comment", "")

    # EXIT CONDITION 1: Success (Less than max retries)
    if "CONTINUE" in last_message:
        return "reset_retry_node"

    retries = state.get("supervisor_retry_count", 0)
    if retries >= MAX_SUPERVISOR_RETRIES:
        print(f"⚠️ Supervisor max retries ({MAX_SUPERVISOR_RETRIES}) reached. Routing to human review.")
        return "reset_retry_node"

    # Otherwise, loop back to the analyser
    return "control_loop_analyser"


# Human-in-the-loop decision logic
def choose_rag_pipeline(state: OverallState):
    # This key will be populated by the UI during the interrupt (or automatically if bypassed)
    rag_decision = state.get("RAG_decision", {})
    if "Flag" in rag_decision:
        if "BLOCK_DIAGRAM_SEARCH" in rag_decision["Flag"]:
            rag_decision["Flag"].remove("BLOCK_DIAGRAM_SEARCH")
            state["RAG_decision"] = rag_decision
            return "block_diagram_search"
        elif "OPENAI_WEB_SEARCH" in rag_decision["Flag"]:
            rag_decision["Flag"].remove("OPENAI_WEB_SEARCH")
            state["RAG_decision"] = rag_decision
            return "openai_web_search"
    return "end"


def check_human_intervention_condition(state: OverallState):
    result = choose_rag_pipeline(state)
    if result == "end":
        return "judge"
    else:
        return result


def fail_create_controller(state: OverallState):
    controller = state.get("control_loop_analysis", "")
    if "FAILED" in controller:
        return "block_diagram_search"
    return "control_loop_supervisor"


def fail_finding_block_diagram_search(state: OverallState):
    image_recognition = state.get("block_diagram_json", "")
    if "FAILED" in image_recognition:
        return "block_diagram_search"
    return "control_loop_analyser"


def fail_finding_block_diagram_url(state: OverallState):
    block_diagram_url = state.get("block_diagram_url", "")
    rag_decision = state.get("RAG_decision", {})
    if "FAILED" in block_diagram_url:
        if "OPENAI_WEB_SEARCH" in rag_decision:
            rag_decision["Flag"].remove("OPENAI_WEB_SEARCH")
            state["RAG_decision"] = rag_decision
            return "openai_web_search"
        return "end"
    return "openai_image_recognition"


def build_graph(model_name):
    load_dotenv()
    memory = MemorySaver()

    agnt = Agents(model_name)
    search_engine = SearchEngine()
    builder = StateGraph(OverallState)

    # Define nodes
    # builder.add_node("standardize_matlab_file", agnt.standardize_python_file)
    builder.add_node("system_analyser", agnt.system_analyser)
    builder.add_node("control_loop_analyser", agnt.control_loop_analyser)
    builder.add_node("control_loop_structure", agnt.control_loop_structure)
    builder.add_node("control_loop_supervisor", agnt.control_loop_supervisor)
    builder.add_node("create_controller_graph", create_controller_graph)
    builder.add_node("openai_web_search", agnt.openai_web_search)
    builder.add_node("block_diagram_search", search_engine.tavily_block_diagram_search)
    builder.add_node("openai_image_recognition", agnt.openai_image_recognition)
    builder.add_node("human_review", lambda state: {})
    # NEW: Register the reset node
    builder.add_node("reset_retry_node", reset_retry_node)
    # Pass the method reference directly into the workflow builder
    builder.add_node("judge", agnt.judge_controller)

    # Core Flow
    # builder.add_edge(START, "standardize_matlab_file")
    # builder.add_edge("standardize_matlab_file", "system_analyser")
    builder.add_edge(START, "system_analyser")
    builder.add_edge("system_analyser", "control_loop_analyser")
    builder.add_edge("control_loop_analyser", "control_loop_structure")
    builder.add_conditional_edges(
        "control_loop_structure",
        fail_create_controller,
        {
            "block_diagram_search": "block_diagram_search",
            "control_loop_supervisor": "control_loop_supervisor"
        }
    )

    # Routing from Supervisor
    builder.add_conditional_edges(
        "control_loop_supervisor",
        supervisor_edge,
        {
            "control_loop_analyser": "control_loop_analyser",
            "reset_retry_node": "reset_retry_node"  # Both exits now funnel here
        }
    )

    # NEW: Routing out of the Reset Node
    builder.add_conditional_edges(
        "reset_retry_node",
        route_after_reset,
        {
            "create_controller_graph": "create_controller_graph",
            "end": END
        }
    )

    # NEW: Conditional edge after graph creation to check if human review is needed
    builder.add_conditional_edges(
        "create_controller_graph",
        check_human_intervention_condition,
        {
            "human_review": "human_review",
            "openai_web_search": "openai_web_search",
            "block_diagram_search": "block_diagram_search",
            "judge": "judge"
        }
    )
    builder.add_edge("judge", END)

    # NEW: Routing out of the human review node once resumed
    builder.add_conditional_edges(
        "human_review",
        choose_rag_pipeline,
        {
            "openai_web_search": "openai_web_search",
            "block_diagram_search": "block_diagram_search",
            "end": END
        }
    )

    # Loop back to analysis after searching
    builder.add_edge("openai_web_search", "control_loop_analyser")

    builder.add_conditional_edges(
        "block_diagram_search",
        fail_finding_block_diagram_url,
        {
            "openai_image_recognition": "openai_image_recognition",
            "openai_web_search": "openai_web_search",
            "end": END
        }
    )
    builder.add_conditional_edges(
        "openai_image_recognition",
        fail_finding_block_diagram_search,
        {
            "block_diagram_search": "block_diagram_search",
            "control_loop_analyser": "control_loop_analyser"
        }
    )

    # NEW: Compile with interrupt BEFORE the human review node instead of after graph creation
    react_graph = builder.compile(
        checkpointer=memory,
        interrupt_before=["human_review"]
    )

    return react_graph


def draw_graph_diagram(app: StateGraph, output_path: str = "workflow_graph.png"):
    """
    Draw the workflow graph to a file for visualization.

    Args:
        app: Compiled StateGraph
        output_path: Path to save the diagram
    """
    try:
        app.get_graph().draw_mermaid_png(output_file_path=output_path)
        print(f"Workflow graph diagram saved to {output_path}")
    except Exception as e:
        print(f"Could not draw graph: {e}. You may need to install graphviz and mermaid-cli.")


def run_recommender_workflow(graph, config, graph_input=None, q=None) -> dict:
    """Synchronously executes the workflow and returns the final summary."""
    result = {
        "success": False,
        "flag": "",
        "error": "",
        "token_usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        "price": 0.0,
        "best_score": None
    }

    try:
        stream_input = graph_input if graph_input else None

        for mode, content in graph.stream(stream_input, config, stream_mode=["updates", "custom"]):
            if q is not None:
                q.put({"type": "stream", "mode": mode, "content": content})

        # Graph is completely finished here, including the judge
        final_state = graph.get_state(config).values

        result.update({
            "success": True,
            "flag": "success",
            "token_usage": final_state.get("token_usage", result["token_usage"]),
            "price": final_state.get("total_cost", 0.0),
            "best_score": final_state.get("best_score", 0.0),
            "detailed_scores": final_state.get("detailed_scores", {})
        })

    except Exception as e:
        error_msg = str(e)
        result["success"] = False
        result["error"] = error_msg

        if any(keyword in error_msg for keyword in ["Connection", "Timeout", "APIConnectionError", "Max retries"]):
            result["flag"] = "connection_lost"
        elif any(keyword in error_msg for keyword in ["RateLimit", "Authentication", "401", "429"]):
            result["flag"] = "api_error"
        elif any(keyword in error_msg for keyword in ["OutputParserException", "JSONDecodeError", "parse", "llm"]):
            result["flag"] = "llm_failure"
        else:
            result["flag"] = "error"

    return result