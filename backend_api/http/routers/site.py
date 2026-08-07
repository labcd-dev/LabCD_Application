"""Public and admin routes for site branding, landing CMS, and menus."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import require_action
from backend_api.http.schemas.common import MediaUploadResponse
from backend_api.http.schemas.site import (
    LandingPayload,
    NavMenuItemCreate,
    NavMenuItemOut,
    NavMenuItemUpdate,
    SiteBrand,
)
from backend_api.http.services import audit_service, media_service, site_service

router = APIRouter(tags=["site"])


def _menus_out(grouped: dict) -> dict[str, list[NavMenuItemOut]]:
    return {
        loc: [NavMenuItemOut.model_validate(item) for item in items]
        for loc, items in grouped.items()
    }


@router.get("/site/landing", response_model=LandingPayload)
def get_landing(db: Session = Depends(get_db)) -> LandingPayload:
    brand, menus, landing = site_service.get_public_landing(db)
    return LandingPayload(brand=brand, menus=_menus_out(menus), landing=landing)


@router.post("/admin/media", response_model=MediaUploadResponse)
async def admin_upload_media(
    http_request: Request,
    file: UploadFile = File(...),
    prefix: str = Form("image"),
    admin: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> MediaUploadResponse:
    try:
        url = await media_service.save_admin_image(file, prefix=prefix)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.media.upload",
        category="admin",
        actor=admin,
        resource_type="media",
        success=True,
        details={"prefix": prefix},
    )
    return MediaUploadResponse(url=url)


@router.get("/admin/site/brand", response_model=SiteBrand)
def admin_get_brand(
    _: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> SiteBrand:
    return site_service.get_brand(db)


@router.put("/admin/site/brand", response_model=SiteBrand)
def admin_put_brand(
    body: SiteBrand,
    http_request: Request,
    admin: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> SiteBrand:
    result = site_service.set_brand(db, body)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.site.brand.update",
        category="admin",
        actor=admin,
        resource_type="site_brand",
        success=True,
    )
    return result


@router.get("/admin/site/landing")
def admin_get_landing(
    _: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return site_service.get_landing_content(db)


@router.put("/admin/site/landing")
def admin_put_landing(
    body: dict[str, Any],
    http_request: Request,
    admin: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    result = site_service.set_landing_content(db, body)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.site.landing.update",
        category="admin",
        actor=admin,
        resource_type="site_landing",
        success=True,
        details={"keys": sorted(body.keys())},
    )
    return result


@router.get("/admin/site/menus", response_model=list[NavMenuItemOut])
def admin_list_menus(
    location: str | None = None,
    _: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> list[NavMenuItemOut]:
    return [NavMenuItemOut.model_validate(m) for m in site_service.list_menus(db, location)]


@router.post("/admin/site/menus", response_model=NavMenuItemOut, status_code=status.HTTP_201_CREATED)
def admin_create_menu(
    body: NavMenuItemCreate,
    http_request: Request,
    admin: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> NavMenuItemOut:
    try:
        row = site_service.create_menu(
            db,
            location=body.location,
            label=body.label,
            href=body.href,
            sort_order=body.sort_order,
            is_external=body.is_external,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.site.menu.create",
        category="admin",
        actor=admin,
        resource_type="nav_menu",
        resource_id=row.id,
        success=True,
        details={"location": row.location, "label": row.label},
    )
    return NavMenuItemOut.model_validate(row)


@router.patch("/admin/site/menus/{menu_id}", response_model=NavMenuItemOut)
def admin_update_menu(
    menu_id: int,
    body: NavMenuItemUpdate,
    http_request: Request,
    admin: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> NavMenuItemOut:
    row = site_service.get_menu(db, menu_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")
    try:
        updated = site_service.update_menu(
            db,
            row,
            location=body.location,
            label=body.label,
            href=body.href,
            sort_order=body.sort_order,
            is_external=body.is_external,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.site.menu.update",
        category="admin",
        actor=admin,
        resource_type="nav_menu",
        resource_id=updated.id,
        success=True,
        details={"fields": sorted(body.model_fields_set)},
    )
    return NavMenuItemOut.model_validate(updated)


@router.delete("/admin/site/menus/{menu_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_menu(
    menu_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:site")),
    db: Session = Depends(get_db),
) -> None:
    row = site_service.get_menu(db, menu_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")
    label = row.label
    site_service.delete_menu(db, row)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.site.menu.delete",
        category="admin",
        actor=admin,
        resource_type="nav_menu",
        resource_id=menu_id,
        success=True,
        details={"label": label},
    )
