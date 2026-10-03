"""Pydantic schemas for site branding, landing CMS, and nav menus."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SiteBrand(BaseModel):
    brand_name: str = "LabCD"
    tagline: str = "Lab of Control Design"
    logo_url: str = ""
    primary_color: str = "#22d3ee"
    secondary_color: str = "#2563eb"
    sign_in_url: str = "https://chat.labcd.ai"
    access_platform_url: str = "https://chat.labcd.ai"
    page_title: str = "AI Control Design Platform - Lab of Control Design"
    # Plant Agent empty-state hero (Design / AgentPlantChat). Empty url + enabled
    # uses the packaged default under /assets/plant-agent-hero.png.
    plant_agent_hero_image_url: str = ""
    plant_agent_hero_enabled: bool = True


class NavMenuItemOut(BaseModel):
    id: int
    location: str
    label: str
    href: str
    sort_order: int
    is_external: bool

    model_config = {"from_attributes": True}


class NavMenuItemCreate(BaseModel):
    location: str = Field(..., min_length=1, max_length=40)
    label: str = Field(..., min_length=1, max_length=120)
    href: str = Field(..., min_length=1, max_length=512)
    sort_order: int = 0
    is_external: bool = False


class NavMenuItemUpdate(BaseModel):
    location: str | None = Field(None, min_length=1, max_length=40)
    label: str | None = Field(None, min_length=1, max_length=120)
    href: str | None = Field(None, min_length=1, max_length=512)
    sort_order: int | None = None
    is_external: bool | None = None


class LandingPayload(BaseModel):
    brand: SiteBrand
    menus: dict[str, list[NavMenuItemOut]]
    landing: dict[str, Any]
