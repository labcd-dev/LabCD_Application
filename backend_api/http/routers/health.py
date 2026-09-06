"""Health and metadata routes."""

from fastapi import APIRouter, Depends

from backend_api.db.models import User
from backend_api.http.config import DEFAULT_LLM_MODELS, RAG_MODEL_OPTIONS
from backend_api.http.dependencies import get_optional_user
from backend_api.http.schemas.common import ModelsResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    from pathlib import Path
    from backend_api.http.services.plant_artifact_service import default_artifacts_dir
    from sqlalchemy import text

    db_ok = False
    try:
        from backend_api.db.session import SessionLocal
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            db_ok = True
    except Exception:
        db_ok = False

    art_dir = default_artifacts_dir()
    art_ok = Path(art_dir).is_dir()

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "offline",
        "artifacts_dir": str(art_dir),
        "artifacts_accessible": art_ok,
    }


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
