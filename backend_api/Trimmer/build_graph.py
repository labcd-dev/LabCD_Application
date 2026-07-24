"""
build_graph.py - State machine definition and workflow orchestration

This module defines the LangGraph workflow, including nodes, edges, and conditional logic.
It orchestrates the overall control system analysis workflow.
"""
from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from functools import partial


from backend_api.Trimmer.states import WorkflowState
from backend_api.Trimmer.functionalNodes.create_controller_graph import (
    analyze_result,
    handle_convergence_failure,
    handle_mismatch_failure,
    generate_output
)
from backend_api.Trimmer.agenticNodes.agents import Agents
from backend_api.Trimmer.functionalNodes.validate_config_only import validate_config_only
from backend_api.Trimmer.functionalNodes.solver_engine import plan_strategy, solve_equilibrium_node
from backend_api.Trimmer.services.human_input import HumanInputRequired


def where_to_go_after_solver(state: WorkflowState) -> str:
    """Conditional edge after the solver node."""
    if state['converged']:
        return 'analyze_result'
    else:
        return 'handle_convergence_failure'

def where_to_go_after_analysis(state: WorkflowState) -> str:
    """Conditional edge after the analysis node."""
    if state.get('equilibrium_match', False):
        return 'generate_output'
    else:
        if state['restart_count'] >= state['max_restarts']:
            return 'handle_mismatch_failure'
        else:
            return 'plan_strategy'

def where_to_go_after_intervention(state: WorkflowState) -> str:
    """Conditional edge after human intervention."""
    user_choice = state.get('user_choice', 'exit')
    choices = {
        'exit': 'generate_output',
        'exit_best_possible': 'generate_output',
        'restart_from_parser': 'parse_system',
        'validate_config_only': 'validate_config_only',
        'replan': 'plan_strategy',
        'retry_solver': 'solve_equilibrium',
        'retry_solver_with_new_guess': 'solve_equilibrium'
    }
    return choices.get(user_choice, 'generate_output')

def build_workflow_graph(model_name) -> StateGraph:
    """
    Build and return the LangGraph workflow.

    Returns:
        Compiled StateGraph ready for execution
    """
    load_dotenv()

    # Initialize the graph
    workflow_graph = StateGraph(WorkflowState)
    agents = Agents(model_name)

    # Add nodes to the graph
    workflow_graph.add_node("parse_system", agents.parse_system)  # Bound method, already safe
    workflow_graph.add_node("validate_config_only", partial(validate_config_only, agents=agents))
    workflow_graph.add_node("plan_strategy", partial(plan_strategy, agents=agents))
    workflow_graph.add_node("solve_equilibrium", partial(solve_equilibrium_node, agents=agents))
    workflow_graph.add_node("analyze_result", partial(analyze_result, agents=agents))
    workflow_graph.add_node("handle_convergence_failure", partial(handle_convergence_failure, agents=agents))
    workflow_graph.add_node("handle_mismatch_failure", partial(handle_mismatch_failure, agents=agents))
    workflow_graph.add_node("generate_output", generate_output)

    # Define the graph's flow
    workflow_graph.set_entry_point("parse_system")
    workflow_graph.add_edge("parse_system", "plan_strategy")
    workflow_graph.add_edge("validate_config_only", "plan_strategy")
    workflow_graph.add_edge("plan_strategy", "solve_equilibrium")

    # Conditional logic from solver
    workflow_graph.add_conditional_edges(
        "solve_equilibrium",
        where_to_go_after_solver,
        {
            "analyze_result": "analyze_result",
            "handle_convergence_failure": "handle_convergence_failure",
            "generate_output": "generate_output"
        }
    )

    # Conditional logic from analysis
    workflow_graph.add_conditional_edges(
        "analyze_result",
        where_to_go_after_analysis,
        {
            "generate_output": "generate_output",
            "handle_mismatch_failure": "handle_mismatch_failure",
            "plan_strategy": "plan_strategy"
        }
    )

    # Conditional logic from human intervention nodes
    workflow_graph.add_conditional_edges(
        "handle_convergence_failure",
        where_to_go_after_intervention,
        {
            "parse_system": "parse_system",
            "plan_strategy": "plan_strategy",
            "generate_output": "generate_output",
            "solve_equilibrium": "solve_equilibrium",
            "validate_config_only": "validate_config_only"
        }
    )
    workflow_graph.add_conditional_edges(
        "handle_mismatch_failure",
        where_to_go_after_intervention,
        {
            "parse_system": "parse_system",
            "plan_strategy": "plan_strategy",
            "generate_output": "generate_output",
            "solve_equilibrium": "solve_equilibrium",
            "validate_config_only": "validate_config_only"
        }
    )

    # Final output node leads to the end
    workflow_graph.add_edge("generate_output", END)

    # Compile the graph
    app = workflow_graph.compile()

    return app

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


def run_trimmer_workflow(graph, initial_state, q=None, config=None) -> dict:
    """
    Wraps the execution of the Trimmer LangGraph workflow, handles exceptions
    (including human intervention), and returns a standardized summary.
    """
    final_result = {}
    result = {
        "success": False,
        "flag": "",
        "error": "",
        "token_usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        "price": 0.0,
        "pending_request": None,
    }

    # Provide a default thread configuration if none is passed
    if config is None:
        config = {"configurable": {"thread_id": "trimmer_default"}}

    try:
        # Stream updates, custom events, and state values to the queue
        for mode, content in graph.stream(initial_state, config, stream_mode=["updates", "custom", "values"]):
            if q is not None:
                q.put({"type": "stream", "mode": mode, "content": content})

            # Keep track of the latest state values for final metrics
            if mode == "values":
                final_result = content


        # Extract costs, tokens, and stability status from the final state dictionary
        if final_result:
            stability = final_result.get("classification", "")

            # Store the stability status in the flag, default to success if empty
            result["flag"] = stability if stability else "success"
            result["success"] = False if "unstable" in stability else True
            result["token_usage"] = final_result.get("token_usage", result["token_usage"])
            result["price"] = final_result.get("total_cost", 0.0)

    except HumanInputRequired as exc:
        # Catch the human-in-the-loop interruption gracefully
        result["success"] = False
        result["flag"] = "human_input"
        result["pending_request"] = exc.request

    except Exception as e:
        error_msg = str(e)
        result["success"] = False
        result["error"] = error_msg

        # Standardized error flags
        if any(keyword in error_msg for keyword in ["Connection", "Timeout", "APIConnectionError", "Max retries"]):
            result["flag"] = "connection_lost"
        elif any(keyword in error_msg for keyword in ["RateLimit", "Authentication", "401", "429"]):
            result["flag"] = "api_error"
        elif any(keyword in error_msg for keyword in ["OutputParserException", "JSONDecodeError", "parse", "llm"]):
            result["flag"] = "llm_failure"
        else:
            result["flag"] = "error"

    return result