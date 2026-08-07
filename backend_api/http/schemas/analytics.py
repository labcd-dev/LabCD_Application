"""Pydantic schemas for admin product analytics."""

from typing import List

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
