"""Role CRUD and default User / system Admin role helpers."""

from __future__ import annotations

from sqlalchemy.orm import Session

from backend_api.db.models import Role, User
from backend_api.http.services.auth_service import ensure_actions

ADMIN_ROLE_NAME = "Admin"
USER_ROLE_NAME = "User"


def role_out_dict(role: Role) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "is_system": role.is_system,
        "is_active": role.is_active,
        "actions": role.action_codes(),
        "created_at": role.created_at,
    }


def list_roles(db: Session, *, active_only: bool = False) -> list[Role]:
    query = db.query(Role)
    if active_only:
        query = query.filter(Role.is_active.is_(True))
    return query.order_by(Role.name).all()


def get_role(db: Session, role_id: int) -> Role | None:
    return db.query(Role).filter(Role.id == role_id).first()


def get_role_by_name(db: Session, name: str) -> Role | None:
    return db.query(Role).filter(Role.name == name.strip()).first()


def get_admin_role(db: Session) -> Role | None:
    return (
        db.query(Role)
        .filter(Role.is_system.is_(True), Role.name == ADMIN_ROLE_NAME)
        .first()
    )


def get_user_role(db: Session) -> Role | None:
    return get_role_by_name(db, USER_ROLE_NAME)


def _ensure_admin_access(action_codes: list[str] | None) -> list[str] | None:
    """Any admin:* permission also requires admin:access for the admin shell."""
    if action_codes is None:
        return None
    codes = list(action_codes)
    if any(code.startswith("admin:") for code in codes) and "admin:access" not in codes:
        codes.append("admin:access")
    return codes


def create_role(
    db: Session,
    *,
    name: str,
    description: str = "",
    action_codes: list[str] | None = None,
    is_active: bool = True,
    is_system: bool = False,
) -> Role:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Role name is required")
    if get_role_by_name(db, normalized) is not None:
        raise ValueError("A role with this name already exists")
    role = Role(
        name=normalized,
        description=description.strip(),
        is_active=is_active,
        is_system=is_system,
    )
    db.add(role)
    db.flush()
    codes = _ensure_admin_access(action_codes)
    if codes:
        role.actions = ensure_actions(db, codes)
    db.commit()
    db.refresh(role)
    return role


def update_role(
    db: Session,
    role: Role,
    *,
    name: str | None = None,
    description: str | None = None,
    action_codes: list[str] | None = None,
    is_active: bool | None = None,
) -> Role:
    if role.is_system:
        if name is not None and name.strip() != role.name:
            raise ValueError("Cannot rename a system role")
        if is_active is False:
            raise ValueError("Cannot deactivate a system role")

    if name is not None:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Role name is required")
        existing = get_role_by_name(db, normalized)
        if existing is not None and existing.id != role.id:
            raise ValueError("A role with this name already exists")
        role.name = normalized
    if description is not None:
        role.description = description.strip()
    if is_active is not None:
        role.is_active = is_active
    if action_codes is not None:
        codes = _ensure_admin_access(action_codes) or []
        role.actions = ensure_actions(db, codes)

    db.add(role)
    db.commit()
    db.refresh(role)

    if role.is_system:
        _sync_is_admin_for_role_users(db, role)

    return role


def delete_role(db: Session, role: Role) -> None:
    if role.is_system:
        raise ValueError("Cannot delete a system role")
    assigned = db.query(User).filter(User.role_id == role.id).count()
    if assigned:
        raise ValueError("Cannot delete a role that is assigned to users")
    db.delete(role)
    db.commit()


def assign_role(db: Session, user: User, role: Role | None, *, commit: bool = True) -> User:
    if role is not None and not role.is_active and not role.is_system:
        raise ValueError("Cannot assign an inactive role")
    user.role = role
    user.role_id = role.id if role is not None else None
    user.sync_is_admin_flag()
    db.add(user)
    if commit:
        db.commit()
        db.refresh(user)
    return user


def _sync_is_admin_for_role_users(db: Session, role: Role) -> None:
    users = db.query(User).filter(User.role_id == role.id).all()
    for user in users:
        user.sync_is_admin_flag()
        db.add(user)
    db.commit()


def ensure_default_roles(db: Session, all_action_codes: list[str]) -> tuple[Role, Role]:
    """Ensure system Admin (all actions) and default User (no admin actions)."""
    admin_role = get_admin_role(db)
    if admin_role is None:
        admin_role = create_role(
            db,
            name=ADMIN_ROLE_NAME,
            description="Full system access (seeded system role).",
            action_codes=all_action_codes,
            is_active=True,
            is_system=True,
        )
    else:
        admin_role.actions = ensure_actions(db, all_action_codes)
        admin_role.is_system = True
        admin_role.is_active = True
        if not admin_role.description:
            admin_role.description = "Full system access (seeded system role)."
        db.add(admin_role)
        db.commit()
        db.refresh(admin_role)

    user_role = get_user_role(db)
    if user_role is None:
        user_role = create_role(
            db,
            name=USER_ROLE_NAME,
            description="Default role for registered users (module access via plan).",
            action_codes=[],
            is_active=True,
            is_system=False,
        )
    return admin_role, user_role


def migrate_users_to_roles(db: Session, admin_role: Role, user_role: Role) -> None:
    """Assign Admin/User roles from legacy is_admin and sync the flag."""
    users = db.query(User).all()
    for user in users:
        if user.role_id is None:
            if user.is_admin:
                user.role = admin_role
            else:
                user.role = user_role
        user.sync_is_admin_flag()
        db.add(user)
    db.commit()
