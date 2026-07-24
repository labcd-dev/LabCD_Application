"""Health and metadata routes."""

from fastapi import APIRouter

from backend_api.http.config import DEFAULT_LLM_MODELS, RAG_MODEL_OPTIONS
from backend_api.http.schemas.common import ModelsResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@router.get("/models", response_model=ModelsResponse)
def list_models() -> ModelsResponse:
    return ModelsResponse(llm_models=DEFAULT_LLM_MODELS, rag_models=RAG_MODEL_OPTIONS)
