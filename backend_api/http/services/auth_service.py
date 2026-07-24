"""Authentication helpers: passwords, JWT, and seeding."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from backend_api.db.models import Action, User
from backend_api.http.config import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    JWT_ALGORITHM,
    JWT_EXPIRE_MINUTES,
    JWT_SECRET,
)

# Pipeline modes + module actions users can be assigned.
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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
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


def set_user_actions(db: Session, user: User, action_codes: list[str]) -> User:
    user.actions = ensure_actions(db, action_codes)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_user(
    db: Session,
    *,
    email: str,
    password: str,
    action_codes: list[str] | None = None,
    is_admin: bool = False,
) -> User:
    user = User(
        email=email.lower().strip(),
        password_hash=hash_password(password),
        is_admin=is_admin,
        is_active=True,
    )
    db.add(user)
    db.flush()
    if action_codes:
        user.actions = ensure_actions(db, action_codes)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def seed_auth_data(db: Session) -> None:
    for code, description in DEFAULT_ACTIONS:
        action = db.query(Action).filter(Action.code == code).first()
        if action is None:
            db.add(Action(code=code, description=description))
        elif not action.description:
            action.description = description
    db.commit()

    # Rename legacy reserved-domain admin if present (email-validator rejects .local).
    legacy_admin = get_user_by_email(db, "admin@labcd.local")
    admin = get_user_by_email(db, ADMIN_EMAIL)
    if legacy_admin is not None and admin is None:
        legacy_admin.email = ADMIN_EMAIL.lower().strip()
        db.add(legacy_admin)
        db.commit()
        admin = legacy_admin

    if admin is None:
        all_codes = [code for code, _ in DEFAULT_ACTIONS]
        create_user(
            db,
            email=ADMIN_EMAIL,
            password=ADMIN_PASSWORD,
            action_codes=all_codes,
            is_admin=True,
        )
