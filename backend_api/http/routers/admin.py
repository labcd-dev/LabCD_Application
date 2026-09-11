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
from backend_api.http.schemas.api_keys import ApiKeysOut, ApiKeysUpdate, ApiKeyStatusOut
from backend_api.http.schemas.sso import (
    SsoProviderAdminOut,
    SsoProviderCreate,
    SsoProviderUpdate,
)
from backend_api.http.schemas.error_tracking import (
    ErrorEventOut,
    ErrorTrackingSettings,
    ErrorTrackingSettingsUpdate,
)
from backend_api.http.schemas.audit import AuditLogOut
from backend_api.http.schemas.credits import (
    AdminUserCreditsOut,
    CreditAdjustRequest,
    CreditLedgerEntryOut,
    CreditSettingsOut,
    CreditSettingsUpdate,
    CreditUsageSessionOut,
)
from backend_api.http.schemas.analytics import (
    AnalyticsResponse,
    TelegramAnalyticsSettings,
    TelegramAnalyticsSettingsUpdate,
    TelegramAnalyticsTestResult,
)
from backend_api.http.schemas.monitoring import MonitoringResponse
from backend_api.http.schemas.projects import ProjectDetail, ProjectSummary, ProjectUpdateRequest
from backend_api.http.schemas.plant_model import (
    PlantModelConversationDetail,
    PlantModelConversationSummary,
)
from backend_api.http.services import (
    analytics_service,
    api_key_service,
    audit_service,
    error_tracking_service,
    monitoring_service,
    plan_service,
    project_service,
    role_service,
    sso_service,
    telegram_analytics_service,
)
from backend_api.http.services import plant_model_chat_service
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


@router.get("/api-keys", response_model=ApiKeysOut)
def get_api_keys(_: User = Depends(require_action("admin:api_keys"))) -> ApiKeysOut:
    return ApiKeysOut(keys=[ApiKeyStatusOut(**row) for row in api_key_service.list_keys()])


@router.put("/api-keys", response_model=ApiKeysOut)
def update_api_keys(
    request: ApiKeysUpdate,
    http_request: Request,
    admin: User = Depends(require_action("admin:api_keys")),
    db: Session = Depends(get_db),
) -> ApiKeysOut:
    updates = request.model_dump(exclude_unset=True)
    try:
        changed = api_key_service.update_keys(updates)
    except api_key_service.ApiKeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if changed:
        audit_service.record_from_request(
            db,
            http_request,
            action="admin.api_keys.update",
            category="admin",
            actor=admin,
            resource_type="api_keys",
            success=True,
            details={"changed_keys": changed},
        )
    return ApiKeysOut(keys=[ApiKeyStatusOut(**row) for row in api_key_service.list_keys()])


def _sso_provider_out(row) -> SsoProviderAdminOut:
    return SsoProviderAdminOut(**sso_service.provider_admin_dict(row))


@router.get("/sso-providers", response_model=list[SsoProviderAdminOut])
def list_sso_providers(
    _: User = Depends(require_action("admin:sso")),
    db: Session = Depends(get_db),
) -> list[SsoProviderAdminOut]:
    return [_sso_provider_out(row) for row in sso_service.list_all_providers(db)]


@router.post(
    "/sso-providers",
    response_model=SsoProviderAdminOut,
    status_code=status.HTTP_201_CREATED,
)
def create_sso_provider(
    request: SsoProviderCreate,
    http_request: Request,
    admin: User = Depends(require_action("admin:sso")),
    db: Session = Depends(get_db),
) -> SsoProviderAdminOut:
    try:
        row = sso_service.create_provider(
            db,
            provider=request.provider,
            display_name=request.display_name,
            client_id=request.client_id,
            client_secret=request.client_secret,
            enabled=request.enabled,
        )
    except sso_service.SsoError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    audit_service.record_from_request(
        db,
        http_request,
        action="admin.sso.create",
        category="admin",
        actor=admin,
        resource_type="sso_provider",
        resource_id=row.id,
        success=True,
        details={"provider": row.provider},
    )
    return _sso_provider_out(row)


@router.patch("/sso-providers/{provider_id}", response_model=SsoProviderAdminOut)
def update_sso_provider(
    provider_id: int,
    request: SsoProviderUpdate,
    http_request: Request,
    admin: User = Depends(require_action("admin:sso")),
    db: Session = Depends(get_db),
) -> SsoProviderAdminOut:
    row = sso_service.get_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSO provider not found")

    data = request.model_dump(exclude_unset=True)
    try:
        row = sso_service.update_provider(db, row, **data)
    except sso_service.SsoError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    audit_service.record_from_request(
        db,
        http_request,
        action="admin.sso.update",
        category="admin",
        actor=admin,
        resource_type="sso_provider",
        resource_id=row.id,
        success=True,
        details={"provider": row.provider, "fields": sorted(data.keys())},
    )
    return _sso_provider_out(row)


@router.delete("/sso-providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sso_provider(
    provider_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:sso")),
    db: Session = Depends(get_db),
) -> None:
    row = sso_service.get_provider_by_id(db, provider_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSO provider not found")

    provider_key = row.provider
    sso_service.delete_provider(db, row)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.sso.delete",
        category="admin",
        actor=admin,
        resource_type="sso_provider",
        resource_id=provider_id,
        success=True,
        details={"provider": provider_key},
    )


@router.get("/monitoring", response_model=MonitoringResponse)
def get_monitoring(_: User = Depends(require_action("admin:monitoring"))) -> MonitoringResponse:
    return MonitoringResponse(**monitoring_service.collect_snapshot())


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(
    days: int = Query(default=30, ge=1, le=90),
    tz: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    _: User = Depends(require_action("admin:analytics")),
) -> AnalyticsResponse:
    return AnalyticsResponse(**analytics_service.get_analytics(db, days=days, tz_name=tz))


@router.get("/analytics/telegram", response_model=TelegramAnalyticsSettings)
def get_telegram_analytics_settings(
    _: User = Depends(require_action("admin:analytics")),
    db: Session = Depends(get_db),
) -> TelegramAnalyticsSettings:
    return telegram_analytics_service.get_settings(db)


@router.patch("/analytics/telegram", response_model=TelegramAnalyticsSettings)
def update_telegram_analytics_settings(
    body: TelegramAnalyticsSettingsUpdate,
    http_request: Request,
    admin: User = Depends(require_action("admin:analytics")),
    db: Session = Depends(get_db),
) -> TelegramAnalyticsSettings:
    try:
        result = telegram_analytics_service.update_settings(
            db,
            enabled=body.enabled,
            chat_id=body.chat_id,
            send_hour_utc=body.send_hour_utc,
            bot_token=body.bot_token,
        )
    except api_key_service.ApiKeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_details = body.model_dump(exclude_unset=True)
    if "bot_token" in audit_details:
        token = audit_details["bot_token"]
        audit_details["bot_token"] = (
            "cleared"
            if not token
            else api_key_service.mask_secret(str(token))
        )
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.analytics.telegram.settings.update",
        category="admin",
        actor=admin,
        resource_type="telegram_analytics_settings",
        success=True,
        details=audit_details,
    )
    return result


@router.post("/analytics/telegram/test", response_model=TelegramAnalyticsTestResult)
def test_telegram_analytics_report(
    http_request: Request,
    admin: User = Depends(require_action("admin:analytics")),
    db: Session = Depends(get_db),
) -> TelegramAnalyticsTestResult:
    result = telegram_analytics_service.send_daily_report(db, force=True)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.analytics.telegram.test",
        category="admin",
        actor=admin,
        resource_type="telegram_analytics_settings",
        success=result.ok,
        details={"ok": result.ok, "detail": result.detail},
    )
    if not result.ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.detail)
    return result


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


@router.get("/credits/settings", response_model=CreditSettingsOut)
def get_credit_settings(
    _: User = Depends(require_action("admin:credits")),
    db: Session = Depends(get_db),
) -> CreditSettingsOut:
    from backend_api.http.services import credit_service

    settings = credit_service.get_settings(db)
    return CreditSettingsOut(
        new_user_bonus=settings.new_user_bonus,
        referral_inviter_bonus=settings.referral_inviter_bonus,
        referral_invitee_bonus=settings.referral_invitee_bonus,
        daily_allotment=settings.daily_allotment,
        per_1k_tokens=settings.per_1k_tokens,
        per_minute=settings.per_minute,
        min_job_charge=settings.min_job_charge,
        hard_gate_enabled=settings.hard_gate_enabled,
    )


@router.patch("/credits/settings", response_model=CreditSettingsOut)
def update_credit_settings(
    request: CreditSettingsUpdate,
    http_request: Request,
    admin: User = Depends(require_action("admin:credits")),
    db: Session = Depends(get_db),
) -> CreditSettingsOut:
    from backend_api.http.services import credit_service

    try:
        settings = credit_service.update_settings(
            db,
            new_user_bonus=request.new_user_bonus,
            referral_inviter_bonus=request.referral_inviter_bonus,
            referral_invitee_bonus=request.referral_invitee_bonus,
            daily_allotment=request.daily_allotment,
            per_1k_tokens=request.per_1k_tokens,
            per_minute=request.per_minute,
            min_job_charge=request.min_job_charge,
            hard_gate_enabled=request.hard_gate_enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.credits.settings",
        category="admin",
        actor=admin,
        resource_type="credit_settings",
        success=True,
    )
    return CreditSettingsOut(
        new_user_bonus=settings.new_user_bonus,
        referral_inviter_bonus=settings.referral_inviter_bonus,
        referral_invitee_bonus=settings.referral_invitee_bonus,
        daily_allotment=settings.daily_allotment,
        per_1k_tokens=settings.per_1k_tokens,
        per_minute=settings.per_minute,
        min_job_charge=settings.min_job_charge,
        hard_gate_enabled=settings.hard_gate_enabled,
    )


@router.get("/users/{user_id}/credits", response_model=AdminUserCreditsOut)
def get_user_credits(
    user_id: int,
    _: User = Depends(require_action("admin:credits")),
    db: Session = Depends(get_db),
) -> AdminUserCreditsOut:
    from backend_api.http.services import credit_service

    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    summary = credit_service.account_summary(db, user_id)
    ledger = credit_service.list_ledger(db, user_id, limit=50)
    sessions = credit_service.list_sessions(db, user_id, limit=50)
    return AdminUserCreditsOut(
        user_id=user_id,
        bonus_balance=summary["bonus_balance"],
        daily_balance=summary["daily_balance"],
        spendable=summary["spendable"],
        daily_date=summary["daily_date"],
        referral_code=user.referral_code,
        referred_by_user_id=user.referred_by_user_id,
        new_user_bonus_granted_at=user.new_user_bonus_granted_at,
        ledger=[
            CreditLedgerEntryOut(
                id=row.id,
                amount=row.amount,
                balance_after=row.balance_after,
                entry_type=row.entry_type,
                usage_session_id=row.usage_session_id,
                note=row.note or "",
                created_at=row.created_at,
            )
            for row in ledger
        ],
        sessions=[
            CreditUsageSessionOut(
                id=row.id,
                module=row.module,
                job_id=row.job_id,
                status=row.status,
                started_at=row.started_at,
                ended_at=row.ended_at,
                duration_seconds=row.duration_seconds,
                prompt_tokens=row.prompt_tokens,
                completion_tokens=row.completion_tokens,
                credits_charged=row.credits_charged,
                live_credits_estimate=row.live_credits_estimate,
            )
            for row in sessions
        ],
    )


@router.post("/users/{user_id}/credits/adjust", response_model=AdminUserCreditsOut)
def adjust_user_credits(
    user_id: int,
    request: CreditAdjustRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:credits")),
    db: Session = Depends(get_db),
) -> AdminUserCreditsOut:
    from backend_api.http.services import credit_service

    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        credit_service.admin_adjust(db, user_id, request.amount, note=request.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.credits.adjust",
        category="admin",
        actor=admin,
        resource_type="user",
        resource_id=user_id,
        success=True,
        details={"amount": str(request.amount), "note": request.note},
    )
    summary = credit_service.account_summary(db, user_id)
    ledger = credit_service.list_ledger(db, user_id, limit=50)
    sessions = credit_service.list_sessions(db, user_id, limit=50)
    return AdminUserCreditsOut(
        user_id=user_id,
        bonus_balance=summary["bonus_balance"],
        daily_balance=summary["daily_balance"],
        spendable=summary["spendable"],
        daily_date=summary["daily_date"],
        referral_code=user.referral_code,
        referred_by_user_id=user.referred_by_user_id,
        new_user_bonus_granted_at=user.new_user_bonus_granted_at,
        ledger=[
            CreditLedgerEntryOut(
                id=row.id,
                amount=row.amount,
                balance_after=row.balance_after,
                entry_type=row.entry_type,
                usage_session_id=row.usage_session_id,
                note=row.note or "",
                created_at=row.created_at,
            )
            for row in ledger
        ],
        sessions=[
            CreditUsageSessionOut(
                id=row.id,
                module=row.module,
                job_id=row.job_id,
                status=row.status,
                started_at=row.started_at,
                ended_at=row.ended_at,
                duration_seconds=row.duration_seconds,
                prompt_tokens=row.prompt_tokens,
                completion_tokens=row.completion_tokens,
                credits_charged=row.credits_charged,
                live_credits_estimate=row.live_credits_estimate,
            )
            for row in sessions
        ],
    )


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
@router.get("/plant-model/conversations", response_model=list[PlantModelConversationSummary])
def list_all_plant_model_conversations(
    _: User = Depends(require_action("admin:plant_model")),
    db: Session = Depends(get_db),
    user_id: int | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[PlantModelConversationSummary]:
    conversations = plant_model_chat_service.list_all_conversations(
        db,
        user_id=user_id,
        status=status_filter,
    )
    return [
        PlantModelConversationSummary(
            **plant_model_chat_service.conversation_to_summary(c, include_owner=True)
        )
        for c in conversations
    ]


@router.get(
    "/plant-model/conversations/{conversation_id}",
    response_model=PlantModelConversationDetail,
)
def get_any_plant_model_conversation(
    conversation_id: int,
    _: User = Depends(require_action("admin:plant_model")),
    db: Session = Depends(get_db),
) -> PlantModelConversationDetail:
    conversation = plant_model_chat_service.get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return PlantModelConversationDetail(
        **plant_model_chat_service.conversation_to_detail(conversation, include_owner=True)
    )


@router.delete(
    "/plant-model/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_any_plant_model_conversation(
    conversation_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:plant_model")),
    db: Session = Depends(get_db),
) -> None:
    conversation = plant_model_chat_service.get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    title = conversation.title
    plant_model_chat_service.delete_conversation(db, conversation)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.plant_model.delete",
        category="admin",
        actor=admin,
        resource_type="plant_model_conversation",
        resource_id=conversation_id,
        success=True,
        details={"title": title},
    )
