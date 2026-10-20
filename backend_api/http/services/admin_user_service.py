"""Admin aggregation of user account, survey, project, and error data."""

from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from backend_api.common.date_range import apply_sql_date_range
from backend_api.common.pagination import PaginationResult, paginate_query
from backend_api.common.query_sort import apply_sql_order, resolve_sort_key
from backend_api.db.models import FeedbackSurveyResponse, LoginHistory, Plan, Role, User
from backend_api.http.services import session_service
from backend_api.http.services.auth_service import get_user_by_id, is_last_active_admin
from backend_api.http.services.profile_service import user_out

USER_SORT_KEYS = (
    "email",
    "role_name",
    "is_active",
    "plan_name",
    "created_at",
)


def list_users(
    db: Session,
    *,
    q: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
    sort_by: str | None = None,
    sort_dir: str | None = None,
    page: int = 1,
    page_size: int | None = None,
    deleted: bool = False,
) -> PaginationResult[User]:
    query = (
        db.query(User)
        .outerjoin(Plan, Plan.id == User.plan_id)
        .outerjoin(Role, Role.id == User.role_id)
        .options(joinedload(User.plan), joinedload(User.role))
    )
    if deleted:
        query = query.filter(User.deleted_at.isnot(None))
    else:
        query = query.filter(User.deleted_at.is_(None))

    query = apply_sql_date_range(
        query,
        User.created_at,
        date_from=date_from,
        date_to=date_to,
        tz=tz,
    )

    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        query = query.filter(
            or_(
                User.email.ilike(like),
                Plan.name.ilike(like),
                Role.name.ilike(like),
            )
        )

    sort_key = resolve_sort_key(sort_by, USER_SORT_KEYS, default="email")
    query = apply_sql_order(
        query,
        {
            "email": User.email,
            "role_name": Role.name,
            "is_active": User.is_active,
            "plan_name": Plan.name,
            "created_at": User.created_at,
        },
        sort_by=sort_key,
        sort_dir=sort_dir,
        default_key="email",
        default_dir="asc",
    )
    return paginate_query(query, page=page, page_size=page_size)


def list_user_options(db: Session) -> list[dict]:
    """Lightweight id/email list for admin filter dropdowns."""
    rows = (
        db.query(User.id, User.email)
        .filter(User.deleted_at.is_(None))
        .order_by(User.email.asc())
        .all()
    )
    return [{"id": row.id, "email": row.email} for row in rows]


def user_overview_stats(db: Session) -> dict[str, int]:
    total = db.query(User).filter(User.deleted_at.is_(None)).count()
    active = (
        db.query(User)
        .filter(User.is_active.is_(True), User.deleted_at.is_(None))
        .count()
    )
    admins = (
        db.query(User)
        .filter(User.is_admin.is_(True), User.deleted_at.is_(None))
        .count()
    )
    return {"total": total, "active": active, "admins": admins}


def list_user_login_history(
    db: Session,
    user_id: int,
    *,
    page: int = 1,
    page_size: int | None = 25,
) -> PaginationResult[LoginHistory]:
    query = (
        db.query(LoginHistory)
        .filter(LoginHistory.user_id == user_id)
        .order_by(LoginHistory.created_at.desc())
    )
    return paginate_query(query, page=page, page_size=page_size)


def get_user_detail(db: Session, user_id: int) -> dict | None:
    user = get_user_by_id(db, user_id)
    if user is None:
        return None

    feedback_rows = (
        db.query(FeedbackSurveyResponse)
        .filter(FeedbackSurveyResponse.user_id == user_id)
        .order_by(FeedbackSurveyResponse.created_at.asc())
        .all()
    )

    profile_survey = None
    if user.profile_survey_completed_at is not None:
        profile_survey = {
            "university": user.university,
            "degree": user.degree,
            "major": user.major,
            "matlab_experience": user.matlab_experience,
            "control_design_experience": user.control_design_experience,
            "onboarding_answers": user.onboarding_answers,
            "completed_at": user.profile_survey_completed_at,
        }

    feedback_surveys = [
        {
            "pipeline_type": row.pipeline_type,
            "satisfaction": row.satisfaction,
            "ease_of_use": row.ease_of_use,
            "product_value": row.product_value,
            "confidence": row.confidence,
            "reuse_intention": row.reuse_intention,
            "willingness_to_pay": row.willingness_to_pay,
            "main_problems": row.main_problems,
            "created_at": row.created_at,
        }
        for row in feedback_rows
    ]

    return {
        "user": user_out(user),
        "allowed_models": user.model_ids(),
        "profile_survey": profile_survey,
        "feedback_surveys": feedback_surveys,
        # Nested lists are loaded via dedicated paginated endpoints.
        "projects": [],
        "errors": [],
        "login_history": [],
        "sessions": [
            {
                "id": row.id,
                "ip_address": row.ip_address,
                "user_agent": row.user_agent,
                "created_at": row.created_at,
                "last_seen_at": row.last_seen_at,
                "is_current": False,
            }
            for row in session_service.list_user_sessions(db, user_id)
        ],
    }


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()


def guard_admin_account_change(
    db: Session,
    *,
    actor: User,
    target: User,
    deactivating: bool = False,
    demoting: bool = False,
    deleting: bool = False,
) -> None:
    """Raise ValueError when an admin account change is not allowed."""
    if target.id == actor.id and (deactivating or deleting):
        raise ValueError("You cannot suspend or delete your own account")

    removing_admin_access = deleting or deactivating or demoting
    if removing_admin_access and is_last_active_admin(db, target):
        raise ValueError("Cannot remove the last active admin")
