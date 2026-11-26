"""What the back office reads about how people use the app, from the app's own usage statistics.
Counts, times and rates only; no event here can hold anyone's words (see services/analytics.py)."""

from datetime import datetime

from pydantic import BaseModel


class EngagementPoint(BaseModel):
    day: str
    users: int  # signed-in people active that day
    devices: int
    sessions: int
    engaged_minutes: int


class SplitRow(BaseModel):
    key: str  # platform or form factor
    devices: int
    users: int
    sessions: int
    engaged_minutes: int
    share_pct: float  # of all sessions


class VersionRow(BaseModel):
    platform: str
    app_version: str
    devices: int


class ScreenRow(BaseModel):
    route: str
    views: int
    people: int
    avg_seconds: int | None  # time really spent there, per visit


class FeatureRow(BaseModel):
    key: str
    kind: str  # interaction | feature
    uses: int
    people: int


class ErrorRow(BaseModel):
    kind: str
    route: str | None
    count: int
    devices: int
    last_seen: datetime


class LoadRow(BaseModel):
    platform: str
    p50_ms: int
    p95_ms: int
    samples: int


class RetentionRow(BaseModel):
    day: int  # days after signing up
    cohort: int  # people who signed up at least that long ago (within what is kept)
    returned: int
    pct: float | None


class EngagementOut(BaseModel):
    days: int
    has_data: bool
    data_since: datetime | None
    people: int  # signed-in people active in the window
    people_prev: int
    devices: int
    sessions: int
    sessions_prev: int
    dau: int
    wau: int
    mau: int
    stickiness_pct: float | None
    median_session_seconds: int | None
    screens_per_session: float | None
    engaged_minutes_per_person: float | None
    error_session_pct: float | None  # sessions that hit an interface error
    offline_session_pct: float | None
    series: list[EngagementPoint]
    platforms: list[SplitRow]
    form_factors: list[SplitRow]
    versions: list[VersionRow]
    screens: list[ScreenRow]
    features: list[FeatureRow]
    errors: list[ErrorRow]
    load: list[LoadRow]
    retention: list[RetentionRow]
