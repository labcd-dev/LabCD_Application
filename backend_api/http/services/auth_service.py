"""Authentication helpers: passwords, JWT, and seeding."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import bcrypt
from fastapi import Request
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from backend_api.db.models import Action, LoginHistory, Plan, Role, User
from backend_api.http.config import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    DEFAULT_LLM_MODELS,
    JWT_ALGORITHM,
    JWT_EXPIRE_MINUTES,
    JWT_SECRET,
)

FailureReason = str  # "invalid_credentials" | "inactive" | "unknown_user" | "unverified"

# Pipeline modes + module actions available in the system.
DEFAULT_ACTIONS: list[tuple[str, str]] = [
    ("pipeline:silo", "Run Single Loop (Silo) design for yourself"),
    ("pipeline:mulo", "Run Multi Loop (Mulo) design for yourself"),
    ("module:upload", "Upload dynamics files"),
    ("module:regularize", "Run Regularizer / standardize"),
    ("module:recommender", "Run Recommender"),
    ("module:trimmer", "Run Trimmer"),
    ("module:silo", "Run SiloDesigner jobs"),
    ("module:mulo", "Run MuloDesigner jobs"),
    ("module:case_studies", "Load and use case studies"),
    ("admin:access", "Enter the admin area"),
    ("admin:users", "Manage users"),
    ("admin:projects", "Manage all projects"),
    ("admin:plans", "Manage subscription plans"),
    ("admin:roles", "Manage roles and permissions"),
    ("admin:site", "Manage site CMS"),
    ("admin:blog", "Manage blog"),
    ("admin:survey", "Manage surveys"),
    ("admin:tutorials", "Manage tutorial videos, docs, and templates"),
    ("admin:bug_reports", "Moderate bug reports"),
    ("admin:monitoring", "View system monitoring"),
    ("admin:analytics", "View product analytics"),
    ("admin:errors", "Manage error tracking"),
    ("admin:audit", "View audit log"),
    ("admin:api_keys", "Manage LLM and search API keys"),
    ("admin:sso", "Manage SSO providers"),
]

PIPELINE_ACTIONS = {
    "siloDesign": "pipeline:silo",
    "muloDesign": "pipeline:mulo",
}

MODULE_ACTIONS = {
    "upload": "module:upload",
    "regularize": "module:regularize",
    "recommender": "module:recommender",
    "trimmer": "module:trimmer",
    "silo": "module:silo",
    "mulo": "module:mulo",
    "case_studies": "module:case_studies",
}

SILO_ACTION_CODES = [
    "pipeline:silo",
    "module:upload",
    "module:regularize",
    "module:silo",
]

MULO_ACTION_CODES = [
    "pipeline:mulo",
    "module:upload",
    "module:regularize",
    "module:recommender",
    "module:trimmer",
    "module:mulo",
    "module:case_studies",
]

DEFAULT_PLANS: list[tuple[str, str, Decimal, list[str], list[str]]] = [
    (
        "Free",
        "Default plan for new registrations (no modules).",
        Decimal("0.00"),
        [],
        ["gpt-4o-mini"],
    ),
    (
        "Single Loop",
        "Single Loop (Silo) pipeline access.",
        Decimal("29.00"),
        SILO_ACTION_CODES,
        list(DEFAULT_LLM_MODELS),
    ),
    (
        "Multi Loop",
        "Multi Loop (Mulo) pipeline access.",
        Decimal("49.00"),
        MULO_ACTION_CODES,
        list(DEFAULT_LLM_MODELS),
    ),
    (
        "Full Access",
        "Both Single Loop and Multi Loop pipelines.",
        Decimal("79.00"),
        sorted(set(SILO_ACTION_CODES + MULO_ACTION_CODES)),
        list(DEFAULT_LLM_MODELS),
    ),
]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: int, email: str, *, jti: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "email": email, "jti": jti, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired token") from exc


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower().strip()).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def ensure_actions(db: Session, codes: list[str]) -> list[Action]:
    """Return Action rows for codes, creating missing ones."""
    actions: list[Action] = []
    for code in codes:
        normalized = code.strip()
        if not normalized:
            continue
        action = db.query(Action).filter(Action.code == normalized).first()
        if action is None:
            action = Action(code=normalized, description="")
            db.add(action)
            db.flush()
        actions.append(action)
    return actions


def create_user(
    db: Session,
    *,
    email: str,
    password: str | None = None,
    plan_id: int | None = None,
    role_id: int | None = None,
    is_admin: bool = False,
    assign_default_plan: bool = True,
    assign_default_role: bool = True,
    email_verified: bool | None = None,
    skip_password_policy: bool = False,
    display_name: str | None = None,
    avatar_url: str | None = None,
) -> User:
    from backend_api.http.services import plan_service, role_service
    from backend_api.http.services.password_policy import validate_password

    if password is not None and not skip_password_policy:
        validate_password(password, email=email)

    resolved_plan_id = plan_id
    if resolved_plan_id is None and assign_default_plan and not is_admin:
        resolved_plan_id = plan_service.get_default_plan_id(db)

    resolved_role: Role | None = None
    if role_id is not None:
        resolved_role = role_service.get_role(db, role_id)
        if resolved_role is None:
            raise ValueError("Role not found")
        if not resolved_role.is_active and not resolved_role.is_system:
            raise ValueError("Cannot assign an inactive role")
    elif is_admin:
        resolved_role = role_service.get_admin_role(db)
    elif assign_default_role:
        resolved_role = role_service.get_user_role(db)

    verified = email_verified if email_verified is not None else bool(
        resolved_role is not None and resolved_role.is_system
    )

    user = User(
        email=email.lower().strip(),
        password_hash=hash_password(password) if password is not None else None,
        is_admin=False,
        is_active=True,
        email_verified=verified,
        plan_id=resolved_plan_id,
        role_id=resolved_role.id if resolved_role is not None else None,
        display_name=display_name,
        avatar_url=avatar_url,
    )
    if resolved_role is not None:
        user.role = resolved_role
        user.sync_is_admin_flag()
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def burn_password_hash_cost() -> None:
    """Run a dummy bcrypt to reduce register timing enumeration."""
    bcrypt.hashpw(b"enumeration-padding", bcrypt.gensalt())


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user, reason = authenticate_user_with_reason(db, email, password)
    if reason is not None:
        return None
    return user


def authenticate_user_with_reason(
    db: Session,
    email: str,
    password: str,
) -> tuple[User | None, FailureReason | None]:
    """Return (user, None) on success.

    On failure returns (known_user_or_None, failure_reason) so callers can
    still attribute the attempt to a known account.
    """
    user = get_user_by_email(db, email)
    if user is None:
        return None, "unknown_user"
    if not user.is_active:
        return user, "inactive"
    if not user.password_hash:
        return user, "invalid_credentials"
    if not verify_password(password, user.password_hash):
        return user, "invalid_credentials"
    if not user.email_verified:
        return user, "unverified"
    return user, None


def record_login_attempt(
    db: Session,
    *,
    email: str,
    success: bool,
    user_id: int | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    failure_reason: FailureReason | None = None,
) -> LoginHistory:
    row = LoginHistory(
        user_id=user_id,
        email=email.lower().strip(),
        success=success,
        ip_address=ip_address,
        user_agent=(user_agent[:512] if user_agent else None),
        failure_reason=failure_reason,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def count_active_admins(db: Session) -> int:
    return (
        db.query(User)
        .join(Role, User.role_id == Role.id)
        .filter(Role.is_system.is_(True), User.is_active.is_(True))
        .count()
    )


def is_last_active_admin(db: Session, user: User) -> bool:
    on_admin_role = bool(user.role is not None and user.role.is_system)
    return bool(on_admin_role and user.is_active and count_active_admins(db) <= 1)


def client_ip_from_request(request: Request) -> str | None:
    """Resolve client IP from X-Forwarded-For or the direct connection."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:64]
    if request.client is not None and request.client.host:
        return request.client.host[:64]
    return None


def _ensure_default_plans(db: Session) -> Plan:
    from backend_api.http.services import plan_service

    free_plan: Plan | None = None
    for name, description, price, codes, models in DEFAULT_PLANS:
        plan = plan_service.get_plan_by_name(db, name)
        if plan is None:
            plan = Plan(
                name=name,
                description=description,
                price=price,
                is_active=True,
                allowed_models=plan_service.normalize_plan_models(models),
            )
            db.add(plan)
            db.flush()
            if codes:
                plan.actions = ensure_actions(db, codes)
        if name == "Free":
            free_plan = plan

    db.commit()

    if free_plan is None:
        free_plan = plan_service.get_plan_by_name(db, "Free")
    assert free_plan is not None

    if plan_service.get_default_plan_id(db) is None:
        plan_service.set_default_plan(db, free_plan.id)

    return free_plan


def seed_auth_data(db: Session) -> None:
    from backend_api.http.services import role_service

    for code, description in DEFAULT_ACTIONS:
        action = db.query(Action).filter(Action.code == code).first()
        if action is None:
            db.add(Action(code=code, description=description))
        elif not action.description:
            action.description = description
    db.commit()

    free_plan = _ensure_default_plans(db)

    all_codes = [code for code, _desc in DEFAULT_ACTIONS]
    admin_role, user_role = role_service.ensure_default_roles(db, all_codes)

    # Rename legacy reserved-domain admin if present (email-validator rejects .local).
    legacy_admin = get_user_by_email(db, "admin@labcd.local")
    admin = get_user_by_email(db, ADMIN_EMAIL)
    if legacy_admin is not None and admin is None:
        legacy_admin.email = ADMIN_EMAIL.lower().strip()
        db.add(legacy_admin)
        db.commit()
        admin = legacy_admin

    if admin is None:
        create_user(
            db,
            email=ADMIN_EMAIL,
            password=ADMIN_PASSWORD,
            plan_id=None,
            role_id=admin_role.id,
            is_admin=True,
            assign_default_plan=False,
            assign_default_role=False,
            email_verified=True,
            skip_password_policy=True,
        )
    else:
        if not admin.email_verified:
            admin.email_verified = True
            db.add(admin)
            db.commit()
        if admin.plan_id is None and not (
            admin.role is not None and admin.role.is_system
        ) and not admin.is_admin:
            admin.plan_id = free_plan.id
            db.add(admin)
            db.commit()

    role_service.migrate_users_to_roles(db, admin_role, user_role)
