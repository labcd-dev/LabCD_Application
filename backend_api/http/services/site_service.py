"""Site branding, landing content, and nav menu CMS."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from backend_api.db.models import NavMenuItem
from backend_api.http.schemas.site import SiteBrand
from backend_api.http.services import plan_service
from backend_api.http.services.site_defaults import (
    DEFAULT_BRAND,
    DEFAULT_LANDING,
    DEFAULT_MENUS,
    MENU_LOCATIONS,
    SETTING_BRAND,
    SETTING_LANDING,
)


def _parse_json(raw: str | None, fallback: dict[str, Any]) -> dict[str, Any]:
    if not raw:
        return dict(fallback)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return dict(fallback)
    if not isinstance(data, dict):
        return dict(fallback)
    merged = dict(fallback)
    merged.update(data)
    return merged


def ensure_site_seeded(db: Session) -> None:
    """Seed brand, landing JSON, and default menus when empty."""
    if plan_service.get_setting(db, SETTING_BRAND) is None:
        plan_service.set_setting(db, SETTING_BRAND, json.dumps(DEFAULT_BRAND))
    if plan_service.get_setting(db, SETTING_LANDING) is None:
        plan_service.set_setting(db, SETTING_LANDING, json.dumps(DEFAULT_LANDING))
    if db.query(NavMenuItem).count() == 0:
        for item in DEFAULT_MENUS:
            db.add(
                NavMenuItem(
                    location=item["location"],
                    label=item["label"],
                    href=item["href"],
                    sort_order=item["sort_order"],
                    is_external=item["is_external"],
                )
            )
        db.commit()


def get_brand(db: Session) -> SiteBrand:
    ensure_site_seeded(db)
    raw = plan_service.get_setting(db, SETTING_BRAND)
    data = {**DEFAULT_BRAND, **_parse_json(raw, DEFAULT_BRAND)}
    return SiteBrand.model_validate(data)


def set_brand(db: Session, brand: SiteBrand) -> SiteBrand:
    plan_service.set_setting(db, SETTING_BRAND, brand.model_dump_json())
    return brand


def get_landing_content(db: Session) -> dict[str, Any]:
    ensure_site_seeded(db)
    raw = plan_service.get_setting(db, SETTING_LANDING)
    return _parse_json(raw, DEFAULT_LANDING)


def set_landing_content(db: Session, content: dict[str, Any]) -> dict[str, Any]:
    # Keep known top-level keys; allow nested edits from admin.
    merged = dict(DEFAULT_LANDING)
    for key in DEFAULT_LANDING:
        if key in content:
            merged[key] = content[key]
    plan_service.set_setting(db, SETTING_LANDING, json.dumps(merged))
    return merged


def list_menus(db: Session, location: str | None = None) -> list[NavMenuItem]:
    ensure_site_seeded(db)
    query = db.query(NavMenuItem)
    if location:
        query = query.filter(NavMenuItem.location == location)
    return query.order_by(NavMenuItem.location, NavMenuItem.sort_order, NavMenuItem.id).all()


def menus_by_location(db: Session) -> dict[str, list[NavMenuItem]]:
    items = list_menus(db)
    grouped: dict[str, list[NavMenuItem]] = {loc: [] for loc in MENU_LOCATIONS}
    for item in items:
        grouped.setdefault(item.location, []).append(item)
    return grouped


def create_menu(
    db: Session,
    *,
    location: str,
    label: str,
    href: str,
    sort_order: int = 0,
    is_external: bool = False,
) -> NavMenuItem:
    if location not in MENU_LOCATIONS:
        raise ValueError(f"Invalid location. Expected one of: {', '.join(MENU_LOCATIONS)}")
    row = NavMenuItem(
        location=location,
        label=label.strip(),
        href=href.strip(),
        sort_order=sort_order,
        is_external=is_external,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_menu(db: Session, menu_id: int) -> NavMenuItem | None:
    return db.query(NavMenuItem).filter(NavMenuItem.id == menu_id).first()


def update_menu(
    db: Session,
    row: NavMenuItem,
    *,
    location: str | None = None,
    label: str | None = None,
    href: str | None = None,
    sort_order: int | None = None,
    is_external: bool | None = None,
) -> NavMenuItem:
    if location is not None:
        if location not in MENU_LOCATIONS:
            raise ValueError(f"Invalid location. Expected one of: {', '.join(MENU_LOCATIONS)}")
        row.location = location
    if label is not None:
        row.label = label.strip()
    if href is not None:
        row.href = href.strip()
    if sort_order is not None:
        row.sort_order = sort_order
    if is_external is not None:
        row.is_external = is_external
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_menu(db: Session, row: NavMenuItem) -> None:
    db.delete(row)
    db.commit()


def get_public_landing(db: Session) -> tuple[SiteBrand, dict[str, list[NavMenuItem]], dict[str, Any]]:
    brand = get_brand(db)
    menus = menus_by_location(db)
    landing = get_landing_content(db)
    return brand, menus, landing
