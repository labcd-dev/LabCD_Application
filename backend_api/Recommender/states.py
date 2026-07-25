from typing import TypedDict, List, Dict, Any, Optional, Union
from langgraph.graph import MessagesState


class OverallState(MessagesState):
    """Defines the state of the workflow graph."""
    file_name: str
    file_content: str
    equation: str
    system_identification: str
    control_loop_analysis_reasoning: str
    control_loop_analysis: str
    control_design_process: str
    supervisor_comment: str
    controller_graph: Dict[str, str]
    controller_json: Dict[str, str]
    RAG_decision: Dict[str, Any]
    RAG_result: str
    web_search_result: str
    block_diagram_url: str
    block_diagram_json: str
    supervisor_retry_count: int
    token_usage: Dict[str, int]
    total_cost: float
    best_score: int
    detailed_scores: Dict[str, Any]
    user_prompt: str
