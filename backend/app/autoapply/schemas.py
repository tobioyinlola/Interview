"""Request and response shapes for the Auto-Apply routes."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProfileIn(BaseModel):
    criteria: dict[str, Any] | None = None
    timezone: str | None = Field(default=None, max_length=64)
    active_hours: dict[str, int] | None = None
    channels: dict[str, bool] | None = None
    daily_application_cap: int | None = None
    daily_outreach_cap: int | None = None


class ProfileOut(BaseModel):
    criteria: dict[str, Any]
    timezone: str
    active_hours: dict[str, int]
    channels: dict[str, bool]
    daily_application_cap: int
    daily_outreach_cap: int
    paused: bool
    version: int


class FactsIn(BaseModel):
    data: dict[str, Any]
    verified: bool = False  # true only when the person has checked it and says it is right


class FactsOut(BaseModel):
    data: dict[str, Any]
    version: int
    verified_at: datetime | None
    from_model: bool = True  # false: only patterns read the CV, so more needs checking
    cv_changed: bool = False  # the CV changed after these facts were confirmed


class AnswerIn(BaseModel):
    question: str = Field(default="", max_length=300)
    value: str = Field(min_length=1, max_length=2000)
    reusable: bool = False  # saved for reuse only when the person approves it


class AnswerOut(BaseModel):
    field: str
    question: str
    value: str
    provenance: str
    reusable: bool
    confirmed_at: datetime | None
    version: int


class EnableIn(BaseModel):
    policy_version: str = Field(max_length=20)
    accept: bool  # the explicit confirmation


class Disclosure(BaseModel):
    policy_version: str
    shared: list[str]
    channels: dict[str, bool]
    daily_application_cap: int
    daily_outreach_cap: int
    mailbox: str | None
    problems: list[str]  # what is still missing before it can be switched on


class CampaignOut(BaseModel):
    state: str  # none | active | paused | ended
    day: int | None = None
    days_total: int | None = None
    activated_at: datetime | None = None
    ends_at: datetime | None = None
    timezone: str | None = None


class StatusOut(BaseModel):
    enabled: bool
    campaign: CampaignOut
