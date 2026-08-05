"""ORM models for authentication, plans, permissions, and projects."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from backend_api.db.base import Base

plan_actions = Table(
    "plan_actions",
    Base.metadata,
    Column("plan_id", ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True),
    Column("action_id", ForeignKey("actions.id", ondelete="CASCADE"), primary_key=True),
)

# JSONB on PostgreSQL; plain JSON elsewhere (e.g. local SQLite tests).
JsonDict = JSON().with_variant(JSONB(), "postgresql")


class Plan(Base):
    """Subscription-style access plan: price + allowed modules + LLM models."""

    __tablename__ = "plans"
    __table_args__ = (UniqueConstraint("name", name="uq_plans_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allowed_models: Mapped[list[Any]] = mapped_column(JsonDict, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    actions: Mapped[list[Action]] = relationship(
        "Action",
        secondary=plan_actions,
        back_populates="plans",
        lazy="selectin",
    )
    users: Mapped[list[User]] = relationship(
        "User",
        back_populates="plan",
        lazy="noload",
    )

    def action_codes(self) -> list[str]:
        return sorted(action.code for action in self.actions)

    def model_ids(self) -> list[str]:
        raw = self.allowed_models or []
        return [str(item) for item in raw if str(item).strip()]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    theme: Mapped[str] = mapped_column(String(20), default="system", nullable=False)
    plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("plans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    university: Mapped[str | None] = mapped_column(String(200), nullable=True)
    degree: Mapped[str | None] = mapped_column(String(200), nullable=True)
    major: Mapped[str | None] = mapped_column(String(200), nullable=True)
    matlab_experience: Mapped[str | None] = mapped_column(String(40), nullable=True)
    control_design_experience: Mapped[str | None] = mapped_column(String(40), nullable=True)
    profile_survey_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    feedback_survey_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    tutorial_dont_show_again: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    plan: Mapped[Plan | None] = relationship(
        "Plan",
        back_populates="users",
        lazy="selectin",
    )
    projects: Mapped[list[Project]] = relationship(
        "Project",
        back_populates="owner",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    feedback_surveys: Mapped[list[FeedbackSurveyResponse]] = relationship(
        "FeedbackSurveyResponse",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    bug_reports: Mapped[list["BugReport"]] = relationship(
        "BugReport",
        back_populates="user",
        lazy="noload",
    )

    def action_codes(self) -> list[str]:
        if self.plan is None:
            return []
        return self.plan.action_codes()

    def has_action(self, code: str) -> bool:
        if self.is_admin:
            return True
        return code in self.action_codes()

    def model_ids(self) -> list[str]:
        if self.plan is None:
            return []
        return self.plan.model_ids()

    def has_model(self, model: str) -> bool:
        if self.is_admin:
            return True
        return model in self.model_ids()


class Action(Base):
    __tablename__ = "actions"
    __table_args__ = (UniqueConstraint("code", name="uq_actions_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # noload: avoid loading every Plan for every Action on each /auth/me.
    plans: Mapped[list[Plan]] = relationship(
        "Plan",
        secondary=plan_actions,
        back_populates="actions",
        lazy="noload",
    )


class AppSetting(Base):
    """Key/value application settings (e.g. default registration plan)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")


class ErrorEvent(Base):
    """Persisted application / API / frontend error for admin review."""

    __tablename__ = "error_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    stack_trace: Mapped[str | None] = mapped_column(Text, nullable=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True, index=True)
    method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JsonDict, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )


class Project(Base):
    """Persisted Single Loop / Multi Loop design session for a user."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    pipeline_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft", nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    file_type: Mapped[str] = mapped_column(String(40), default="python", nullable=False)
    file_content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    file_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    llm_model: Mapped[str] = mapped_column(String(100), default="gpt-4o", nullable=False)
    control_objective: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    results: Mapped[dict[str, Any] | None] = mapped_column(JsonDict, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    owner: Mapped[User] = relationship("User", back_populates="projects")


class FeedbackSurveyResponse(Base):
    """Post-use feedback survey answers — any number per user per pipeline (SILO / MULO)."""

    __tablename__ = "feedback_survey_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pipeline_type: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        index=True,
    )
    satisfaction: Mapped[int] = mapped_column(Integer, nullable=False)
    ease_of_use: Mapped[int] = mapped_column(Integer, nullable=False)
    product_value: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[int] = mapped_column(Integer, nullable=False)
    reuse_intention: Mapped[int] = mapped_column(Integer, nullable=False)
    willingness_to_pay: Mapped[int] = mapped_column(Integer, nullable=False)
    main_problems: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped[User] = relationship("User", back_populates="feedback_surveys")


class TutorialVideo(Base):
    """Admin-managed how-to video clip shown in the first-login slider."""

    __tablename__ = "tutorial_videos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class NavMenuItem(Base):
    """Header/footer navigation link managed from the site CMS."""

    __tablename__ = "nav_menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    href: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_external: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class BlogPost(Base):
    """Markdown blog article managed from the admin CMS."""

    __tablename__ = "blog_posts"
    __table_args__ = (UniqueConstraint("slug", name="uq_blog_posts_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cover_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class BugReport(Base):
    """User-submitted bug report with optional screenshot."""

    __tablename__ = "bug_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False, index=True)
    admin_notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User | None] = relationship("User", back_populates="bug_reports")


class LoginHistory(Base):
    """Record of a login attempt (success or failure)."""

    __tablename__ = "login_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
