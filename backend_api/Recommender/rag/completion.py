"""Pure helpers for assessing Recommender RAG completion."""

from pathlib import Path
from typing import Dict, Mapping, Optional, Union


def assess_rag_completion(
    file_name: str,
    results_dir: Union[str, Path] = "results",
    minimum_graphs: int = 2,
    controller_graph: Optional[Mapping[str, object]] = None,
    controller_json: Optional[Mapping[str, object]] = None,
) -> Dict[str, Optional[str]]:
    """Return the next recommender step and optional error message after RAG.

    Prefers checkpoint state (controller_json / controller_graph) when available,
    then falls back to counting graph PNG files under results_dir.
    """
    if controller_json is not None and len(controller_json) >= minimum_graphs:
        return {"next_step": "comparison", "error_message": ""}

    if controller_graph is not None and len(controller_graph) >= minimum_graphs:
        return {"next_step": "comparison", "error_message": ""}

    results_path = Path(results_dir)
    count = 0
    if results_path.is_dir():
        prefix = f"{file_name}_controller_graph_"
        count = sum(
            1
            for filename in results_path.iterdir()
            if filename.is_file()
            and filename.name.startswith(prefix)
            and filename.suffix.lower() == ".png"
        )

    if count >= minimum_graphs:
        return {"next_step": "comparison", "error_message": ""}

    return {
        "next_step": "review",
        "error_message": (
            "The Block Diagram Search Failed to find proper result please try another method"
        ),
    }
