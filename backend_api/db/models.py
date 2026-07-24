"""ORM models for authentication, permissions, and projects."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from backend_api.db.base import Base

user_actions = Table(
    "user_actions",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("action_id", ForeignKey("actions.id", ondelete="CASCADE"), primary_key=True),
)

# JSONB on PostgreSQL; plain JSON elsewhere (e.g. local SQLite tests).
JsonDict = JSON().with_variant(JSONB(), "postgresql")


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    actions: Mapped[list[Action]] = relationship(
        "Action",
        secondary=user_actions,
        back_populates="users",
        lazy="selectin",
    )
    projects: Mapped[list[Project]] = relationship(
        "Project",
        back_populates="owner",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    def action_codes(self) -> list[str]:
        return sorted(action.code for action in self.actions)

    def has_action(self, code: str) -> bool:
        if self.is_admin:
            return True
        return any(action.code == code for action in self.actions)


class Action(Base):
    __tablename__ = "actions"
    __table_args__ = (UniqueConstraint("code", name="uq_actions_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)

    users: Mapped[list[User]] = relationship(
        "User",
        secondary=user_actions,
        back_populates="actions",
        lazy="selectin",
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
