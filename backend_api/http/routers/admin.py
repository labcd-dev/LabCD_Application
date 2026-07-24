"""Admin routes for managing users, actions, and projects."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend_api.db.models import Action, User
from backend_api.db.session import get_db
from backend_api.http.dependencies import require_admin
from backend_api.http.schemas.auth import (
    ActionOut,
    CreateUserRequest,
    UpdateUserActionsRequest,
    UpdateUserRequest,
    UserOut,
)
from backend_api.http.schemas.projects import ProjectDetail, ProjectSummary, ProjectUpdateRequest
from backend_api.http.services import project_service
from backend_api.http.services.auth_service import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    hash_password,
    set_user_actions,
)
from backend_api.http.services.profile_service import user_out

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/actions", response_model=list[ActionOut])
def list_actions(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[ActionOut]:
    actions = db.query(Action).order_by(Action.code).all()
    return [ActionOut(code=a.code, description=a.description) for a in actions]


@router.get("/users", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    users = db.query(User).order_by(User.email).all()
    return [user_out(user) for user in users]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    request: CreateUserRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    if get_user_by_email(db, request.email) is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = create_user(
        db,
        email=request.email,
        password=request.password,
        action_codes=request.actions,
        is_admin=request.is_admin,
    )
    return user_out(user)


@router.put("/users/{user_id}/actions", response_model=UserOut)
def update_user_actions(
    user_id: int,
    request: UpdateUserActionsRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user = set_user_actions(db, user, request.actions)
    return user_out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    request: UpdateUserRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if request.is_active is not None:
        user.is_active = request.is_active
    if request.is_admin is not None:
        user.is_admin = request.is_admin
    if request.password is not None:
        user.password_hash = hash_password(request.password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_out(user)


@router.get("/projects", response_model=list[ProjectSummary])
def list_all_projects(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    pipeline_type: str | None = Query(default=None),
) -> list[ProjectSummary]:
    projects = project_service.list_all_projects(
        db,
        user_id=user_id,
        pipeline_type=pipeline_type,
    )
    return [
        ProjectSummary(**project_service.project_to_summary(p, include_owner=True))
        for p in projects
    ]


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_any_project(
    project_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProjectDetail:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectDetail(**project_service.project_to_detail(project, include_owner=True))


@router.patch("/projects/{project_id}", response_model=ProjectDetail)
def update_any_project(
    project_id: int,
    request: ProjectUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProjectDetail:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
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
    return ProjectDetail(**project_service.project_to_detail(project, include_owner=True))


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_any_project(
    project_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project_service.delete_project(db, project)
