"""What the admin console reads. Counts, rates and plain facts about accounts and activity; never a
CV, a transcript or an answer."""

from pydantic import BaseModel, Field


class Kpi(BaseModel):
    label: str
    value: float
    hint: str = ""


class SeriesPoint(BaseModel):
    day: str
    signups: int = 0
    sessions: int = 0
    active_users: int = 0


class FunnelStep(BaseModel):
    key: str
    label: str
    users: int
    of_signups_pct: float  # share of the people who signed up
    from_previous_pct: float | None  # share of the step before it


class HealthCounts(BaseModel):
    research_failed_24h: int
    scoring_failed_24h: int
    emails_failed_24h: int
    blocked_no_credit_7d: int
    wrong_passwords_24h: int


class OverviewOut(BaseModel):
    days: int
    total_users: int
    new_users: int  # in the window
    new_users_prev: int  # in the window before it, for the trend
    dau: int
    wau: int
    mau: int
    sessions: int  # in the window
    sessions_prev: int
    avg_session_seconds: int | None
    avg_questions_per_session: float | None
    funnel: list[FunnelStep]
    series: list[SeriesPoint]
    health: HealthCounts
    referrals_counted: int
    referrals_held: int
    rewards_redeemed: int


class UserRow(BaseModel):
    id: str
    email: str
    full_name: str | None
    created_at: str
    last_active_at: str | None
    sessions: int
    companies: int
    has_cv: bool
    onboarded: bool
    credits_available: int
    referrals_counted: int
    referrals_held: int
    signup_method: str | None
    utm_source: str | None
    referred: bool
    is_admin: bool


class UserListOut(BaseModel):
    total: int
    items: list[UserRow]


class TimelineItem(BaseModel):
    id: str
    at: str
    kind: str
    category: str
    label: str
    detail: str


class CreditBreakdown(BaseModel):
    trial: int
    gifted: int
    referral: int
    paid: int
    used: int


class UserDetailOut(BaseModel):
    user: UserRow
    credits: CreditBreakdown
    referral_code: str | None
    referred_by: str | None  # the inviter's email
    invited: int
    held: int
    emails_sent: int
    emails_failed: int
    onboarding: dict[str, object] | None
    attribution: dict[str, object] | None
    timeline: list[TimelineItem]


class GrantIn(BaseModel):
    count: int = Field(ge=1, le=10)
    reason: str | None = Field(default=None, max_length=200)
    notify: bool = True


class ActivityItem(BaseModel):
    id: str
    at: str
    kind: str
    category: str
    label: str
    user_id: str | None
    user_email: str | None
    actor_email: str | None
    detail: str


class ActivityOut(BaseModel):
    items: list[ActivityItem]
    next_before: str | None
    categories: dict[str, list[str]]  # category -> kinds, for the filter


class ReferrerRow(BaseModel):
    user_id: str
    email: str
    counted: int
    held: int
    rewards_earned: int
    rewards_redeemed: int


class HeldRow(BaseModel):
    id: str
    at: str
    referrer_email: str
    referred_email: str
    reason: str | None


class ReferralsOut(BaseModel):
    total: int
    counted: int
    held: int
    rewards_earned: int
    rewards_redeemed: int
    referred_signups_pct: float  # of all sign-ups in the window
    top_referrers: list[ReferrerRow]
    held_items: list[HeldRow]
    per_reward: int


class ChannelRow(BaseModel):
    channel: str
    signups: int
    activated: int  # ran at least one interview
    activation_pct: float
    second_session: int


class MarketingOut(BaseModel):
    days: int
    signups: int
    by_method: list[ChannelRow]
    by_source: list[ChannelRow]  # utm_source, plus "referral" and "direct"
    by_campaign: list[ChannelRow]
    referred_pct: float
    k_factor: float  # referred sign-ups per sign-up
    median_hours_to_first_session: float | None
    trial_used_users: int
    hit_paywall_users: int
    second_session_users: int
    redeemed_rewards: int


class LatencyOut(BaseModel):
    p50_first_token_ms: int | None
    p95_first_token_ms: int | None
    p50_total_ms: int | None
    p95_total_ms: int | None


class QualityOut(BaseModel):
    days: int
    answers: int
    rated: int
    helpful_pct: float | None
    flagged_pct: float | None  # answers where a number was not in the CV, the brief or the question
    latency: LatencyOut
    by_type: dict[str, int]
    avg_scores: dict[str, float]
    research_jobs: int
    research_failed_pct: float | None
    scoring_runs: int
    scoring_failed_pct: float | None


class EmailKindRow(BaseModel):
    kind: str
    sent_7d: int
    failed_7d: int
    sent_30d: int
    failed_30d: int


class EmailLogItem(BaseModel):
    id: str
    at: str
    kind: str
    to: str
    status: str  # sent | failed
    user_id: str | None


class EmailsOut(BaseModel):
    kinds: list[EmailKindRow]
    items: list[EmailLogItem]


class TemplateInfo(BaseModel):
    kind: str
    title: str
    when: str  # what triggers it
    audience: str


class TemplatePreview(BaseModel):
    kind: str
    subject: str
    html: str
    text: str
