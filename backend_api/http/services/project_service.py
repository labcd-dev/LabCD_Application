"""CRUD and lifecycle helpers for persisted design projects."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session, joinedload

from backend_api.common.serialization import make_serializable
from backend_api.db.models import Project, User
from backend_api.db.session import SessionLocal
from backend_api.http.config import RESULTS_DIR
from backend_api.http.services.dynamics_file_service import (
    delete_dynamics_file,
    save_dynamics_file,
)

VALID_PIPELINE_TYPES = frozenset({"siloDesign", "muloDesign"})
VALID_STATUSES = frozenset({"draft", "running", "completed", "failed", "cancelled"})


class ProjectAccessDenied(PermissionError):
    """Raised when a non-admin tries to access another user's project."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _title_from(objective: str | None, file_name: str, pipeline_type: str) -> str:
    cleaned = (objective or "").strip()
    if cleaned:
        return cleaned[:120]
    if file_name.strip():
        return file_name.strip()[:120]
    label = "Single Loop" if pipeline_type == "siloDesign" else "Multi Loop"
    return f"{label} project"


def project_to_summary(project: Project, *, include_owner: bool = False) -> dict[str, Any]:
    return {
        "id": project.id,
        "user_id": project.user_id,
        "owner_email": project.owner.email if include_owner and project.owner else None,
        "title": project.title,
        "pipeline_type": project.pipeline_type,
        "status": project.status,
        "file_name": project.file_name,
        "file_type": project.file_type,
        "file_url": project.file_url,
        "llm_model": project.llm_model or "gpt-4o",
        "has_results": bool(project.results),
        "job_id": project.job_id,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def project_to_detail(project: Project, *, include_owner: bool = False) -> dict[str, Any]:
    data = project_to_summary(project, include_owner=include_owner)
    data.update(
        {
            "file_content": project.file_content or "",
            "control_objective": project.control_objective,
            "results": project.results,
        }
    )
    return data


def _persist_project_file(project: Project) -> None:
    """Write project dynamics content to disk and set file_url."""
    url = save_dynamics_file(
        content=project.file_content or "",
        file_name=project.file_name or "dynamics.py",
        file_type=project.file_type or "python",
        existing_url=project.file_url,
    )
    if url:
        project.file_url = url


def ensure_project_file_on_disk(db: Session, project: Project) -> Project:
    """Backfill on-disk file for legacy projects that only have DB content."""
    if project.file_url:
        return project
    if not (project.file_content or "").strip():
        return project
    _persist_project_file(project)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def create_project(
    db: Session,
    *,
    user_id: int,
    pipeline_type: str,
    title: str | None = None,
    file_name: str = "",
    file_type: str = "python",
    file_content: str = "",
    llm_model: str = "gpt-4o",
    control_objective: str | None = None,
    status: str = "draft",
    job_id: str | None = None,
    results: dict[str, Any] | None = None,
) -> Project:
    if pipeline_type not in VALID_PIPELINE_TYPES:
        raise ValueError(f"Invalid pipeline_type: {pipeline_type}")
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}")

    locked_model = (llm_model or "").strip() or "gpt-4o"
    project = Project(
        user_id=user_id,
        title=_title_from(title or control_objective, file_name, pipeline_type),
        pipeline_type=pipeline_type,
        status=status,
        file_name=file_name or "",
        file_type=file_type or "python",
        file_content=file_content or "",
        llm_model=locked_model,
        control_objective=control_objective,
        job_id=job_id,
        results=make_serializable(results) if results is not None else None,
        created_at=_now(),
        updated_at=_now(),
    )
    _persist_project_file(project)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def get_project(db: Session, project_id: int) -> Project | None:
    return (
        db.query(Project)
        .options(joinedload(Project.owner))
        .filter(Project.id == project_id)
        .first()
    )


def list_projects_for_user(db: Session, user_id: int) -> list[Project]:
    return (
        db.query(Project)
        .filter(Project.user_id == user_id)
        .order_by(Project.updated_at.desc())
        .all()
    )


def list_all_projects(
    db: Session,
    *,
    user_id: int | None = None,
    pipeline_type: str | None = None,
) -> list[Project]:
    query = db.query(Project).options(joinedload(Project.owner))
    if user_id is not None:
        query = query.filter(Project.user_id == user_id)
    if pipeline_type is not None:
        query = query.filter(Project.pipeline_type == pipeline_type)
    return query.order_by(Project.updated_at.desc()).all()


def update_project(
    db: Session,
    project: Project,
    *,
    title: str | None = None,
    status: str | None = None,
    control_objective: str | None = None,
    file_name: str | None = None,
    file_type: str | None = None,
    file_content: str | None = None,
    job_id: str | None = None,
    results: dict[str, Any] | None = None,
) -> Project:
    if title is not None:
        project.title = title.strip()[:200] or project.title
    if status is not None:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}")
        project.status = status
    if control_objective is not None:
        project.control_objective = control_objective
    file_changed = False
    if file_name is not None:
        project.file_name = file_name
        file_changed = True
    if file_type is not None:
        project.file_type = file_type
        file_changed = True
    if file_content is not None:
        project.file_content = file_content
        file_changed = True
    if job_id is not None:
        project.job_id = job_id
    if results is not None:
        project.results = make_serializable(results)
    if file_changed:
        _persist_project_file(project)
    project.updated_at = _now()
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project: Project) -> None:
    delete_dynamics_file(project.file_url)
    db.delete(project)
    db.commit()


def assert_project_access(project: Project, user: User) -> None:
    if user.is_admin:
        return
    if project.user_id != user.id:
        raise ProjectAccessDenied("Project access denied")


def resolve_project_artifact_path(project: Project, filename: str) -> Path:
    """Return a safe RESULTS_DIR path for a project-owned artifact filename."""
    safe_name = Path(filename).name
    if not safe_name or safe_name != Path(filename.replace("\\", "/")).name:
        raise ValueError("Invalid artifact filename")

    results = project.results if isinstance(project.results, dict) else {}
    allowed = {
        Path(str(results[key])).name
        for key in ("pdf_file", "time_response_file")
        if isinstance(results.get(key), str) and results.get(key)
    }
    if allowed and safe_name not in allowed:
        raise FileNotFoundError("Artifact not found for this project")

    file_path = Path(RESULTS_DIR) / safe_name
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError("Artifact not found")
    return file_path


def assert_project_llm_model(
    db: Session,
    project_id: int | None,
    requested_model: str | None,
) -> None:
    """Reject job starts that try to use a different model than the project lock."""
    if project_id is None:
        return
    project = get_project(db, project_id)
    if project is None:
        return
    locked = (project.llm_model or "").strip()
    if not locked:
        return
    requested = (requested_model or "").strip()
    if requested and requested != locked:
        raise ValueError(
            f"This project is locked to model '{locked}' and cannot use '{requested}'."
        )


def sync_project_from_job(
    *,
    project_id: int | None,
    job_id: str,
    status: str,
    results: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Update a project from a background job thread (opens its own DB session)."""
    if project_id is None:
        return
    db = SessionLocal()
    try:
        project = get_project(db, project_id)
        if project is None:
            return
        payload: dict[str, Any] = {"job_id": job_id, "status": status}
        if results is not None:
            payload["results"] = results
        elif error:
            payload["results"] = {"error": error}
        update_project(db, project, **payload)
    finally:
        db.close()


def link_or_create_for_job(
    *,
    user_id: int | None,
    project_id: int | None,
    pipeline_type: str,
    job_id: str,
    file_name: str = "",
    file_type: str = "python",
    file_content: str = "",
    control_objective: str | None = None,
    title: str | None = None,
) -> Optional[int]:
    """Attach a running job to an existing project or create one. Returns project id."""
    if user_id is None:
        return None
    db = SessionLocal()
    try:
        project: Project | None = None
        if project_id is not None:
            project = get_project(db, project_id)
            if project is not None and project.user_id != user_id:
                project = None

        if project is None:
            project = create_project(
                db,
                user_id=user_id,
                pipeline_type=pipeline_type,
                title=title,
                file_name=file_name,
                file_type=file_type,
                file_content=file_content,
                control_objective=control_objective,
                status="running",
                job_id=job_id,
            )
        else:
            update_project(
                db,
                project,
                status="running",
                job_id=job_id,
                control_objective=control_objective,
                file_name=file_name or None,
                file_type=file_type or None,
                file_content=file_content or None,
                title=title,
            )
        return project.id
    finally:
        db.close()
