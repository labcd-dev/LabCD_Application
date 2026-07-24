"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend_api.db.session import init_db
from backend_api.http.config import API_PREFIX, CORS_ORIGINS, UPLOADS_DIR
from backend_api.http.routers import (
    admin,
    auth,
    case_studies,
    health,
    jobs,
    mulo,
    projects,
    recommender,
    regularizer,
    silo,
    trimmer,
    upload,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="LabCD API",
        description="FastAPI backend for LabCD control-system design pipelines.",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(admin.router, prefix=API_PREFIX)
    app.include_router(projects.router, prefix=API_PREFIX)
    app.include_router(upload.router, prefix=API_PREFIX)
    app.include_router(regularizer.router, prefix=API_PREFIX)
    app.include_router(recommender.router, prefix=API_PREFIX)
    app.include_router(trimmer.router, prefix=API_PREFIX)
    app.include_router(silo.router, prefix=API_PREFIX)
    app.include_router(mulo.router, prefix=API_PREFIX)
    app.include_router(jobs.router, prefix=API_PREFIX)
    app.include_router(case_studies.router, prefix=API_PREFIX)
    app.mount(f"{API_PREFIX}/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
    return app


app = create_app()
