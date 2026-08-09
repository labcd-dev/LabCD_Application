"""Pydantic schemas for admin product analytics."""

from typing import List, Optional

from pydantic import BaseModel, Field


class AnalyticsSeriesPoint(BaseModel):
    date: str
    count: int


class AnalyticsModuleCount(BaseModel):
    module: str
    count: int


class AnalyticsResponse(BaseModel):
    days: int
    dau_today: int
    mau: int
    retention_d7: float | None = None
    retention_d30: float | None = None
    dau_series: List[AnalyticsSeriesPoint] = Field(default_factory=list)
    mau_series: List[AnalyticsSeriesPoint] = Field(default_factory=list)
    modules: List[AnalyticsModuleCount] = Field(default_factory=list)


class TelegramAnalyticsSettings(BaseModel):
    enabled: bool = False
    chat_id: str = ""
    send_hour_utc: int = Field(default=8, ge=0, le=23)
    bot_token_configured: bool = False
    bot_token_masked: str = ""
    last_sent_date: Optional[str] = None


class TelegramAnalyticsSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    chat_id: Optional[str] = None
    send_hour_utc: Optional[int] = Field(default=None, ge=0, le=23)
    # Write-only: omit to leave unchanged; empty string clears the token.
    bot_token: Optional[str] = None


class TelegramAnalyticsTestResult(BaseModel):
    ok: bool
    detail: str
