"""Health and metadata routes."""

from fastapi import APIRouter, Depends

from backend_api.db.models import User
from backend_api.http.config import DEFAULT_LLM_MODELS, RAG_MODEL_OPTIONS
from backend_api.http.dependencies import get_optional_user
from backend_api.http.schemas.common import ModelsResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@router.get("/models", response_model=ModelsResponse)
def list_models(user: User | None = Depends(get_optional_user)) -> ModelsResponse:
    """Return LLM/RAG model catalogs, filtered by the caller's plan when authenticated."""
    if user is None:
        llm_models = list(DEFAULT_LLM_MODELS)
    elif user.role is not None and user.role.is_system:
        llm_models = list(DEFAULT_LLM_MODELS)
    else:
        allowed = set(user.model_ids())
        llm_models = [model for model in DEFAULT_LLM_MODELS if model in allowed]

    allowed_set = set(llm_models)
    rag_models = [model for model in RAG_MODEL_OPTIONS if model in allowed_set]
    return ModelsResponse(llm_models=llm_models, rag_models=rag_models)
