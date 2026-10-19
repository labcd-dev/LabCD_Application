"""Blog post CMS service."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend_api.common.pagination import PaginationResult, paginate_query
from backend_api.db.models import BlogPost

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", text.strip().lower()).strip("-")
    return slug[:320] or "post"


def _unique_slug(db: Session, base: str, exclude_id: int | None = None) -> str:
    candidate = base
    suffix = 2
    while True:
        query = db.query(BlogPost).filter(BlogPost.slug == candidate)
        if exclude_id is not None:
            query = query.filter(BlogPost.id != exclude_id)
        if query.first() is None:
            return candidate
        candidate = f"{base}-{suffix}"[:320]
        suffix += 1


def list_posts(
    db: Session,
    *,
    published_only: bool = False,
    page: int = 1,
    page_size: int | None = None,
) -> PaginationResult[BlogPost]:
    query = db.query(BlogPost)
    if published_only:
        query = query.filter(BlogPost.status == "published")
    query = query.order_by(BlogPost.created_at.desc())
    return paginate_query(query, page=page, page_size=page_size)


def get_post(db: Session, post_id: int) -> BlogPost | None:
    return db.query(BlogPost).filter(BlogPost.id == post_id).first()


def get_post_by_slug(db: Session, slug: str, *, published_only: bool = False) -> BlogPost | None:
    query = db.query(BlogPost).filter(BlogPost.slug == slug)
    if published_only:
        query = query.filter(BlogPost.status == "published")
    return query.first()


def create_post(
    db: Session,
    *,
    title: str,
    slug: str | None,
    excerpt: str,
    body_markdown: str,
    cover_image_url: str | None,
    status: str,
    author_id: int | None,
) -> BlogPost:
    base = slugify(slug or title)
    final_slug = _unique_slug(db, base)
    now = datetime.now(timezone.utc)
    published_at = now if status == "published" else None
    row = BlogPost(
        title=title.strip(),
        slug=final_slug,
        excerpt=excerpt or "",
        body_markdown=body_markdown or "",
        cover_image_url=cover_image_url or None,
        status=status,
        published_at=published_at,
        author_id=author_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_post(
    db: Session,
    row: BlogPost,
    *,
    title: str | None = None,
    slug: str | None = None,
    excerpt: str | None = None,
    body_markdown: str | None = None,
    cover_image_url: str | None | object = None,
    update_cover: bool = False,
    status: str | None = None,
) -> BlogPost:
    if title is not None:
        row.title = title.strip()
    if slug is not None:
        row.slug = _unique_slug(db, slugify(slug), exclude_id=row.id)
    if excerpt is not None:
        row.excerpt = excerpt
    if body_markdown is not None:
        row.body_markdown = body_markdown
    if update_cover:
        row.cover_image_url = cover_image_url if isinstance(cover_image_url, str) else None
        if cover_image_url == "":
            row.cover_image_url = None
    if status is not None:
        previous = row.status
        row.status = status
        if status == "published" and previous != "published":
            row.published_at = datetime.now(timezone.utc)
    row.updated_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_post(db: Session, row: BlogPost) -> None:
    db.delete(row)
    db.commit()
