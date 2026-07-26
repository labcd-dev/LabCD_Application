"""PostgreSQL engine and session helpers."""

from collections.abc import Generator

from sqlalchemy import create_engine, text
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
    """Create tables and seed default actions / plans / admin user."""
    # Import models so metadata is registered.
    from backend_api.db import models  # noqa: F401
    from backend_api.db.base import Base
    from backend_api.http.services.auth_service import seed_auth_data

    Base.metadata.create_all(bind=engine)
    _migrate_schema()
    db = SessionLocal()
    try:
        seed_auth_data(db)
        _migrate_legacy_user_actions(db)
    finally:
        db.close()


def _migrate_schema() -> None:
    """Add columns/tables for existing deployments created before plans."""
    from sqlalchemy import inspect

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "users" not in table_names:
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
    if "plan_id" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN plan_id INTEGER")
    if "university" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN university VARCHAR(200)")
    if "degree" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN degree VARCHAR(200)")
    if "major" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN major VARCHAR(200)")
    if "matlab_experience" not in columns:
        statements.append("ALTER TABLE users ADD COLUMN matlab_experience VARCHAR(40)")
    if "control_design_experience" not in columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN control_design_experience VARCHAR(40)"
        )
    if "profile_survey_completed_at" not in columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN profile_survey_completed_at TIMESTAMP"
        )
    if "feedback_survey_completed_at" not in columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN feedback_survey_completed_at TIMESTAMP"
        )
    if "tutorial_dont_show_again" not in columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN tutorial_dont_show_again "
            "BOOLEAN NOT NULL DEFAULT FALSE"
        )

    if statements:
        with engine.begin() as conn:
            for statement in statements:
                conn.execute(text(statement))

    # Add FK after column exists (idempotent enough for Postgres).
    if "plan_id" not in columns and "plans" in set(inspect(engine).get_table_names()):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_id_fkey"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE users ADD CONSTRAINT users_plan_id_fkey "
                    "FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL"
                )
            )

    _migrate_plan_allowed_models()
    _migrate_bug_reports()
    _migrate_project_llm_model()


def _migrate_bug_reports() -> None:
    """Align legacy bug_reports table with the current BugReport model."""
    from sqlalchemy import inspect

    inspector = inspect(engine)
    if "bug_reports" not in inspector.get_table_names():
        return

    columns = {col["name"] for col in inspector.get_columns("bug_reports")}
    statements: list[str] = []
    if "fixed_at" not in columns:
        statements.append("ALTER TABLE bug_reports ADD COLUMN fixed_at TIMESTAMP WITH TIME ZONE")
    if "title" not in columns:
        statements.append(
            "ALTER TABLE bug_reports ADD COLUMN title VARCHAR(200) NOT NULL DEFAULT ''"
        )
    if "user_agent" not in columns:
        statements.append("ALTER TABLE bug_reports ADD COLUMN user_agent VARCHAR(512)")
    if "admin_notes" not in columns and "admin_note" not in columns:
        statements.append(
            "ALTER TABLE bug_reports ADD COLUMN admin_notes TEXT NOT NULL DEFAULT ''"
        )
    if "updated_at" not in columns:
        statements.append(
            "ALTER TABLE bug_reports ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE "
            "NOT NULL DEFAULT NOW()"
        )

    if not statements:
        return

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def _migrate_project_llm_model() -> None:
    """Add projects.llm_model so each project is locked to the model chosen at setup."""
    from sqlalchemy import inspect

    inspector = inspect(engine)
    if "projects" not in inspector.get_table_names():
        return

    columns = {col["name"] for col in inspector.get_columns("projects")}
    if "llm_model" in columns:
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE projects ADD COLUMN llm_model VARCHAR(100) "
                "NOT NULL DEFAULT 'gpt-4o'"
            )
        )


def _migrate_plan_allowed_models() -> None:
    """Add plans.allowed_models and backfill once when the column is first added."""
    import json

    from sqlalchemy import inspect

    from backend_api.http.config import DEFAULT_LLM_MODELS

    inspector = inspect(engine)
    if "plans" not in inspector.get_table_names():
        return

    plan_columns = {col["name"] for col in inspector.get_columns("plans")}
    if "allowed_models" in plan_columns:
        return

    dialect = engine.dialect.name
    col_type = "JSONB" if dialect == "postgresql" else "JSON"
    catalog_json = json.dumps(list(DEFAULT_LLM_MODELS))
    free_models_json = json.dumps(["gpt-4o-mini"])
    with engine.begin() as conn:
        conn.execute(
            text(
                f"ALTER TABLE plans ADD COLUMN allowed_models {col_type} "
                "NOT NULL DEFAULT '[]'"
            )
        )
        # Existing plans keep full catalog access until an admin restricts them.
        if dialect == "postgresql":
            conn.execute(
                text("UPDATE plans SET allowed_models = CAST(:models AS jsonb)"),
                {"models": catalog_json},
            )
            conn.execute(
                text(
                    "UPDATE plans SET allowed_models = CAST(:models AS jsonb) "
                    "WHERE name = 'Free'"
                ),
                {"models": free_models_json},
            )
        else:
            conn.execute(
                text("UPDATE plans SET allowed_models = :models"),
                {"models": catalog_json},
            )
            conn.execute(
                text("UPDATE plans SET allowed_models = :models WHERE name = 'Free'"),
                {"models": free_models_json},
            )


def _migrate_legacy_user_actions(db: Session) -> None:
    """Move legacy user_actions rows onto plans, then drop the old table."""
    from sqlalchemy import inspect

    from backend_api.db.models import Action, Plan, User
    from backend_api.http.services import plan_service
    from backend_api.http.services.auth_service import ensure_actions

    inspector = inspect(engine)
    if "user_actions" not in inspector.get_table_names():
        return

    rows = db.execute(
        text(
            "SELECT ua.user_id, a.code "
            "FROM user_actions ua "
            "JOIN actions a ON a.id = ua.action_id "
            "ORDER BY ua.user_id, a.code"
        )
    ).fetchall()

    by_user: dict[int, list[str]] = {}
    for user_id, code in rows:
        by_user.setdefault(int(user_id), []).append(str(code))

    plan_by_codes: dict[frozenset[str], Plan] = {}
    for plan in plan_service.list_plans(db):
        plan_by_codes[frozenset(plan.action_codes())] = plan

    default_plan = plan_service.get_default_plan(db)

    for user in db.query(User).all():
        if user.plan_id is not None:
            continue
        codes = by_user.get(user.id, [])
        key = frozenset(codes)
        if not key:
            if default_plan is not None and not user.is_admin:
                user.plan_id = default_plan.id
            continue
        plan = plan_by_codes.get(key)
        if plan is None:
            plan = Plan(
                name=f"Legacy plan ({user.email})",
                description="Migrated from direct user action assignments.",
                price=0,
                is_active=True,
            )
            db.add(plan)
            db.flush()
            plan.actions = ensure_actions(db, sorted(key))
            plan_by_codes[key] = plan
        user.plan_id = plan.id
        db.add(user)

    db.commit()

    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS user_actions"))
