"""PostgreSQL engine and session helpers."""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend_api.http.config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and seed default actions / admin user."""
    # Import models so metadata is registered.
    from backend_api.db import models  # noqa: F401
    from backend_api.db.base import Base
    from backend_api.http.services.auth_service import seed_auth_data

    Base.metadata.create_all(bind=engine)
    _migrate_user_profile_columns()
    db = SessionLocal()
    try:
        seed_auth_data(db)
    finally:
        db.close()


def _migrate_user_profile_columns() -> None:
    """Add profile columns to existing deployments created before this feature."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    columns = {col["name"] for col in inspector.get_columns("users")}
    statements: list[str] = []
    if "display_name" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN display_name VARCHAR(100)")
    if "avatar_url" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512)")
    if "theme" not in columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'system'"
        )

    if not statements:
        return

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
