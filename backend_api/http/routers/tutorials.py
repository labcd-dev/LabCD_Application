"""User and admin routes for the tutorials learning module."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user, require_action
from backend_api.http.schemas.tutorials import (
    ControlDesignTemplateOut,
    ControlDesignTemplateUpdateRequest,
    TutorialDocumentCreateRequest,
    TutorialDocumentOut,
    TutorialDocumentSummaryOut,
    TutorialDocumentUpdateRequest,
    TutorialVideoOut,
    TutorialVideoUpdateRequest,
)
from backend_api.http.services import audit_service, tutorials_service

router = APIRouter(tags=["tutorials"])


# --- Authenticated user read APIs ---


@router.get("/tutorials/videos", response_model=list[TutorialVideoOut])
def list_videos(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TutorialVideoOut]:
    return [TutorialVideoOut.model_validate(v) for v in tutorials_service.list_videos(db)]


@router.get("/tutorials/documents", response_model=list[TutorialDocumentSummaryOut])
def list_documents(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TutorialDocumentSummaryOut]:
    return [
        TutorialDocumentSummaryOut.model_validate(d)
        for d in tutorials_service.list_documents(db)
    ]


@router.get("/tutorials/documents/{slug}", response_model=TutorialDocumentOut)
def get_document(
    slug: str,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TutorialDocumentOut:
    document = tutorials_service.get_document_by_slug(db, slug)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return TutorialDocumentOut.model_validate(document)


@router.get("/tutorials/templates", response_model=list[ControlDesignTemplateOut])
def list_templates(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ControlDesignTemplateOut]:
    return [
        ControlDesignTemplateOut.model_validate(t)
        for t in tutorials_service.list_templates(db)
    ]


# --- Admin: videos ---


@router.get("/admin/tutorials/videos", response_model=list[TutorialVideoOut])
def admin_list_videos(
    _: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> list[TutorialVideoOut]:
    return [TutorialVideoOut.model_validate(v) for v in tutorials_service.list_videos(db)]


@router.post(
    "/admin/tutorials/videos",
    response_model=TutorialVideoOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_upload_video(
    http_request: Request,
    title: str = Form(..., min_length=1, max_length=200),
    file: UploadFile = File(...),
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> TutorialVideoOut:
    try:
        row = await tutorials_service.create_video(db, title=title, file=file)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.tutorial_video.create",
        category="admin",
        actor=admin,
        resource_type="tutorial_video",
        resource_id=row.id,
        success=True,
        details={"title": row.title},
    )
    return TutorialVideoOut.model_validate(row)


@router.patch("/admin/tutorials/videos/{video_id}", response_model=TutorialVideoOut)
def admin_update_video(
    video_id: int,
    request: TutorialVideoUpdateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> TutorialVideoOut:
    video = tutorials_service.get_video(db, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    updated = tutorials_service.update_video(
        db,
        video,
        title=request.title,
        sort_order=request.sort_order,
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.tutorial_video.update",
        category="admin",
        actor=admin,
        resource_type="tutorial_video",
        resource_id=updated.id,
        success=True,
        details={"fields": sorted(request.model_fields_set)},
    )
    return TutorialVideoOut.model_validate(updated)


@router.delete("/admin/tutorials/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_video(
    video_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> None:
    video = tutorials_service.get_video(db, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    title = video.title
    tutorials_service.delete_video(db, video)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.tutorial_video.delete",
        category="admin",
        actor=admin,
        resource_type="tutorial_video",
        resource_id=video_id,
        success=True,
        details={"title": title},
    )


# --- Admin: documents ---


@router.get("/admin/tutorials/documents", response_model=list[TutorialDocumentOut])
def admin_list_documents(
    _: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> list[TutorialDocumentOut]:
    return [
        TutorialDocumentOut.model_validate(d) for d in tutorials_service.list_documents(db)
    ]


@router.post(
    "/admin/tutorials/documents",
    response_model=TutorialDocumentOut,
    status_code=status.HTTP_201_CREATED,
)
def admin_create_document(
    request: TutorialDocumentCreateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> TutorialDocumentOut:
    row = tutorials_service.create_document(
        db,
        title=request.title,
        body_markdown=request.body_markdown,
        slug=request.slug,
        sort_order=request.sort_order,
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.tutorial_document.create",
        category="admin",
        actor=admin,
        resource_type="tutorial_document",
        resource_id=row.id,
        success=True,
        details={"title": row.title, "slug": row.slug},
    )
    return TutorialDocumentOut.model_validate(row)


@router.get("/admin/tutorials/documents/{document_id}", response_model=TutorialDocumentOut)
def admin_get_document(
    document_id: int,
    _: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> TutorialDocumentOut:
    document = tutorials_service.get_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return TutorialDocumentOut.model_validate(document)


@router.patch("/admin/tutorials/documents/{document_id}", response_model=TutorialDocumentOut)
def admin_update_document(
    document_id: int,
    request: TutorialDocumentUpdateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> TutorialDocumentOut:
    document = tutorials_service.get_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    updated = tutorials_service.update_document(
        db,
        document,
        title=request.title,
        slug=request.slug,
        body_markdown=request.body_markdown,
        sort_order=request.sort_order,
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.tutorial_document.update",
        category="admin",
        actor=admin,
        resource_type="tutorial_document",
        resource_id=updated.id,
        success=True,
        details={"fields": sorted(request.model_fields_set)},
    )
    return TutorialDocumentOut.model_validate(updated)


@router.delete("/admin/tutorials/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_document(
    document_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> None:
    document = tutorials_service.get_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    title = document.title
    tutorials_service.delete_document(db, document)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.tutorial_document.delete",
        category="admin",
        actor=admin,
        resource_type="tutorial_document",
        resource_id=document_id,
        success=True,
        details={"title": title},
    )


# --- Admin: templates ---


@router.get("/admin/tutorials/templates", response_model=list[ControlDesignTemplateOut])
def admin_list_templates(
    _: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> list[ControlDesignTemplateOut]:
    return [
        ControlDesignTemplateOut.model_validate(t)
        for t in tutorials_service.list_templates(db)
    ]


@router.post(
    "/admin/tutorials/templates",
    response_model=ControlDesignTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_upload_template(
    http_request: Request,
    title: str = Form(..., min_length=1, max_length=200),
    description: str = Form(""),
    file: UploadFile = File(...),
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> ControlDesignTemplateOut:
    try:
        row = await tutorials_service.create_template(
            db,
            title=title,
            description=description,
            file=file,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.control_design_template.create",
        category="admin",
        actor=admin,
        resource_type="control_design_template",
        resource_id=row.id,
        success=True,
        details={"title": row.title},
    )
    return ControlDesignTemplateOut.model_validate(row)


@router.patch(
    "/admin/tutorials/templates/{template_id}",
    response_model=ControlDesignTemplateOut,
)
def admin_update_template(
    template_id: int,
    request: ControlDesignTemplateUpdateRequest,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> ControlDesignTemplateOut:
    template = tutorials_service.get_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    updated = tutorials_service.update_template(
        db,
        template,
        title=request.title,
        description=request.description,
        sort_order=request.sort_order,
    )
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.control_design_template.update",
        category="admin",
        actor=admin,
        resource_type="control_design_template",
        resource_id=updated.id,
        success=True,
        details={"fields": sorted(request.model_fields_set)},
    )
    return ControlDesignTemplateOut.model_validate(updated)


@router.delete(
    "/admin/tutorials/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def admin_delete_template(
    template_id: int,
    http_request: Request,
    admin: User = Depends(require_action("admin:tutorials")),
    db: Session = Depends(get_db),
) -> None:
    template = tutorials_service.get_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    title = template.title
    tutorials_service.delete_template(db, template)
    audit_service.record_from_request(
        db,
        http_request,
        action="admin.control_design_template.delete",
        category="admin",
        actor=admin,
        resource_type="control_design_template",
        resource_id=template_id,
        success=True,
        details={"title": title},
    )
