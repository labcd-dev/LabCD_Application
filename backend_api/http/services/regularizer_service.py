"""Regularizer HTTP service adapter."""

from backend_api.Regularizer.agents import Agents
from backend_api.Regularizer.file_management import detect_file_type
from backend_api.Regularizer.fix_syntax_error import fix_code


def run_regularize(file_content: str, file_name: str, file_type: str, model: str) -> dict:
    fixed, change_applied, human_intervention = fix_code(
        file_content,
        model=model,
        file_type=file_type,
    )
    return {
        "file_content": fixed,
        "change_applied": change_applied,
        "human_intervention": human_intervention,
        "file_name": file_name,
        # Output is always Python after regularization (MATLAB is converted during fix_code).
        "file_type": "python",
    }


def run_standardize(file_content: str, model: str, silo_pipeline: bool) -> dict:
    agents = Agents(model)
    standardized = agents.standardize_python_file(file_content, silo_pipeline)
    return {"file_content": standardized}


def detect_upload_type(filename: str) -> tuple[str, str]:
    return detect_file_type(filename)
