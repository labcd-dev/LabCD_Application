"""Admin routes for managing users, plans, actions, and projects."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from backend_api.db.models import Action, User
from backend_api.db.session import get_db
from backend_api.http.dependencies import require_action, get_current_user
from backend_api.http.schemas.auth import (
    ActionOut,
    AdminUserDetailOut,
    CreateUserRequest,
    DefaultPlanOut,
    PlanCreateRequest,
    PlanOut,
    PlanUpdateRequest,
    RoleCreateRequest,
    RoleOut,
    RoleUpdateRequest,
    SessionOut,
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
from backend_api.http.schemas.audit import AuditLogOut
from backend_api.http.schemas.monitoring import MonitoringResponse
from backend_api.http.schemas.projects import ProjectDetail, ProjectSummary, ProjectUpdateRequest
from backend_api.http.services import (
    audit_service,
    error_tracking_service,
    monitoring_service,
    plan_service,
    project_service,
    role_service,
)
from backend_api.http.services.auth_service import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    hash_password,
)
from backend_api.http.services.password_policy import validate_password
from backend_api.http.services import session_service
from backend_api.http.services.profile_service import user_out

router = APIRouter(prefix="/admin", tags=["admin"])


def _plan_out(plan) -> PlanOut:
    return PlanOut(**plan_service.plan_out_dict(plan))


@router.get("/monitoring", response_model=MonitoringResponse)
def get_monitoring(_: User = Depends(require_action("admin:monitoring"))) -> MonitoringResponse:
    return MonitoringResponse(**monitoring_service.collect_snapshot())


@router.get("/monitoring/export.csv")
def export_monitoring_csv_endpoint(_: User = Depends(require_action("admin:monitoring"))) -> StreamingResponse:
    return csv_response(export_monitoring_csv(), "monitoring_history.csv")


@router.get("/overview/export.xlsx")
def export_overview_xlsx_endpoint(
    _: User = Depends(require_action("admin:access")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return xlsx_response(export_overview_xlsx(db), "admin_all_data.xlsx")


@router.get("/errors/settings", response_model=ErrorTrackingSettings)
def get_error_tracking_settings(
    _: User = Depends(require_action("admin:errors")),
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
    http_request: Request,
    admin: User = Depends(require_action("admin:errors")),
    db: Session = Depends(get_db),
) -> ErrorTrackingSettings:
    cfg = error_tracking_service.update_settings(
        db,
        enabled=request.enabled,
        frontend=request.frontend,
        backend=request.backend,
        api=request.api,
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.errors.settings.update",
        category="admin",
        actor=admin,
        resource_type="error_tracking_settings",
        success=True,
        details=request.model_dump(exclude_unset=True),
    )
    return ErrorTrackingSettings(
        enabled=cfg.enabled,
        frontend=cfg.frontend,
        backend=cfg.backend,
        api=cfg.api,
    )


@router.get("/errors", response_model=list[ErrorEventOut])
def list_error_events(
    _: User = Depends(require_action("admin:errors")),
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
    _: User = Depends(require_action("admin:errors")),
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


@router.get("/audit-log", response_model=list[AuditLogOut])
def list_audit_log(
    _: User = Depends(require_action("admin:audit")),
    db: Session = Depends(get_db),
    category: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor_user_id: int | None = Query(default=None),
    success: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[AuditLogOut]:
    entries = audit_service.list_audits(
        db,
        category=category,
        action=action,
        actor_user_id=actor_user_id,
        success=success,
        q=q,
        limit=limit,
    )
    return [AuditLogOut(**audit_service.entry_to_dict(e)) for e in entries]


@router.get("/audit-log/export.csv")
def export_audit_log_csv(
    _: User = Depends(require_action("admin:audit")),
    db: Session = Depends(get_db),
    category: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor_user_id: int | None = Query(default=None),
    success: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=5000, ge=1, le=10000),
) -> StreamingResponse:
    content = audit_service.export_csv(
        db,
        category=category,
        action=action,
        actor_user_id=actor_user_id,
        success=success,
        q=q,
        limit=limit,
    )
    return csv_response(content, "audit_log.csv")


@router.get("/plans/export.csv")
def export_plans_csv_endpoint(
    _: User = Depends(require_action("admin:plans")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return csv_response(export_plans_csv(db), "plans.csv")


@router.get("/actions", response_model=list[ActionOut])
def list_actions(
    _: User = Depends(require_action("admin:access")),
    db: Session = Depends(get_db),
) -> list[ActionOut]:
    actions = db.query(Action).order_by(Action.code).all()
    return [ActionOut(code=a.code, description=a.description) for a in actions]


@router.get("/plans", response_model=list[PlanOut])
def list_plans(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    active_only: bool = Query(default=False),
) -> list[PlanOut]:
    if not (user.has_action("admin:plans") or user.has_action("admin:users")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing required action: admin:plans")
    return [_plan_out(plan) for plan in plan_service.list_plans(db, active_only=active_only)]


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(
    request: PlanCreateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:plans")),
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
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.plan.create",
        category="admin",
        actor=admin,
        resource_type="plan",
        resource_id=plan.id,
        success=True,
        details={"name": plan.name},
    )
    return _plan_out(plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int,
    request: PlanUpdateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:plans")),
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
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.plan.update",
        category="admin",
        actor=admin,
        resource_type="plan",
        resource_id=plan.id,
        success=True,
        details={"fields": sorted(request.model_fields_set)},
    )
    return _plan_out(plan)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:plans")),
    db: Session = Depends(get_db),
) -> None:
    plan = plan_service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan_name = plan.name
    try:
        plan_service.delete_plan(db, plan)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.plan.delete",
        category="admin",
        actor=admin,
        resource_type="plan",
        resource_id=plan_id,
        success=True,
        details={"name": plan_name},
    )

@router.get("/settings/default-plan", response_model=DefaultPlanOut)
def get_default_plan(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DefaultPlanOut:
    if not (user.has_action("admin:plans") or user.has_action("admin:users")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing required action: admin:plans")
    plan = plan_service.get_default_plan(db)
    return DefaultPlanOut(
        plan_id=plan.id if plan else None,
        plan=_plan_out(plan) if plan else None,
    )


@router.put("/settings/default-plan", response_model=DefaultPlanOut)
def set_default_plan(
    request: SetDefaultPlanRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:plans")),
    db: Session = Depends(get_db),
) -> DefaultPlanOut:
    try:
        plan = plan_service.set_default_plan(db, request.plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.default_plan.set",
        category="admin",
        actor=admin,
        resource_type="plan",
        resource_id=plan.id,
        success=True,
    )
    return DefaultPlanOut(plan_id=plan.id, plan=_plan_out(plan))


def _role_out(role) -> RoleOut:
    return RoleOut(**role_service.role_out_dict(role))


@router.get("/roles", response_model=list[RoleOut])
def list_roles(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    active_only: bool = Query(default=False),
) -> list[RoleOut]:
    if not (user.has_action("admin:roles") or user.has_action("admin:users")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing required action: admin:roles")
    return [_role_out(role) for role in role_service.list_roles(db, active_only=active_only)]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(
    request: RoleCreateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:roles")),
    db: Session = Depends(get_db),
) -> RoleOut:
    try:
        role = role_service.create_role(
            db,
            name=request.name,
            description=request.description,
            action_codes=request.actions,
            is_active=request.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.role.create",
        category="admin",
        actor=admin,
        resource_type="role",
        resource_id=role.id,
        success=True,
        details={"name": role.name},
    )
    return _role_out(role)


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(
    role_id: int,
    request: RoleUpdateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:roles")),
    db: Session = Depends(get_db),
) -> RoleOut:
    role = role_service.get_role(db, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    try:
        role = role_service.update_role(
            db,
            role,
            name=request.name,
            description=request.description,
            action_codes=request.actions,
            is_active=request.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.role.update",
        category="admin",
        actor=admin,
        resource_type="role",
        resource_id=role.id,
        success=True,
        details={"fields": sorted(request.model_fields_set)},
    )
    return _role_out(role)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(
    role_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:roles")),
    db: Session = Depends(get_db),
) -> None:
    role = role_service.get_role(db, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    role_name = role.name
    try:
        role_service.delete_role(db, role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.role.delete",
        category="admin",
        actor=admin,
        resource_type="role",
        resource_id=role_id,
        success=True,
        details={"name": role_name},
    )

@router.get("/users", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    users = db.query(User).order_by(User.email).all()
    return [user_out(user) for user in users]


@router.get("/users/export.csv")
def export_users_csv_endpoint(
    _: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return csv_response(export_users_csv(db), "users.csv")


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
def get_user_detail(
    user_id: int,
    _: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> AdminUserDetailOut:
    detail = admin_user_service.get_user_detail(db, user_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="User not found")
    return AdminUserDetailOut(**detail)


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    request: CreateUserRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> UserOut:
    if get_user_by_email(db, request.email) is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    if request.plan_id is not None and plan_service.get_plan(db, request.plan_id) is None:
        raise HTTPException(status_code=400, detail="Plan not found")
    try:
        validate_password(request.password, email=request.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.role_id is not None and role_service.get_role(db, request.role_id) is None:
        raise HTTPException(status_code=400, detail="Role not found")
    try:
        user = create_user(
            db,
            email=request.email,
            password=request.password,
            plan_id=request.plan_id,
            role_id=request.role_id,
            assign_default_plan=False,
            assign_default_role=request.role_id is None,
            email_verified=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.user.create",
        category="admin",
        actor=admin,
        resource_type="user",
        resource_id=user.id,
        success=True,
        details={"email": user.email},
    )
    return user_out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    request: UpdateUserRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> UserOut:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    deactivating = request.is_active is False and user.is_active
    demoting = False
    if "role_id" in request.model_fields_set:
        current_is_admin = user.role is not None and user.role.is_system
        if request.role_id is None:
            demoting = current_is_admin
        else:
            new_role = role_service.get_role(db, request.role_id)
            if new_role is None:
                raise HTTPException(status_code=400, detail="Role not found")
            demoting = current_is_admin and not new_role.is_system
    try:
        admin_user_service.guard_admin_account_change(
            db,
            actor=admin,
            target=user,
            deactivating=deactivating,
            demoting=demoting,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if request.is_active is not None:
        user.is_active = request.is_active
    if "role_id" in request.model_fields_set:
        if request.role_id is None:
            role_service.assign_role(db, user, None, commit=False)
        else:
            new_role = role_service.get_role(db, request.role_id)
            if new_role is None:
                raise HTTPException(status_code=400, detail="Role not found")
            try:
                role_service.assign_role(db, user, new_role, commit=False)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.password is not None:
        try:
            validate_password(
                request.password,
                email=user.email,
                display_name=user.display_name,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        user.password_hash = hash_password(request.password)
        session_service.revoke_all_user_sessions(db, user.id)
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
    fields = sorted(request.model_fields_set)
    # Never record password values — only that password was changed.
    details_fields = ["password" if f == "password" else f for f in fields]
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.user.update",
        category="admin",
        actor=admin,
        resource_type="user",
        resource_id=user.id,
        success=True,
        details={"fields": details_fields, "email": user.email},
    )
    return user_out(user)

@router.get("/users/{user_id}/sessions", response_model=list[SessionOut])
def list_user_sessions(
    user_id: int,
    _: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return [
        SessionOut(
            id=row.id,
            ip_address=row.ip_address,
            user_agent=row.user_agent,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            is_current=False,
        )
        for row in session_service.list_user_sessions(db, user_id)
    ]


@router.delete("/users/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_session(
    user_id: int,
    session_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> None:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    row = session_service.revoke_session_by_id(db, session_id=session_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.user.session.revoke",
        category="admin",
        actor=admin,
        resource_type="session",
        resource_id=session_id,
        success=True,
        details={"user_id": user_id},
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:users")),
    db: Session = Depends(get_db),
) -> None:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    email = user.email
    try:
        admin_user_service.guard_admin_account_change(
            db,
            actor=admin,
            target=user,
            deleting=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    admin_user_service.delete_user(db, user)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.user.delete",
        category="admin",
        actor=admin,
        resource_type="user",
        resource_id=user_id,
        success=True,
        details={"email": email},
    )

@router.get("/projects", response_model=list[ProjectSummary])
def list_all_projects(
    _: User = Depends(require_action("admin:projects")),
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
    _: User = Depends(require_action("admin:projects")),
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
    _: User = Depends(require_action("admin:projects")),
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
    _: User = Depends(require_action("admin:projects")),
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
    http_request: Request,
    admin: User = Depends(require_action("admin:projects")),
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
    fields = sorted(f for f in request.model_fields_set if f != "file_content")
    if "file_content" in request.model_fields_set:
        fields.append("file_content")
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.project.update",
        category="admin",
        actor=admin,
        resource_type="project",
        resource_id=project.id,
        success=True,
        details={"fields": fields},
    )
    return ProjectDetail(**project_service.project_to_detail(project, include_owner=True))


@router.get("/projects/{project_id}/artifacts/{filename}")
def download_any_project_artifact(
    project_id: int,
    filename: str,
    _: User = Depends(require_action("admin:projects")),
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
    http_request: Request,
    admin: User = Depends(require_action("admin:projects")),
    db: Session = Depends(get_db),
) -> None:
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    title = project.title
    project_service.delete_project(db, project)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.project.delete",
        category="admin",
        actor=admin,
        resource_type="project",
        resource_id=project_id,
        success=True,
        details={"title": title},
    )