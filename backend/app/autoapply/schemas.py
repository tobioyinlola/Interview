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


class PostingOut(BaseModel):
    id: str
    company: str
    title: str
    region: str | None
    arrangement: str | None
    application_url: str | None
    source: str


class ApplicationOut(BaseModel):
    id: str
    status: str
    channel: str | None
    posting: PostingOut
    score: float
    needs_input: list[dict[str, Any]]
    skip_reason: str | None
    recruiting_stage: str | None
    created_at: datetime
    updated_at: datetime


class ApplicationEventOut(BaseModel):
    kind: str
    detail: dict[str, Any]
    created_at: datetime


class ApplicationDetail(ApplicationOut):
    match: dict[str, Any]
    package: dict[str, Any] | None  # the exact package: what was or will be sent
    package_frozen_at: datetime | None
    history: list[ApplicationEventOut]


class ApplicationPage(BaseModel):
    items: list[ApplicationOut]
    next_cursor: str | None


class AnswerApplicationIn(BaseModel):
    field: str = Field(min_length=1, max_length=60)
    value: str = Field(min_length=1, max_length=2000)
    save_for_reuse: bool = False  # saved as a reusable answer only when the person ticks this


class ApproveIn(BaseModel):
    rule: str = Field(min_length=1, max_length=60)


class JobUrlIn(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class RunOut(BaseModel):
    local_day: str
    status: str
    found: int
    new: int
    eligible: int
    needs_input: int
    skipped: int
    error: str | None
    started_at: datetime
    finished_at: datetime | None
