"""Plan CRUD and default-registration-plan settings."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from backend_api.db.models import AppSetting, Plan, User
from backend_api.http.config import DEFAULT_LLM_MODELS
from backend_api.http.services.auth_service import ensure_actions

DEFAULT_PLAN_SETTING_KEY = "default_plan_id"


def normalize_plan_models(models: list[str] | None) -> list[str]:
    """Keep known catalog models only, preserving DEFAULT_LLM_MODELS order."""
    catalog = set(DEFAULT_LLM_MODELS)
    selected = {item.strip() for item in (models or []) if item and item.strip()}
    unknown = sorted(selected - catalog)
    if unknown:
        raise ValueError(f"Unknown model(s): {', '.join(unknown)}")
    return [model for model in DEFAULT_LLM_MODELS if model in selected]


def get_setting(db: Session, key: str) -> str | None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return row.value if row else None


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row is None:
        row = AppSetting(key=key, value=value)
    else:
        row.value = value
    db.add(row)
    db.commit()


def get_default_plan_id(db: Session) -> int | None:
    raw = get_setting(db, DEFAULT_PLAN_SETTING_KEY)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def get_default_plan(db: Session) -> Plan | None:
    plan_id = get_default_plan_id(db)
    if plan_id is None:
        return None
    return db.query(Plan).filter(Plan.id == plan_id).first()


def set_default_plan(db: Session, plan_id: int) -> Plan:
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if plan is None:
        raise ValueError("Plan not found")
    if not plan.is_active:
        raise ValueError("Default plan must be active")
    set_setting(db, DEFAULT_PLAN_SETTING_KEY, str(plan.id))
    return plan


def list_plans(
    db: Session,
    *,
    active_only: bool = False,
    q: str | None = None,
    sort_by: str | None = None,
    sort_dir: str | None = None,
) -> list[Plan]:
    from backend_api.common.query_sort import sort_rows

    query = db.query(Plan)
    if active_only:
        query = query.filter(Plan.is_active.is_(True))
    plans = query.all()

    needle = (q or "").strip().lower()
    if needle:
        filtered: list[Plan] = []
        for plan in plans:
            if (
                needle in (plan.name or "").lower()
                or needle in (plan.description or "").lower()
                or any(needle in code.lower() for code in plan.action_codes())
                or any(needle in model.lower() for model in plan.model_ids())
            ):
                filtered.append(plan)
        plans = filtered

    return sort_rows(
        plans,
        sort_by=sort_by,
        sort_dir=sort_dir,
        default_key="price",
        default_dir="asc",
        accessors={
            "name": lambda p: p.name or "",
            "price": lambda p: float(p.price) if p.price is not None else 0.0,
            "is_active": lambda p: bool(p.is_active),
        },
    )


def get_plan(db: Session, plan_id: int) -> Plan | None:
    return db.query(Plan).filter(Plan.id == plan_id).first()


def get_plan_by_name(db: Session, name: str) -> Plan | None:
    return db.query(Plan).filter(Plan.name == name.strip()).first()


def _normalize_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def create_plan(
    db: Session,
    *,
    name: str,
    description: str = "",
    price: Decimal | float | str = Decimal("0.00"),
    action_codes: list[str] | None = None,
    models: list[str] | None = None,
    is_active: bool = True,
    plan_code: str | None = None,
    price_yearly: Decimal | float | str | None = None,
    is_contact_sales: bool = False,
    is_most_popular: bool = False,
    stripe_product_id: str | None = None,
    stripe_price_id_monthly: str | None = None,
    stripe_price_id_yearly: str | None = None,
) -> Plan:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Plan name is required")
    if get_plan_by_name(db, normalized) is not None:
        raise ValueError("A plan with this name already exists")
    plan = Plan(
        name=normalized,
        description=description.strip(),
        price=Decimal(str(price)),
        is_active=is_active,
        allowed_models=normalize_plan_models(models),
        plan_code=_normalize_optional_str(plan_code),
        price_yearly=(Decimal(str(price_yearly)) if price_yearly is not None else None),
        is_contact_sales=is_contact_sales,
        is_most_popular=is_most_popular,
        stripe_product_id=_normalize_optional_str(stripe_product_id),
        stripe_price_id_monthly=_normalize_optional_str(stripe_price_id_monthly),
        stripe_price_id_yearly=_normalize_optional_str(stripe_price_id_yearly),
    )
    db.add(plan)
    db.flush()
    if action_codes:
        plan.actions = ensure_actions(db, action_codes)
    db.commit()
    db.refresh(plan)
    return plan


def update_plan(
    db: Session,
    plan: Plan,
    *,
    name: str | None = None,
    description: str | None = None,
    price: Decimal | float | str | None = None,
    action_codes: list[str] | None = None,
    models: list[str] | None = None,
    is_active: bool | None = None,
    plan_code: str | None = None,
    price_yearly: Decimal | float | str | None = None,
    is_contact_sales: bool | None = None,
    is_most_popular: bool | None = None,
    stripe_product_id: str | None = None,
    stripe_price_id_monthly: str | None = None,
    stripe_price_id_yearly: str | None = None,
) -> Plan:
    if name is not None:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Plan name is required")
        existing = get_plan_by_name(db, normalized)
        if existing is not None and existing.id != plan.id:
            raise ValueError("A plan with this name already exists")
        plan.name = normalized
    if description is not None:
        plan.description = description.strip()
    if price is not None:
        plan.price = Decimal(str(price))
    if is_active is not None:
        plan.is_active = is_active
        if not is_active and get_default_plan_id(db) == plan.id:
            raise ValueError("Cannot deactivate the default registration plan")
    if action_codes is not None:
        plan.actions = ensure_actions(db, action_codes)
    if models is not None:
        plan.allowed_models = normalize_plan_models(models)
    if plan_code is not None:
        plan.plan_code = _normalize_optional_str(plan_code)
    if price_yearly is not None:
        plan.price_yearly = Decimal(str(price_yearly)) if str(price_yearly).strip() else None
    if is_contact_sales is not None:
        plan.is_contact_sales = is_contact_sales
    if is_most_popular is not None:
        plan.is_most_popular = is_most_popular
    if stripe_product_id is not None:
        plan.stripe_product_id = _normalize_optional_str(stripe_product_id)
    if stripe_price_id_monthly is not None:
        plan.stripe_price_id_monthly = _normalize_optional_str(stripe_price_id_monthly)
    if stripe_price_id_yearly is not None:
        plan.stripe_price_id_yearly = _normalize_optional_str(stripe_price_id_yearly)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def delete_plan(db: Session, plan: Plan) -> None:
    if get_default_plan_id(db) == plan.id:
        raise ValueError("Cannot delete the default registration plan")
    assigned = db.query(User).filter(User.plan_id == plan.id).count()
    if assigned > 0:
        raise ValueError("Cannot delete a plan that is assigned to users")
    db.delete(plan)
    db.commit()


def set_user_plan(db: Session, user: User, plan_id: int | None) -> User:
    if plan_id is None:
        user.plan_id = None
    else:
        plan = get_plan(db, plan_id)
        if plan is None:
            raise ValueError("Plan not found")
        if not plan.is_active:
            raise ValueError("Cannot assign an inactive plan")
        user.plan = plan
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def plan_out_dict(plan: Plan) -> dict:
    return {
        "id": plan.id,
        "name": plan.name,
        "description": plan.description,
        "price": float(plan.price),
        "is_active": plan.is_active,
        "actions": plan.action_codes(),
        "models": plan.model_ids(),
        "created_at": plan.created_at,
        "plan_code": plan.plan_code,
        "price_yearly": (float(plan.price_yearly) if plan.price_yearly is not None else None),
        "is_contact_sales": plan.is_contact_sales,
        "is_most_popular": plan.is_most_popular,
        "stripe_product_id": plan.stripe_product_id,
        "stripe_price_id_monthly": plan.stripe_price_id_monthly,
        "stripe_price_id_yearly": plan.stripe_price_id_yearly,
        "stripe_configured": bool(plan.is_contact_sales or plan.stripe_price_id_monthly or plan.stripe_price_id_yearly),
    }


# --------------------------------------------------------------------------
# Stripe pricing-page tiers (Plus / Pro / Business / Enterprise)
# --------------------------------------------------------------------------
# Seeded additively (matched by plan_code, not name) so this never touches or
# renames the pre-existing Free / Single Loop / Multi Loop / Full Access
# plans or any user already assigned to them. Admins fill in the Stripe
# product/price IDs afterwards from Admin -> Plans (see STRIPE_SETUP.md).

STRIPE_BILLING_PLAN_DEFS: list[dict] = [
    {
        "plan_code": "plus",
        "name": "Plus",
        "description": "Get started with the Single Loop pipeline.",
        "price": Decimal("14.90"),
        "price_yearly": Decimal("149.00"),
        "action_codes": [
            "pipeline:silo",
            "module:upload",
            "module:regularize",
            "module:silo",
        ],
        "models": ["gpt-4o-mini", "gpt-4o"],
        "is_most_popular": False,
        "is_contact_sales": False,
    },
    {
        "plan_code": "pro",
        "name": "Pro",
        "description": "Single Loop and Multi Loop pipelines, most popular.",
        "price": Decimal("149.90"),
        "price_yearly": Decimal("1499.00"),
        "action_codes": [
            "pipeline:silo",
            "pipeline:mulo",
            "module:upload",
            "module:regularize",
            "module:recommender",
            "module:trimmer",
            "module:silo",
            "module:mulo",
            "module:case_studies",
        ],
        "models": list(DEFAULT_LLM_MODELS),
        "is_most_popular": True,
        "is_contact_sales": False,
    },
    {
        "plan_code": "business",
        "name": "Business",
        "description": "Full pipeline suite: Single Loop, Multi Loop, Adaptive, and MPC.",
        "price": Decimal("349.90"),
        "price_yearly": Decimal("3499.00"),
        "action_codes": [
            "pipeline:silo",
            "pipeline:mulo",
            "pipeline:adaptive",
            "pipeline:mpc",
            "module:upload",
            "module:regularize",
            "module:recommender",
            "module:trimmer",
            "module:silo",
            "module:mulo",
            "module:adaptive",
            "module:mpc",
            "module:case_studies",
        ],
        "models": list(DEFAULT_LLM_MODELS),
        "is_most_popular": False,
        "is_contact_sales": False,
    },
    {
        "plan_code": "enterprise",
        "name": "Enterprise",
        "description": "Custom volume, SSO, and support — contact us.",
        "price": Decimal("0.00"),
        "price_yearly": None,
        "action_codes": [
            "pipeline:silo",
            "pipeline:mulo",
            "pipeline:adaptive",
            "pipeline:mpc",
            "module:upload",
            "module:regularize",
            "module:recommender",
            "module:trimmer",
            "module:silo",
            "module:mulo",
            "module:adaptive",
            "module:mpc",
            "module:case_studies",
        ],
        "models": list(DEFAULT_LLM_MODELS),
        "is_most_popular": False,
        "is_contact_sales": True,
    },
]


def get_plan_by_code(db: Session, plan_code: str) -> Plan | None:
    return db.query(Plan).filter(Plan.plan_code == plan_code).first()


def seed_billing_plans(db: Session) -> None:
    """Create the Plus/Pro/Business/Enterprise plans if they don't exist yet.

    Idempotent and additive: matches on ``plan_code``, never renames or
    deletes an existing plan, and never changes the default registration
    plan. Safe to call on every startup.
    """
    for plan_def in STRIPE_BILLING_PLAN_DEFS:
        existing = get_plan_by_code(db, plan_def["plan_code"])
        if existing is not None:
            continue
        plan = Plan(
            name=plan_def["name"],
            description=plan_def["description"],
            price=plan_def["price"],
            is_active=True,
            allowed_models=normalize_plan_models(plan_def["models"]),
            plan_code=plan_def["plan_code"],
            price_yearly=plan_def["price_yearly"],
            is_contact_sales=plan_def["is_contact_sales"],
            is_most_popular=plan_def["is_most_popular"],
        )
        db.add(plan)
        db.flush()
        plan.actions = ensure_actions(db, plan_def["action_codes"])
    db.commit()
