"""Tutorial videos, markdown docs, and Control Design Templates."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from backend_api.db.models import ControlDesignTemplate, TutorialDocument, TutorialVideo
from backend_api.http.config import API_PREFIX, UPLOADS_DIR

TUTORIALS_DIR = UPLOADS_DIR / "tutorials"
TEMPLATES_DIR = UPLOADS_DIR / "templates"

ALLOWED_VIDEO_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
MAX_VIDEO_BYTES = 100 * 1024 * 1024

ALLOWED_TEMPLATE_EXTENSIONS = {
    ".xlsx",
    ".xls",
    ".csv",
    ".json",
    ".mat",
    ".m",
    ".py",
    ".zip",
    ".pdf",
    ".slx",
    ".mdl",
}
MAX_TEMPLATE_BYTES = 50 * 1024 * 1024

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", text.strip().lower()).strip("-")
    return slug[:320] or "doc"


def _unique_doc_slug(db: Session, base: str, exclude_id: int | None = None) -> str:
    candidate = base
    suffix = 2
    while True:
        query = db.query(TutorialDocument).filter(TutorialDocument.slug == candidate)
        if exclude_id is not None:
            query = query.filter(TutorialDocument.id != exclude_id)
        if query.first() is None:
            return candidate
        candidate = f"{base}-{suffix}"[:320]
        suffix += 1


# --- Videos ---


def list_videos(db: Session) -> list[TutorialVideo]:
    return (
        db.query(TutorialVideo)
        .order_by(TutorialVideo.sort_order.asc(), TutorialVideo.id.asc())
        .all()
    )


def get_video(db: Session, video_id: int) -> TutorialVideo | None:
    return db.query(TutorialVideo).filter(TutorialVideo.id == video_id).first()


def _remove_video_file(file_url: str | None) -> None:
    if not file_url:
        return
    prefix = f"{API_PREFIX}/uploads/tutorials/"
    if not file_url.startswith(prefix):
        return
    filename = file_url.removeprefix(prefix)
    path = TUTORIALS_DIR / filename
    if path.is_file():
        path.unlink()


async def create_video(db: Session, *, title: str, file: UploadFile) -> TutorialVideo:
    content_type = (file.content_type or "").lower()
    extension = ALLOWED_VIDEO_TYPES.get(content_type)
    if extension is None:
        name = (file.filename or "").lower()
        for ext in (".mp4", ".webm", ".mov"):
            if name.endswith(ext):
                extension = ext
                break
    if extension is None:
        raise ValueError("Video must be MP4, WebM, or MOV")

    data = await file.read()
    if not data:
        raise ValueError("Video file is empty")
    if len(data) > MAX_VIDEO_BYTES:
        raise ValueError("Video must be 100 MB or smaller")

    TUTORIALS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"tutorial_{uuid.uuid4().hex[:12]}{extension}"
    path: Path = TUTORIALS_DIR / filename
    path.write_bytes(data)

    max_order = db.query(TutorialVideo).count()
    row = TutorialVideo(
        title=title.strip(),
        file_url=f"{API_PREFIX}/uploads/tutorials/{filename}",
        sort_order=max_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_video(
    db: Session,
    video: TutorialVideo,
    *,
    title: str | None = None,
    sort_order: int | None = None,
) -> TutorialVideo:
    if title is not None:
        video.title = title.strip()
    if sort_order is not None:
        video.sort_order = sort_order
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


def delete_video(db: Session, video: TutorialVideo) -> None:
    _remove_video_file(video.file_url)
    db.delete(video)
    db.commit()


# --- Documents ---


def list_documents(db: Session) -> list[TutorialDocument]:
    return (
        db.query(TutorialDocument)
        .order_by(TutorialDocument.sort_order.asc(), TutorialDocument.id.asc())
        .all()
    )


def get_document(db: Session, document_id: int) -> TutorialDocument | None:
    return db.query(TutorialDocument).filter(TutorialDocument.id == document_id).first()


def get_document_by_slug(db: Session, slug: str) -> TutorialDocument | None:
    return db.query(TutorialDocument).filter(TutorialDocument.slug == slug).first()


def create_document(
    db: Session,
    *,
    title: str,
    body_markdown: str = "",
    slug: str | None = None,
    sort_order: int | None = None,
) -> TutorialDocument:
    now = datetime.now(timezone.utc)
    base = slugify(slug or title)
    final_slug = _unique_doc_slug(db, base)
    order = sort_order if sort_order is not None else db.query(TutorialDocument).count()
    row = TutorialDocument(
        title=title.strip(),
        slug=final_slug,
        body_markdown=body_markdown,
        sort_order=order,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_document(
    db: Session,
    document: TutorialDocument,
    *,
    title: str | None = None,
    slug: str | None = None,
    body_markdown: str | None = None,
    sort_order: int | None = None,
) -> TutorialDocument:
    if title is not None:
        document.title = title.strip()
    if slug is not None:
        document.slug = _unique_doc_slug(db, slugify(slug), exclude_id=document.id)
    if body_markdown is not None:
        document.body_markdown = body_markdown
    if sort_order is not None:
        document.sort_order = sort_order
    document.updated_at = datetime.now(timezone.utc)
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def delete_document(db: Session, document: TutorialDocument) -> None:
    db.delete(document)
    db.commit()


# --- Templates ---


def list_templates(db: Session) -> list[ControlDesignTemplate]:
    return (
        db.query(ControlDesignTemplate)
        .order_by(ControlDesignTemplate.sort_order.asc(), ControlDesignTemplate.id.asc())
        .all()
    )


def get_template(db: Session, template_id: int) -> ControlDesignTemplate | None:
    return (
        db.query(ControlDesignTemplate)
        .filter(ControlDesignTemplate.id == template_id)
        .first()
    )


def _template_extension(filename: str | None, content_type: str | None) -> str | None:
    name = (filename or "").lower()
    # Longest first so ".mat" is not mistaken for ".m".
    for ext in sorted(ALLOWED_TEMPLATE_EXTENSIONS, key=len, reverse=True):
        if name.endswith(ext):
            return ext
    # Lightweight content-type fallbacks for common types.
    ctype = (content_type or "").lower()
    mapping = {
        "application/pdf": ".pdf",
        "text/csv": ".csv",
        "application/json": ".json",
        "application/zip": ".zip",
        "application/x-zip-compressed": ".zip",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "text/x-python": ".py",
        "application/x-python": ".py",
        "text/x-matlab": ".m",
        "application/x-matlab": ".m",
        "application/matlab-mat": ".mat",
    }
    return mapping.get(ctype)


def _remove_template_file(file_url: str | None) -> None:
    if not file_url:
        return
    prefix = f"{API_PREFIX}/uploads/templates/"
    if not file_url.startswith(prefix):
        return
    filename = file_url.removeprefix(prefix)
    path = TEMPLATES_DIR / filename
    if path.is_file():
        path.unlink()


async def create_template(
    db: Session,
    *,
    title: str,
    description: str,
    file: UploadFile,
) -> ControlDesignTemplate:
    extension = _template_extension(file.filename, file.content_type)
    if extension is None:
        raise ValueError(
            "Template must be one of: "
            + ", ".join(sorted(ALLOWED_TEMPLATE_EXTENSIONS))
        )

    data = await file.read()
    if not data:
        raise ValueError("Template file is empty")
    if len(data) > MAX_TEMPLATE_BYTES:
        raise ValueError("Template must be 50 MB or smaller")

    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"template_{uuid.uuid4().hex[:12]}{extension}"
    path = TEMPLATES_DIR / stored_name
    path.write_bytes(data)

    original = (file.filename or f"template{extension}").strip() or f"template{extension}"
    max_order = db.query(ControlDesignTemplate).count()
    row = ControlDesignTemplate(
        title=title.strip(),
        description=(description or "").strip(),
        file_url=f"{API_PREFIX}/uploads/templates/{stored_name}",
        original_filename=original[:255],
        sort_order=max_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_template(
    db: Session,
    template: ControlDesignTemplate,
    *,
    title: str | None = None,
    description: str | None = None,
    sort_order: int | None = None,
) -> ControlDesignTemplate:
    if title is not None:
        template.title = title.strip()
    if description is not None:
        template.description = description.strip()
    if sort_order is not None:
        template.sort_order = sort_order
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def delete_template(db: Session, template: ControlDesignTemplate) -> None:
    _remove_template_file(template.file_url)
    db.delete(template)
    db.commit()
