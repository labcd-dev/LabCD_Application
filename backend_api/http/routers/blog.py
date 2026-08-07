"""Public and admin routes for the blog CMS."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import require_action
from backend_api.http.schemas.blog import (
    BlogPostCreate,
    BlogPostListItem,
    BlogPostOut,
    BlogPostUpdate,
)
from backend_api.http.services import blog_service

router = APIRouter(tags=["blog"])


@router.get("/blog", response_model=list[BlogPostListItem])
def list_published_posts(db: Session = Depends(get_db)) -> list[BlogPostListItem]:
    return [BlogPostListItem.model_validate(p) for p in blog_service.list_posts(db, published_only=True)]


@router.get("/blog/{slug}", response_model=BlogPostOut)
def get_published_post(slug: str, db: Session = Depends(get_db)) -> BlogPostOut:
    post = blog_service.get_post_by_slug(db, slug, published_only=True)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return BlogPostOut.model_validate(post)


@router.get("/admin/blog", response_model=list[BlogPostListItem])
def admin_list_posts(
    _: User = Depends(require_action("admin:blog")),
    db: Session = Depends(get_db),
) -> list[BlogPostListItem]:
    return [BlogPostListItem.model_validate(p) for p in blog_service.list_posts(db)]


@router.get("/admin/blog/{post_id}", response_model=BlogPostOut)
def admin_get_post(
    post_id: int,
    _: User = Depends(require_action("admin:blog")),
    db: Session = Depends(get_db),
) -> BlogPostOut:
    post = blog_service.get_post(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return BlogPostOut.model_validate(post)


@router.post("/admin/blog", response_model=BlogPostOut, status_code=status.HTTP_201_CREATED)
def admin_create_post(
    body: BlogPostCreate,
    admin: User = Depends(require_action("admin:blog")),
    db: Session = Depends(get_db),
) -> BlogPostOut:
    row = blog_service.create_post(
        db,
        title=body.title,
        slug=body.slug,
        excerpt=body.excerpt,
        body_markdown=body.body_markdown,
        cover_image_url=body.cover_image_url,
        status=body.status,
        author_id=admin.id,
    )
    return BlogPostOut.model_validate(row)


@router.patch("/admin/blog/{post_id}", response_model=BlogPostOut)
def admin_update_post(
    post_id: int,
    body: BlogPostUpdate,
    _: User = Depends(require_action("admin:blog")),
    db: Session = Depends(get_db),
) -> BlogPostOut:
    post = blog_service.get_post(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    updated = blog_service.update_post(
        db,
        post,
        title=body.title,
        slug=body.slug,
        excerpt=body.excerpt,
        body_markdown=body.body_markdown,
        cover_image_url=body.cover_image_url,
        update_cover="cover_image_url" in body.model_fields_set,
        status=body.status,
    )
    return BlogPostOut.model_validate(updated)


@router.delete("/admin/blog/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_post(
    post_id: int,
    _: User = Depends(require_action("admin:blog")),
    db: Session = Depends(get_db),
) -> None:
    post = blog_service.get_post(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    blog_service.delete_post(db, post)
