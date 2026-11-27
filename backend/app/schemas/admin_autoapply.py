from datetime import datetime

from pydantic import BaseModel, Field


class SwitchOut(BaseModel):
    name: str
    on: bool
    reason: str
    set_at: datetime | None = None


class SwitchIn(BaseModel):
    on: bool
    reason: str = Field(default="", max_length=300)


class UnresolvedRow(BaseModel):
    application_id: str
    person: str
    company: str
    title: str
    channel: str
    state: str
    age_hours: float


class ExecutorRow(BaseModel):
    """What each place that carries out applications did in the last 7 days. The desktop costs the
    platform nothing; the cloud row is the one worker's browser time."""

    executor: str  # cloud | desktop
    channel: str
    attempts: int
    confirmed: int
    ambiguous: int
    failed: int
    avg_seconds: float | None  # claim to result
    total_minutes: float  # time spent carrying them out


class AutoApplyAdminOut(BaseModel):
    enabled: bool
    dispatch: dict[str, bool]  # which real channels the server allows
    provider: str
    campaigns_active: int
    campaigns_paused: int
    campaigns_started: int
    campaigns_ended: int
    applications_by_status: dict[str, int]
    applications_sent: int
    interviews: int
    invitations_per_100: (
        float | None
    )  # of applications sent 30-60 days ago; None until there are any
    cohort_size: int
    hours_to_first_application: float | None
    attempts_unresolved: int
    attempts_failed: int
    executors: list[ExecutorRow] = []
    unresolved: list[UnresolvedRow]
    mailboxes: dict[str, int]
    discovery_runs: dict[str, int]
    events_needing_review: int
    switches: list[SwitchOut]
