"""User-facing project history routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user
from backend_api.http.schemas.projects import (
    ProjectCreateRequest,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdateRequest,
)
from backend_api.http.services import project_service
from backend_api.http.services.project_service import ProjectAccessDenied

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectSummary])
def list_my_projects(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProjectSummary]:
    projects = project_service.list_projects_for_user(db, user.id)
    return [ProjectSummary(**project_service.project_to_summary(p)) for p in projects]


@router.post("", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_my_project(
    request: ProjectCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectDetail:
    try:
        project = project_service.create_project(
            db,
            user_id=user.id,
            pipeline_type=request.pipeline_type,
            title=request.title,
            file_name=request.file_name,
            file_type=request.file_type,
            file_content=request.file_content,
            control_objective=request.control_objective,
            status="draft",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectDetail(**project_service.project_to_detail(project))


@router.get("/{project_id}", response_model=ProjectDetail)
def get_my_project(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectDetail:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        project_service.assert_project_access(project, user)
    except ProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ProjectDetail(**project_service.project_to_detail(project))


@router.patch("/{project_id}", response_model=ProjectDetail)
def update_my_project(
    project_id: int,
    request: ProjectUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectDetail:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        project_service.assert_project_access(project, user)
    except ProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    try:
        project = project_service.update_project(
            db,
            project,
            title=request.title,
            status=request.status,
            control_objective=request.control_objective,
            file_name=request.file_name,
            file_type=request.file_type,
            file_content=request.file_content,
            job_id=request.job_id,
            results=request.results,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ProjectDetail(**project_service.project_to_detail(project))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_project(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        project_service.assert_project_access(project, user)
    except ProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    project_service.delete_project(db, project)
