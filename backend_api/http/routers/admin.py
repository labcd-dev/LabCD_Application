"""Admin routes for managing users, plans, actions, and projects."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from backend_api.db.models import Action, User
from backend_api.db.session import get_db
from backend_api.http.dependencies import require_admin
from backend_api.http.schemas.auth import (
    ActionOut,
    AdminUserDetailOut,
    CreateUserRequest,
    DefaultPlanOut,
    PlanCreateRequest,
    PlanOut,
    PlanUpdateRequest,
    SetDefaultPlanRequest,
    UpdateUserRequest,
    UserOut,
)
from backend_api.http.services import admin_user_service
from backend_api.common.csv_utils import csv_response, xlsx_response
from backend_api.http.services.admin_csv_service import (
    export_monitoring_csv,
    export_overview_xlsx,
    export_plans_csv,
    export_project_profiling_csv,
    export_projects_csv,
    export_users_csv,
)
from backend_api.http.schemas.error_tracking import (
    ErrorEventOut,
    ErrorTrackingSettings,
    ErrorTrackingSettingsUpdate,
)
from backend_api.http.schemas.monitoring import MonitoringResponse
from backend_api.http.schemas.projects import ProjectDetail, ProjectSummary, ProjectUpdateRequest
from backend_api.http.services import (
    error_tracking_service,
    monitoring_service,
    plan_service,
    project_service,
)
from backend_api.http.services.auth_service import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    hash_password,
)
from backend_api.http.services.profile_service import user_out

router = APIRouter(prefix="/admin", tags=["admin"])


def _plan_out(plan) -> PlanOut:
    return PlanOut(**plan_service.plan_out_dict(plan))


@router.get("/monitoring", response_model=MonitoringResponse)
def get_monitoring(_: User = Depends(require_admin)) -> MonitoringResponse:
    return MonitoringResponse(**monitoring_service.collect_snapshot())


@router.get("/monitoring/export.csv")
def export_monitoring_csv_endpoint(_: User = Depends(require_admin)) -> StreamingResponse:
    return csv_response(export_monitoring_csv(), "monitoring_history.csv")


@router.get("/overview/export.xlsx")
def export_overview_xlsx_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return xlsx_response(export_overview_xlsx(db), "admin_all_data.xlsx")


@router.get("/errors/settings", response_model=ErrorTrackingSettings)
def get_error_tracking_settings(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ErrorTrackingSettings:
    cfg = error_tracking_service.refresh_config_cache(db)
    return ErrorTrackingSettings(
        enabled=cfg.enabled,
        frontend=cfg.frontend,
        backend=cfg.backend,
        api=cfg.api,
    )


@router.patch("/errors/settings", response_model=ErrorTrackingSettings)
def update_error_tracking_settings(
    request: ErrorTrackingSettingsUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ErrorTrackingSettings:
    cfg = error_tracking_service.update_settings(
        db,
        enabled=request.enabled,
        frontend=request.frontend,
        backend=request.backend,
        api=request.api,
    )
    return ErrorTrackingSettings(
        enabled=cfg.enabled,
        frontend=cfg.frontend,
        backend=cfg.backend,
        api=cfg.api,
    )


@router.get("/errors", response_model=list[ErrorEventOut])
def list_error_events(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    source: str | None = Query(default=None),
    status_code: int | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[ErrorEventOut]:
    events = error_tracking_service.list_errors(
        db,
        user_id=user_id,
        source=source,
        status_code=status_code,
        q=q,
        limit=limit,
    )
    return [ErrorEventOut(**error_tracking_service.event_to_dict(e)) for e in events]


@router.get("/errors/export.csv")
def export_error_events_csv(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    source: str | None = Query(default=None),
    status_code: int | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=10000),
) -> StreamingResponse:
    content = error_tracking_service.export_csv(
        db,
        user_id=user_id,
        source=source,
        status_code=status_code,
        q=q,
        limit=limit,
    )
    return csv_response(content, "error_events.csv")


@router.get("/plans/export.csv")
def export_plans_csv_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return csv_response(export_plans_csv(db), "plans.csv")


@router.get("/actions", response_model=list[ActionOut])
def list_actions(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[ActionOut]:
    actions = db.query(Action).order_by(Action.code).all()
    return [ActionOut(code=a.code, description=a.description) for a in actions]


@router.get("/plans", response_model=list[PlanOut])
def list_plans(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    active_only: bool = Query(default=False),
) -> list[PlanOut]:
    return [_plan_out(plan) for plan in plan_service.list_plans(db, active_only=active_only)]


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(
    request: PlanCreateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlanOut:
    try:
        plan = plan_service.create_plan(
            db,
            name=request.name,
            description=request.description,
            price=request.price,
            action_codes=request.actions,
            models=request.models,
            is_active=request.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _plan_out(plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int,
    request: PlanUpdateRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlanOut:
    plan = plan_service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    try:
        plan = plan_service.update_plan(
            db,
            plan,
            name=request.name,
            description=request.description,
            price=request.price,
            action_codes=request.actions,
            models=request.models,
            is_active=request.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _plan_out(plan)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    plan = plan_service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    try:
        plan_service.delete_plan(db, plan)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings/default-plan", response_model=DefaultPlanOut)
def get_default_plan(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DefaultPlanOut:
    plan = plan_service.get_default_plan(db)
    return DefaultPlanOut(
        plan_id=plan.id if plan else None,
        plan=_plan_out(plan) if plan else None,
    )


@router.put("/settings/default-plan", response_model=DefaultPlanOut)
def set_default_plan(
    request: SetDefaultPlanRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> DefaultPlanOut:
    try:
        plan = plan_service.set_default_plan(db, request.plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DefaultPlanOut(plan_id=plan.id, plan=_plan_out(plan))


@router.get("/users", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    users = db.query(User).order_by(User.email).all()
    return [user_out(user) for user in users]


@router.get("/users/export.csv")
def export_users_csv_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return csv_response(export_users_csv(db), "users.csv")


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
def get_user_detail(
    user_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserDetailOut:
    detail = admin_user_service.get_user_detail(db, user_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="User not found")
    return AdminUserDetailOut(**detail)


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    request: CreateUserRequest,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    if get_user_by_email(db, request.email) is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    if request.plan_id is not None and plan_service.get_plan(db, request.plan_id) is None:
        raise HTTPException(status_code=400, detail="Plan not found")
    user = create_user(
        db,
        email=request.email,
        password=request.password,
        plan_id=request.plan_id,
        is_admin=request.is_admin,
        assign_default_plan=False,
    )
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
    if "plan_id" in request.model_fields_set:
        if request.plan_id is None:
            user.plan_id = None
        else:
            plan = plan_service.get_plan(db, request.plan_id)
            if plan is None:
                raise HTTPException(status_code=400, detail="Plan not found")
            if not plan.is_active:
                raise HTTPException(status_code=400, detail="Cannot assign an inactive plan")
            user.plan = plan
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


@router.get("/projects/export.csv")
def export_projects_csv_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    pipeline_type: str | None = Query(default=None),
) -> StreamingResponse:
    content = export_projects_csv(
        db,
        user_id=user_id,
        pipeline_type=pipeline_type,
    )
    return csv_response(content, "projects.csv")


@router.get("/projects/profiling/export.csv")
def export_projects_profiling_csv_endpoint(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    pipeline_type: str | None = Query(default=None),
) -> StreamingResponse:
    content = export_project_profiling_csv(
        db,
        user_id=user_id,
        pipeline_type=pipeline_type,
    )
    return csv_response(content, "project_profiling.csv")


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_any_project(
    project_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ProjectDetail:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project = project_service.ensure_project_file_on_disk(db, project)
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


@router.get("/projects/{project_id}/artifacts/{filename}")
def download_any_project_artifact(
    project_id: int,
    filename: str,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        file_path = project_service.resolve_project_artifact_path(project, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path=file_path, filename=file_path.name)


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
