"""Startup outreach: a candidate's settings and notes to review, and the operator's tools for
loading accelerator directories. The flag STARTUP_OUTREACH_ENABLED turns it all off (404)."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.interfaces import LlmProvider
from app.autoapply import facts as facts_mod
from app.autoapply import mailbox
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_notifier, require_admin
from app.errors import ApiError
from app.hunt import directory, engine, policy, research, template
from app.models import (
    Directory,
    HuntSettings,
    HuntTarget,
    SearchProfile,
    Startup,
    StartupContact,
    User,
)
from app.routers.autoapply import get_llm, get_now
from app.services.events import record_from
from app.services.fetcher import Fetcher
from app.services.notify import Notifier


def feature_on(settings: Settings = Depends(get_settings)) -> None:  # noqa: B008
    if not settings.startup_outreach_enabled:
        raise ApiError(404, "not_found", "Not found.")


router = APIRouter(prefix="/api/hunt", tags=["hunt"], dependencies=[Depends(feature_on)])


async def active_user(user: User = Depends(current_user)) -> User:  # noqa: B008
    """Startup outreach is by invitation: only people the operator switched it on for."""
    if user.outreach_access != "active":
        raise ApiError(
            403, "outreach_not_active", "Startup outreach is not switched on for your account."
        )
    return user


class AccessOut(BaseModel):
    access: str  # none | requested | active


@router.get("/access")
async def my_access(user: User = Depends(current_user)) -> AccessOut:  # noqa: B008
    return AccessOut(access=user.outreach_access)


class ReachOut(BaseModel):
    companies: int  # startups in the places we write to (US, Europe, UK) whose sites could be read
    label: str  # "over 1,000": the number said the way a headline can honestly say it


def reach_label(n: int) -> str:
    """A count as a headline can honestly state it: never rounded up."""
    if n >= 1000:
        return f"over {n // 1000 * 1000:,}"
    if n >= 100:
        return f"over {n // 100 * 100:,}"
    if n >= 10:
        return f"{n // 10 * 10}+"
    return str(n)


@router.get("/reach")
async def reach(
    _: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> ReachOut:
    """How many startups outreach can write to, so the page can say so truthfully. Open to anyone
    signed in, invited or not."""
    n = (
        await db.execute(
            select(func.count())
            .select_from(Startup)
            .where(Startup.region.in_(policy.REGIONS), Startup.status != "dead")
        )
    ).scalar_one()
    return ReachOut(companies=n, label=reach_label(n))


@router.post("/access/request")
async def request_access(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> AccessOut:
    """Ask to be let in. Asking again changes nothing."""
    if user.outreach_access == "none":
        user.outreach_access, user.outreach_requested_at = "requested", now
        await db.commit()
        await record_from(db, "outreach.requested", user_id=user.id)
    return AccessOut(access=user.outreach_access)


class SettingsIn(BaseModel):
    enabled: bool
    regions: list[str] = Field(default_factory=list, max_length=3)
    roles: list[str] = Field(default_factory=list, max_length=5)
    pitch: str = Field("", max_length=1200)
    daily_cap: int = Field(8, ge=1, le=engine.MAX_DAILY)
    auto_send: bool = False
    sender_name: str = Field("", max_length=120)
    postal_address: str = Field("", max_length=300)


class SettingsOut(SettingsIn):
    mailbox: str | None
    ready: list[str]  # what is still missing before a note can go out
    prefilled: bool = False  # roles and name were taken from the Auto-Apply search and CV
    paused: bool = False  # Auto-Apply is paused, so this is too


class OpeningOut(BaseModel):
    title: str
    url: str


class EditIn(BaseModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=4000)


class TargetOut(BaseModel):
    id: uuid.UUID
    startup: str
    website: str
    one_liner: str
    region: str
    contact: str
    contact_kind: str
    contact_source: str
    careers_url: str | None
    openings: list[OpeningOut]
    fit: int
    fit_reasons: list[str]
    step: int
    subject: str
    body: str
    status: str
    reason: str | None
    sent_at: datetime | None


class StartupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    website: str = Field(min_length=3, max_length=500)
    one_liner: str = Field("", max_length=500)
    country: str = Field("", max_length=80)
    batch: str = Field("", max_length=60)
    sector: str = Field("", max_length=120)


async def _ready(
    db: AsyncSession, st: HuntSettings | None, user_id: uuid.UUID, footer: bool = False
) -> list[str]:
    missing = []
    if await mailbox.connected_address(db, user_id) is None:
        missing.append("Connect your email")
    if st is None or not st.roles:
        missing.append("Say what role you want")
    if st is None or not st.regions:
        missing.append("Choose a region")
    if st is None or not st.sender_name.strip():
        missing.append("Add the name to sign with")
    if footer and (st is None or not st.postal_address.strip()):
        missing.append("Add a postal address (required on commercial email)")
    return missing


async def _suggestions(db: AsyncSession, user_id: uuid.UUID) -> tuple[list[str], str]:
    """What the candidate already told Auto-Apply: the roles they search for and their name."""
    prof = (
        await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
    ).scalar_one_or_none()
    roles = [
        str(r.get("value", "")).strip()
        for r in ((prof.criteria or {}).get("roles") or [] if prof else [])
        if isinstance(r, dict) and str(r.get("value", "")).strip()
    ]
    row = await facts_mod.get(db, user_id)
    name = str(((row.data if row else {}) or {}).get("contact", {}).get("name", "")).strip()
    return roles[:5], name


async def _out(db: AsyncSession, user_id: uuid.UUID, footer: bool = False) -> SettingsOut:
    st = await engine.get_settings(db, user_id)
    roles = list(st.roles) if st else []
    name = st.sender_name if st else ""
    prefilled = False
    if not roles or not name:
        s_roles, s_name = await _suggestions(db, user_id)
        prefilled = (not roles and bool(s_roles)) or (not name and bool(s_name))
        roles, name = roles or s_roles, name or s_name
    return SettingsOut(
        enabled=bool(st and st.enabled),
        regions=list(st.regions) if st else [],
        roles=roles,
        pitch=st.pitch if st else "",
        daily_cap=st.daily_cap if st else 8,
        auto_send=bool(st and st.auto_send),
        sender_name=name,
        postal_address=st.postal_address if st else "",
        mailbox=await mailbox.connected_address(db, user_id),
        ready=await _ready(db, st, user_id, footer),
        prefilled=prefilled,
        paused=await engine.paused(db, user_id),
    )


@router.get("/settings")
async def read_settings(
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    config: Settings = Depends(get_settings),  # noqa: B008
) -> SettingsOut:
    return await _out(db, user.id, config.startup_outreach_footer)


@router.put("/settings")
async def save_settings(
    body: SettingsIn,
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    config: Settings = Depends(get_settings),  # noqa: B008
) -> SettingsOut:
    footer = config.startup_outreach_footer
    if any(r not in policy.REGIONS for r in body.regions):
        raise ApiError(422, "invalid_region", "Regions can be us, eu or uk.")
    st = await engine.get_settings(db, user.id)
    if st is None:
        st = HuntSettings(id=uuid.uuid4(), user_id=user.id)
        db.add(st)
    roles = [r.strip()[:120] for r in body.roles if r.strip()]
    if body.enabled and await _ready(db, st, user.id, footer):
        # turning on needs everything in place, judged against what is being saved
        st.sender_name, st.postal_address = body.sender_name, body.postal_address
        st.roles, st.regions = roles, body.regions
        missing = await _ready(db, st, user.id, footer)
        if missing:
            await db.rollback()
            raise ApiError(409, "not_ready", "Not ready yet: " + "; ".join(missing) + ".")
    st.enabled, st.regions, st.roles = body.enabled, body.regions, roles
    st.pitch, st.daily_cap, st.auto_send = body.pitch.strip(), body.daily_cap, body.auto_send
    st.sender_name, st.postal_address = body.sender_name.strip(), body.postal_address.strip()
    st.updated_at = now
    await db.commit()
    return await _out(db, user.id, footer)


# ------------------------------------------------------------------ the candidate's own emails


class TemplateIn(BaseModel):
    use_template: bool = False
    first_subject: str = Field("", max_length=300)
    first_body: str = Field("", max_length=template.MAX_TEXT)
    follow_subject: str = Field("", max_length=300)
    follow_body: str = Field("", max_length=template.MAX_TEXT)
    variables: dict[str, str] = Field(default_factory=dict, max_length=30)
    follow_up_enabled: bool = True
    follow_up_days: int = Field(5, ge=1, le=30)
    send_not_before: datetime | None = None
    window_start: int = Field(8, ge=0, le=23)
    window_end: int = Field(18, ge=1, le=24)


class TemplateOut(TemplateIn):
    builtin: dict[str, str]  # variables everyone has, and what they hold
    starter: dict[str, str]  # a generic starting point to copy from
    unknown: list[str]  # variables the emails use that have no value yet
    redrafted: int = 0  # notes waiting for review that were written again from these emails


class PreviewIn(BaseModel):
    which: str = Field("first", pattern="^(first|follow)$")
    # an unsaved edit can be previewed: send it and it is used instead of the saved one
    subject: str | None = Field(None, max_length=300)
    body: str | None = Field(None, max_length=template.MAX_TEXT)
    variables: dict[str, str] | None = None


class PreviewOut(BaseModel):
    subject: str
    body: str
    company: str
    missing: list[str]  # variables with no value: the email would be held until they are filled


def _template_out(st: HuntSettings | None) -> TemplateOut:
    t = (st.template if st else None) or {}
    variables = template.clean_variables((st.variables if st else None) or {})
    names: list[str] = []
    for k in ("first_subject", "first_body", "follow_subject", "follow_body"):
        for n in template.used(str(t.get(k) or "")):
            if n not in names:
                names.append(n)
    return TemplateOut(
        use_template=bool(st and st.use_template),
        first_subject=str(t.get("first_subject") or ""),
        first_body=str(t.get("first_body") or ""),
        follow_subject=str(t.get("follow_subject") or ""),
        follow_body=str(t.get("follow_body") or ""),
        variables=variables,
        follow_up_enabled=bool(st.follow_up_enabled) if st else True,
        follow_up_days=st.follow_up_days if st else 5,
        send_not_before=st.send_not_before if st else None,
        window_start=st.window_start if st else 8,
        window_end=st.window_end if st else 18,
        builtin=template.BUILTIN,
        starter=template.STARTER,
        unknown=[n for n in names if n not in template.BUILTIN and n not in variables],
    )


@router.get("/template")
async def read_template(
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TemplateOut:
    return _template_out(await engine.get_settings(db, user.id))


@router.put("/template")
async def save_template(
    body: TemplateIn,
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    config: Settings = Depends(get_settings),  # noqa: B008
) -> TemplateOut:
    if body.window_end <= body.window_start:
        raise ApiError(422, "bad_window", "The end hour must be after the start hour.")
    if body.use_template and not body.first_body.strip():
        raise ApiError(422, "no_first_email", "Write the first email before turning this on.")
    st = await engine.get_settings(db, user.id)
    if st is None:
        st = HuntSettings(id=uuid.uuid4(), user_id=user.id)
        db.add(st)
    st.use_template = body.use_template
    st.template = {
        "first_subject": " ".join(body.first_subject.split()),
        "first_body": body.first_body.strip(),
        "follow_subject": " ".join(body.follow_subject.split()),
        "follow_body": body.follow_body.strip(),
    }
    st.variables = template.clean_variables(body.variables)
    st.follow_up_enabled, st.follow_up_days = body.follow_up_enabled, body.follow_up_days
    st.send_not_before = body.send_not_before
    st.window_start, st.window_end = body.window_start, body.window_end
    st.updated_at = now
    await db.commit()
    # what is waiting for review is written again from the saved emails
    out = _template_out(st)
    out.redrafted = await engine.redraft(db, user.id, llm, footer=config.startup_outreach_footer)
    return out


@router.post("/template/preview")
async def preview_template(
    body: PreviewIn,
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> PreviewOut:
    """What the email would look like for a real researched startup (or a made-up one when none is
    researched yet), with the candidate's details filled in. Nothing is sent or saved."""
    st = await engine.get_settings(db, user.id) or HuntSettings(user_id=user.id)
    sample = (
        await db.execute(
            select(Startup).where(Startup.status == "researched").order_by(Startup.created_at)
        )
    ).scalars().first() or Startup(
        name="Acme", domain="acme.example", website="https://acme.example", one_liner=""
    )
    contact = StartupContact(email="hello@acme.example", name="Sam Rivera", kind="person",
                             source_url=sample.website)  # fmt: skip
    t = dict(st.template or {})
    if body.subject is not None:
        t[f"{body.which}_subject"] = body.subject
    if body.body is not None:
        t[f"{body.which}_body"] = body.body
    shown = HuntSettings(
        template=t,
        variables=body.variables if body.variables is not None else (st.variables or {}),
        roles=st.roles or [],
        sender_name=st.sender_name or "",
        postal_address=st.postal_address or "",
    )
    hook = (sample.one_liner or "").strip().rstrip(".")
    sample_hook = (
        f"What {sample.name} is building ({hook[0].lower() + hook[1:]}) is close to my work."
        if hook
        else ""
    )
    subject, text, missing = template.compose(
        shown, sample, contact, body.which, sample_hook, first_subject="(your first subject)"
    )
    return PreviewOut(subject=subject, body=text, company=sample.name, missing=missing)


async def _target_out(db: AsyncSession, t: HuntTarget) -> TargetOut:
    s = await db.get(Startup, t.startup_id)
    c = await db.get(StartupContact, t.contact_id)
    assert s is not None and c is not None
    return TargetOut(
        id=t.id,
        startup=s.name,
        website=s.website,
        one_liner=s.one_liner,
        region=s.region,
        contact=c.email,
        contact_kind=c.kind,
        contact_source=c.source_url,
        careers_url=(s.research or {}).get("careers_url"),
        openings=[OpeningOut(**o) for o in (t.openings or []) if isinstance(o, dict)],
        fit=t.fit,
        fit_reasons=list(t.fit_reasons or []),
        step=t.step,
        subject=t.subject,
        body=t.body,
        status=t.status,
        reason=t.reason,
        sent_at=t.sent_at,
    )


class BlockerOut(BaseModel):
    code: str
    text: str
    where: str = ""  # setup | email: the page that fixes it


class DeliveryOut(BaseModel):
    approved: int  # notes you approved that have not gone out yet
    blockers: list[BlockerOut]  # why none is going out now; empty when the next pass sends


@router.get("/delivery")
async def delivery(
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> DeliveryOut:
    """Why approved notes are waiting, in words, so a note is never held back in silence. Uses the
    same mailbox adapter and gates the sender does."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.autoapply import mailboxes

    assert db.bind is not None
    maker = async_sessionmaker(db.bind, expire_on_commit=False)
    res = await engine.delivery_blockers(maker, user.id, mailboxes.build(settings), settings, now)
    return DeliveryOut(**res)


@router.get("/targets")
async def targets(
    status: str | None = Query(None, max_length=10),
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> list[TargetOut]:
    q = select(HuntTarget).where(HuntTarget.user_id == user.id)
    if status:
        q = q.where(HuntTarget.status == status)
    rows = (await db.execute(q.order_by(HuntTarget.created_at.desc()).limit(200))).scalars().all()
    return [await _target_out(db, t) for t in rows]


@router.get("/summary")
async def summary(
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> dict[str, int]:
    rows = (
        await db.execute(
            select(HuntTarget.status, func.count())
            .where(HuntTarget.user_id == user.id)
            .group_by(HuntTarget.status)
        )
    ).all()
    return {k: v for k, v in rows}


async def _mine(db: AsyncSession, user_id: uuid.UUID, tid: uuid.UUID) -> HuntTarget:
    t = await db.get(HuntTarget, tid)
    if t is None or t.user_id != user_id:
        raise ApiError(404, "not_found", "Not found.")
    return t


@router.put("/targets/{tid}")
async def edit_target(
    tid: uuid.UUID,
    body: EditIn,
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TargetOut:
    t = await _mine(db, user.id, tid)
    if t.status != "drafted":
        raise ApiError(409, "locked", "Only a note that has not been approved can be edited.")
    # a subject is one line: a line break in a header is how mail gets forged
    t.subject, t.body = " ".join(body.subject.split()), body.body.strip()
    await db.commit()
    return await _target_out(db, t)


@router.post("/targets/{tid}/approve")
async def approve(
    tid: uuid.UUID,
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TargetOut:
    t = await _mine(db, user.id, tid)
    if t.status != "drafted":
        raise ApiError(409, "locked", "That note is not waiting for approval.")
    if template.has_placeholder(t.subject) or template.has_placeholder(t.body):
        raise ApiError(
            409, "unfilled", "Fill in the {{variables}} in this note first, then approve it."
        )
    t.status = "approved"
    await db.commit()
    return await _target_out(db, t)


@router.post("/targets/{tid}/skip")
async def skip(
    tid: uuid.UUID,
    user: User = Depends(active_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> TargetOut:
    t = await _mine(db, user.id, tid)
    if t.status not in ("drafted", "approved"):
        raise ApiError(409, "locked", "That note has already gone or been closed.")
    t.status, t.reason = "skipped", "You chose not to send it."
    await db.commit()
    return await _target_out(db, t)


# --------------------------------------------------------------------- operator tools


# The back office's staff session is only sent to /api/admin, so the operator tools live there.
admin_router = APIRouter(
    prefix="/api/admin/startups", tags=["admin"], dependencies=[Depends(feature_on)]
)


class DirectoryOut(BaseModel):
    id: uuid.UUID
    name: str
    url: str
    region_hint: str
    enabled: bool
    builtin: bool
    last_run_at: datetime | None
    last_found: int
    last_added: int
    last_problem: str | None


class AdminOverviewOut(BaseModel):
    startups: int
    by_status: dict[str, int]
    by_region: dict[str, int]
    with_contacts: int
    with_openings: int
    directories: list[DirectoryOut]


class AdminContactOut(BaseModel):
    email: str
    name: str | None = None
    title: str | None = None
    kind: str  # person | role | general
    source_url: str  # the page of the startup's own site it was published on


class AdminOpeningOut(BaseModel):
    title: str
    url: str  # where to apply, or the careers page when the opening has no page of its own


class AdminFounderOut(BaseModel):
    name: str
    title: str = ""
    source: str = ""  # the page of the startup's own site that names them
    email: str | None = None  # only if the startup itself published it


class AdminStartupOut(BaseModel):
    id: str
    name: str
    website: str
    domain: str
    directory: str
    directory_url: str
    batch: str | None = None
    one_liner: str = ""
    sector: str | None = None
    region: str
    country: str | None = None
    status: str  # new | researched | dead
    researched_at: datetime | None = None
    created_at: datetime
    summary: str = ""  # what the startup says it does, from its own pages
    hiring: bool = False
    careers_url: str | None = None
    openings: list[AdminOpeningOut] = []
    founders: list[AdminFounderOut] = []
    contacts: list[AdminContactOut] = []


class AdminStartupsOut(BaseModel):
    total: int
    items: list[AdminStartupOut]


class AdminRoleOut(BaseModel):
    startup_id: str
    startup: str
    website: str
    region: str
    country: str | None = None
    directory: str
    title: str
    url: str
    careers_url: str | None = None


class AdminRolesOut(BaseModel):
    total: int
    startups: int  # how many startups have at least one open role
    items: list[AdminRoleOut]


class DirectoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=8, max_length=500)
    region_hint: str = Field("", max_length=8)


class DirectoryPatch(BaseModel):
    enabled: bool


class ImportIn(BaseModel):
    directory: str = Field(min_length=1, max_length=120)
    region_hint: str = Field("", max_length=8)
    startups: list[StartupIn] = Field(min_length=1, max_length=200)


def get_fetcher() -> Fetcher:
    """The polite page reader. Tests replace it so nothing touches the network."""
    return directory.page_reader()


def _dir_out(d: Directory) -> DirectoryOut:
    return DirectoryOut(
        id=d.id,
        name=d.name,
        url=d.url,
        region_hint=d.region_hint,
        enabled=d.enabled,
        builtin=d.builtin,
        last_run_at=d.last_run_at,
        last_found=d.last_found,
        last_added=d.last_added,
        last_problem=d.last_problem,
    )


def _hint(value: str) -> str:
    if value not in ("", *policy.REGIONS):
        raise ApiError(422, "invalid_region", "Region can be blank, us, eu or uk.")
    return value


@admin_router.get("/overview")
async def admin_overview(
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> AdminOverviewOut:
    await directory.ensure_defaults(db, now)
    by_status = dict(
        (await db.execute(select(Startup.status, func.count()).group_by(Startup.status))).all()
    )
    by_region = dict(
        (await db.execute(select(Startup.region, func.count()).group_by(Startup.region))).all()
    )
    contacts = (
        await db.execute(select(func.count(func.distinct(StartupContact.startup_id))))
    ).scalar_one()
    openings = (
        await db.execute(
            select(func.count())
            .select_from(Startup)
            .where(func.jsonb_array_length(Startup.research["openings"]) > 0)
        )
    ).scalar_one()
    dirs = (await db.execute(select(Directory).order_by(Directory.name))).scalars().all()
    return AdminOverviewOut(
        startups=sum(by_status.values()),
        by_status=by_status,
        by_region=by_region,
        with_contacts=contacts,
        with_openings=openings,
        directories=[_dir_out(d) for d in dirs],
    )


def _startup_filters(filter: str, region: str, directory_name: str, q: str) -> list[Any]:
    """The WHERE conditions for the startup lists."""
    where: list[Any] = []
    if filter in ("researched", "new", "dead"):
        where.append(Startup.status == filter)
    elif filter == "contacts":
        where.append(Startup.id.in_(select(StartupContact.startup_id)))
    elif filter == "openings":
        where.append(func.jsonb_array_length(Startup.research["openings"]) > 0)
    if region:
        where.append(Startup.region == region)
    if directory_name:
        where.append(Startup.directory == directory_name)
    if q.strip():
        like = f"%{q.strip()}%"
        where.append(
            Startup.name.ilike(like)
            | Startup.domain.ilike(like)
            | Startup.one_liner.ilike(like)
            | Startup.country.ilike(like)
            | Startup.research["summary"].as_string().ilike(like)
        )
    return where


def _startup_out(s: Startup, contacts: list[StartupContact]) -> AdminStartupOut:
    r = s.research or {}
    return AdminStartupOut(
        id=str(s.id),
        name=s.name,
        website=s.website,
        domain=s.domain,
        directory=s.directory,
        directory_url=s.directory_url,
        batch=s.batch,
        one_liner=s.one_liner,
        sector=s.sector,
        region=s.region,
        country=s.country,
        status=s.status,
        researched_at=s.researched_at,
        created_at=s.created_at,
        summary=str(r.get("summary", "")),
        hiring=bool(r.get("hiring")),
        careers_url=r.get("careers_url"),
        openings=[
            AdminOpeningOut(title=str(o.get("title", "")), url=str(o.get("url", "")))
            for o in r.get("openings", [])
            if isinstance(o, dict) and o.get("title")
        ],
        founders=[
            AdminFounderOut(
                name=str(f["name"]),
                title=str(f.get("title", "")),
                source=str(f.get("source", "")),
                email=f.get("email"),
            )
            for f in r.get("founders", [])
            if isinstance(f, dict) and f.get("name")
        ],
        contacts=[
            AdminContactOut(
                email=c.email, name=c.name, title=c.title, kind=c.kind, source_url=c.source_url
            )
            for c in contacts
        ],
    )


@admin_router.get("/list")
async def admin_startup_list(
    filter: str = Query("all", pattern="^(all|researched|new|dead|contacts|openings)$"),
    region: str = Query("", max_length=8),
    directory_name: str = Query("", alias="directory", max_length=120),
    q: str = Query("", max_length=100),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> AdminStartupsOut:
    """The startups behind the totals: name, website, who listed it, what it does, its contacts and
    open roles. Filter by what the tiles count, a region, a directory, or a search."""
    where = _startup_filters(filter, region, directory_name, q)
    total = (await db.execute(select(func.count()).select_from(Startup).where(*where))).scalar_one()
    rows = (
        (
            await db.execute(
                select(Startup)
                .where(*where)
                .order_by(Startup.created_at.desc(), Startup.name)
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    by_startup: dict[uuid.UUID, list[StartupContact]] = {}
    if rows:
        for c in (
            (
                await db.execute(
                    select(StartupContact).where(
                        StartupContact.startup_id.in_([s.id for s in rows])
                    )
                )
            )
            .scalars()
            .all()
        ):
            by_startup.setdefault(c.startup_id, []).append(c)
    return AdminStartupsOut(
        total=total, items=[_startup_out(s, by_startup.get(s.id, [])) for s in rows]
    )


@admin_router.get("/roles")
async def admin_open_roles(
    region: str = Query("", max_length=8),
    q: str = Query("", max_length=100),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> AdminRolesOut:
    """Every open role found on the startups' own sites, with the startup and where to apply."""
    where = _startup_filters("openings", region, "", "")
    rows = (
        (
            await db.execute(
                select(Startup).where(*where).order_by(Startup.researched_at.desc()).limit(1000)
            )
        )
        .scalars()
        .all()
    )
    needle = q.strip().lower()
    items: list[AdminRoleOut] = []
    for s in rows:
        r = s.research or {}
        for o in r.get("openings", []):
            title = str(o.get("title", "")) if isinstance(o, dict) else ""
            if not title or (needle and needle not in f"{title} {s.name}".lower()):
                continue
            items.append(
                AdminRoleOut(
                    startup_id=str(s.id),
                    startup=s.name,
                    website=s.website,
                    region=s.region,
                    country=s.country,
                    directory=s.directory,
                    title=title,
                    url=str(o.get("url", "")),
                    careers_url=r.get("careers_url"),
                )
            )
    return AdminRolesOut(
        total=len(items),
        startups=len({i.startup_id for i in items}),
        items=items[offset : offset + limit],
    )


@admin_router.post("/directories", status_code=201)
async def add_directory(
    body: DirectoryIn,
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> DirectoryOut:
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise ApiError(422, "invalid_url", "The address must start with https://.")
    name = body.name.strip()
    if (await db.execute(select(Directory.id).where(Directory.name == name))).first():
        raise ApiError(409, "exists", "A directory with that name already exists.")
    d = Directory(
        id=uuid.uuid4(), name=name, url=url, region_hint=_hint(body.region_hint), created_at=now
    )
    db.add(d)
    await db.commit()
    return _dir_out(d)


async def _directory(db: AsyncSession, did: uuid.UUID) -> Directory:
    d = await db.get(Directory, did)
    if d is None:
        raise ApiError(404, "not_found", "Not found.")
    return d


@admin_router.put("/directories/{did}")
async def patch_directory(
    did: uuid.UUID,
    body: DirectoryPatch,
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> DirectoryOut:
    d = await _directory(db, did)
    d.enabled = body.enabled
    await db.commit()
    return _dir_out(d)


@admin_router.delete("/directories/{did}", status_code=204)
async def delete_directory(
    did: uuid.UUID,
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> None:
    d = await _directory(db, did)
    if d.builtin:
        raise ApiError(409, "builtin", "Built-in directories can be turned off, not deleted.")
    await db.delete(d)
    await db.commit()


@admin_router.post("/directories/{did}/refresh")
async def refresh_directory(
    did: uuid.UUID,
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    fetcher: Fetcher = Depends(get_fetcher),  # noqa: B008
) -> DirectoryOut:
    d = await _directory(db, did)
    await directory.refresh(db, fetcher, llm, d, now)
    return _dir_out(d)


@admin_router.post("/import")
async def import_startups(
    body: ImportIn,
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
) -> dict[str, int]:
    found = [
        f
        for s in body.startups
        if (f := directory._clean(s.model_dump(), "")) is not None  # noqa: SLF001
    ]
    added = await directory.save(
        db, body.directory, "manual import", found, now, _hint(body.region_hint)
    )
    return {"added": added, "skipped": len(body.startups) - added}


@admin_router.post("/research")
async def run_research(
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    llm: LlmProvider = Depends(get_llm),  # noqa: B008
    now: datetime = Depends(get_now),  # noqa: B008
    fetcher: Fetcher = Depends(get_fetcher),  # noqa: B008
) -> dict[str, int]:
    rows = (
        (
            await db.execute(
                select(Startup).where(Startup.status == "new", Startup.region != "other").limit(5)
            )
        )
        .scalars()
        .all()
    )
    for s in rows:
        await research.research(db, fetcher, llm, s, now)
    return {"researched": len(rows)}


class AccessPersonOut(BaseModel):
    id: str
    email: str
    name: str | None = None
    access: str
    requested_at: datetime | None = None


class AccessListOut(BaseModel):
    requested: int
    active: int
    items: list[AccessPersonOut]


class AccessIn(BaseModel):
    access: str = Field(pattern="^(active|none)$")


def _person(u: User) -> AccessPersonOut:
    return AccessPersonOut(
        id=str(u.id),
        email=u.email,
        name=u.full_name,
        access=u.outreach_access,
        requested_at=u.outreach_requested_at,
    )


@admin_router.get("/access")
async def access_list(
    q: str = Query("", max_length=100),
    _: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> AccessListOut:
    """Everyone who asked (waiting first) or has startup outreach; `q` finds anyone by email."""

    def count(a: str) -> Any:
        return select(func.count()).select_from(User).where(User.outreach_access == a)

    rows = select(User)
    if q.strip():
        rows = rows.where(User.email.ilike(f"%{q.strip()}%"))
    else:
        rows = rows.where(User.outreach_access != "none")
    rows = rows.order_by(
        (User.outreach_access != "requested"), User.outreach_requested_at.asc().nulls_last()
    ).limit(100)
    items = (await db.execute(rows)).scalars().all()
    return AccessListOut(
        requested=(await db.execute(count("requested"))).scalar_one(),
        active=(await db.execute(count("active"))).scalar_one(),
        items=[_person(u) for u in items],
    )


@admin_router.put("/access/{uid}")
async def access_set(
    uid: uuid.UUID,
    body: AccessIn,
    admin: User = Depends(require_admin),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> AccessPersonOut:
    """Switch startup outreach on for one person, or off again (their pitches stop at once)."""
    u = await db.get(User, uid)
    if u is None:
        raise ApiError(404, "not_found", "Not found.")
    newly = body.access == "active" and u.outreach_access != "active"
    u.outreach_access = body.access
    if body.access == "none":
        st = await engine.get_settings(db, u.id)
        if st is not None:
            st.enabled = False
    await db.commit()
    await record_from(
        db, f"outreach.{'approved' if body.access == 'active' else 'revoked'}",
        user_id=u.id, actor_id=admin.id,
    )  # fmt: skip
    if newly:
        await notifier.outreach_approved(u.id)
    return _person(u)
