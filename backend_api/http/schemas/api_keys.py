"""Pydantic schemas for admin API key management."""

from pydantic import BaseModel, Field


class ApiKeyStatusOut(BaseModel):
    name: str
    configured: bool
    masked_value: str = ""


class ApiKeysOut(BaseModel):
    keys: list[ApiKeyStatusOut]


class ApiKeysUpdate(BaseModel):
    """Omitted fields are unchanged; empty string clears the key."""

    OPENAI_API_KEY: str | None = Field(default=None)
    NVIDIA_API_KEY: str | None = Field(default=None)
    GROQ_API_KEY: str | None = Field(default=None)
    CEREBRAS_API_KEY: str | None = Field(default=None)
    TAVILY_API_KEY: str | None = Field(default=None)
