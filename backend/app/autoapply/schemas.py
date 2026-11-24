"""Request and response shapes for the Auto-Apply routes."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SearchProfileIn(BaseModel):
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
    demo: bool = False
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
    attempts: list["AttemptOut"] = []
    outreach: "OutreachOut | None" = None
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


class MailboxOut(BaseModel):
    connected: bool
    provider: str | None = None
    address: str | None = None
    status: str | None = None  # connected | reauth_needed | disconnected
    last_synced_at: datetime | None = None
    can_connect: bool = True


class ConnectOut(BaseModel):
    connected: bool
    url: str | None = None  # where to send the browser to approve access


class AttemptOut(BaseModel):
    channel: str
    state: str
    provider_ref: str | None
    failure_message: str | None
    claimed_at: datetime
    finished_at: datetime | None


class OutreachIn(BaseModel):
    recipient: str = Field(min_length=3, max_length=320)


class OutreachOut(BaseModel):
    id: str
    application_id: str | None
    company: str
    title: str
    recipient: str
    recipient_source: str
    subject: str
    body: str
    status: str
    reason: str | None
    sent_at: datetime | None


class ResolveIn(BaseModel):
    sent: bool  # true: it did go through; false: it did not, so it may be sent again


class InterviewOut(BaseModel):
    id: str
    application_id: str
    company: str
    title: str
    round: int
    status: str  # invited | scheduled | cancelled | completed
    scheduling_url: str | None
    meeting_url: str | None
    scheduled_at: datetime | None
    time_zone_unclear: bool
    company_id: str | None
    last_event_id: str | None  # the message to confirm a time zone against
    action: str | None  # book | prepare | confirm_time
    history: list[dict[str, Any]]


class CandidateApp(BaseModel):
    id: str
    company: str
    title: str


class RecruitingOut(BaseModel):
    id: str
    kind: str
    status: str
    received_at: datetime
    sender: str
    subject: str
    matched_by: str | None
    application_id: str | None
    candidates: list[CandidateApp]
    scheduled_at: datetime | None
    time_zone_unclear: bool
    links: dict[str, str]


class LinkEventIn(BaseModel):
    application_id: str


class ConfirmTimeIn(BaseModel):
    timezone: str = Field(max_length=64)


class PrepareOut(BaseModel):
    interview_id: str
    company_id: str
    session_url: str
    research_started: bool


class UsageOut(BaseModel):
    applications_used: int
    applications_cap: int
    outreach_used: int
    outreach_cap: int


class PrimaryAction(BaseModel):
    kind: str
    label: str
    href: str | None = None
    application_id: str | None = None
    interview_id: str | None = None


class StartupSentOut(BaseModel):
    """A pitch sent to a startup, shown beside the job applications in one activity list."""

    id: str
    company: str
    to_name: str = ""  # the person it was written to, when the site named one
    status: str  # sent | replied | declined
    subject: str = ""
    sent_at: datetime | None = None


class DashboardOut(BaseModel):
    demo: bool  # sample jobs and simulated sending only: nothing reaches a real employer
    sources: list[str] = []  # where jobs are looked for, as readable names
    state: str
    primary: PrimaryAction
    campaign: CampaignOut
    paused: bool
    mailbox: MailboxOut
    channels: dict[str, bool]
    last_run: RunOut | None
    usage: UsageOut | None
    next_interview: InterviewOut | None
    open_invites: list[InterviewOut]
    needs_input: list[ApplicationOut]
    recent: list[ApplicationOut]
    counts: dict[str, int]
    review_count: int
    startups: dict[str, int] | None = None  # startup outreach, when it is switched on
    startup_recent: list[StartupSentOut] = []  # the latest pitches that went out
