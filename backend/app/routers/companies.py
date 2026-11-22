import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_resolver, get_runner
from app.errors import ApiError
from app.models import Company, ResearchJob, User
from app.repositories import CompaniesRepo, IdempotencyRepo, UsageRepo
from app.schemas.api import (
    BriefEditIn,
    BriefEditOut,
    CompanyCreatedOut,
    CompanyDetailOut,
    CompanyIn,
    CompanyOut,
    CompanySummary,
    JobOut,
    PasteIn,
    ResearchStartedOut,
    SourceOut,
    StatusOut,
)
from app.schemas.brief import BriefContent
from app.services.brief_edit import EditError, FactEdit, apply_edits
from app.services.events import record_from
from app.services.url_guard import Resolver, UrlRejected, validate_public_url
from app.workers.research_worker import ResearchRunner

router = APIRouter(prefix="/api", tags=["companies"])
CREATE_ROUTE = "POST /api/companies"
FIELD_LABELS = {"website_url": "Website", "job_posting_url": "Job posting link"}


# ---------------------------------------------------------------------- helpers


def _company_out(c: Company) -> CompanyOut:
    return CompanyOut(
        id=c.id,
        name=c.name,
        website_url=c.website_url,
        job_posting_url=c.job_posting_url,
        extra_links=list(c.extra_links or []),
        role=c.role,
        known_text=c.known_text,
        last_researched_at=c.last_researched_at,
        created_at=c.created_at,
    )


def _job_out(j: ResearchJob) -> JobOut:
    return JobOut(
        id=j.id,
        status=j.status,
        step_detail=j.step_detail,
        error=j.error,
        started_at=j.started_at,
        finished_at=j.finished_at,
    )


async def _validated_fields(body: CompanyIn, resolver: Resolver) -> dict[str, Any]:
    """Reject links that fail the fetcher's address rules (FR-06), naming the offending field."""

    async def check(label: str, url: str | None) -> str | None:
        if url is None:
            return None
        try:
            return await validate_public_url(url, resolver)
        except UrlRejected as exc:
            raise ApiError(422, "invalid_url", f"{label}: {exc.message}") from None

    return {
        "name": body.name,
        "website_url": await check("Website", body.website_url),
        "job_posting_url": await check("Job posting link", body.job_posting_url),
        "extra_links": [
            await check(f"Extra link {i}", u) for i, u in enumerate(body.extra_links, start=1)
        ],
        "role": body.role.strip(),
        "known_text": body.known_text.strip(),
    }


async def _owned(db: AsyncSession, user: User, company_id: uuid.UUID) -> Company:
    company = await CompaniesRepo(db, user.id).get(company_id)
    if company is None:
        raise ApiError(404, "company_not_found", "Company not found.")
    return company


async def _start_job(
    db: AsyncSession, user: User, settings: Settings, company_id: uuid.UUID, *, refresh: bool
) -> ResearchJob:
    """Count the job against the daily cap and add it. Caller commits."""
    if not await UsageRepo(db, user.id).consume_research_job(settings.cap_research_jobs_daily):
        raise ApiError(
            429, "daily_cap", "You've reached today's research limit. Try again tomorrow."
        )
    return CompaniesRepo(db, user.id).add_job(company_id, refresh=refresh)


# -------------------------------------------------------------------- endpoints


@router.get("/companies")
async def list_companies(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> list[CompanySummary]:
    rows = await CompaniesRepo(db, user.id).list_all()
    return [
        CompanySummary(
            id=c.id, name=c.name, last_researched_at=c.last_researched_at, job_status=status
        )
        for c, status in rows
    ]


@router.post("/companies", status_code=201)
async def create_company(
    body: CompanyIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    resolver: Resolver = Depends(get_resolver),  # noqa: B008
    runner: ResearchRunner = Depends(get_runner),  # noqa: B008
    idempotency_key: str | None = Header(default=None, max_length=200),
) -> CompanyCreatedOut:
    """Save a company and start its research job."""
    idem = IdempotencyRepo(db, user.id)
    if idempotency_key:
        saved = await idem.find(idempotency_key, CREATE_ROUTE)
        if saved is not None:
            return CompanyCreatedOut.model_validate(saved)

    fields = await _validated_fields(body, resolver)
    company = await CompaniesRepo(db, user.id).create(**fields)
    job = await _start_job(db, user, settings, company.id, refresh=False)
    await db.flush()
    out = CompanyCreatedOut(company=_company_out(company), job_id=job.id)
    if idempotency_key:
        idem.add(idempotency_key, CREATE_ROUTE, out.model_dump(mode="json"))
    try:
        await db.commit()
    except IntegrityError:  # a concurrent retry with the same key won
        await db.rollback()
        saved = await idem.find(idempotency_key or "", CREATE_ROUTE)
        if saved is None:
            raise
        return CompanyCreatedOut.model_validate(saved)
    runner.start(job.id)
    await record_from(
        db, "company.added", user_id=user.id, company_id=company.id, name=company.name
    )
    return out


@router.get("/companies/{company_id}")
async def get_company(
    company_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> CompanyDetailOut:
    company = await _owned(db, user, company_id)
    repo = CompaniesRepo(db, user.id)
    brief_row = await repo.current_brief(company_id)
    job = await repo.latest_job(company_id)
    return CompanyDetailOut(
        company=_company_out(company),
        brief=BriefContent.model_validate(brief_row.content) if brief_row else None,
        brief_version=brief_row.version if brief_row else None,
        brief_created_at=brief_row.created_at if brief_row else None,
        sources=[
            SourceOut.model_validate(s, from_attributes=True)
            for s in await repo.sources(company_id)
        ],
        job=_job_out(job) if job else None,
    )


@router.put("/companies/{company_id}")
async def update_company(
    company_id: uuid.UUID,
    body: CompanyIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    resolver: Resolver = Depends(get_resolver),  # noqa: B008
) -> CompanyOut:
    """Edit company details. This does not start research by itself (it costs money); the page
    offers "Research again" so the user decides."""
    company = await _owned(db, user, company_id)
    for key, value in (await _validated_fields(body, resolver)).items():
        setattr(company, key, value)
    await db.commit()
    return _company_out(company)


@router.delete("/companies/{company_id}")
async def delete_company(
    company_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> StatusOut:
    if not await CompaniesRepo(db, user.id).delete(company_id):
        raise ApiError(404, "company_not_found", "Company not found.")
    return StatusOut(status="ok")


@router.post("/companies/{company_id}/research", status_code=202)
async def rerun_research(
    company_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    runner: ResearchRunner = Depends(get_runner),  # noqa: B008
) -> ResearchStartedOut:
    """Re-run research (bypasses the page cache). One job per company at a time: if one is
    already running, its id is returned and nothing new starts."""
    await _owned(db, user, company_id)
    running = await CompaniesRepo(db, user.id).active_job(company_id)
    if running is not None:
        return ResearchStartedOut(job_id=running.id)
    job = await _start_job(db, user, settings, company_id, refresh=True)
    await db.commit()
    runner.start(job.id)
    return ResearchStartedOut(job_id=job.id)


@router.get("/companies/{company_id}/research/status")
async def research_status(
    company_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> JobOut:
    await _owned(db, user, company_id)
    job = await CompaniesRepo(db, user.id).latest_job(company_id)
    if job is None:
        raise ApiError(404, "no_research", "This company hasn't been researched yet.")
    return _job_out(job)


@router.post("/companies/{company_id}/sources/paste", status_code=201)
async def paste_source(
    company_id: uuid.UUID,
    body: PasteIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> SourceOut:
    """Add text the app could not read itself. It is labelled "Pasted by you" in the brief."""
    await _owned(db, user, company_id)
    src = await CompaniesRepo(db, user.id).add_pasted_source(
        company_id, title=body.title, text=body.text
    )
    return SourceOut.model_validate(src, from_attributes=True)


@router.delete("/companies/{company_id}/sources/{source_id}")
async def remove_source(
    company_id: uuid.UUID,
    source_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> StatusOut:
    if not await CompaniesRepo(db, user.id).remove_source(company_id, source_id):
        raise ApiError(404, "source_not_found", "Source not found.")
    return StatusOut(status="ok")


@router.put("/companies/{company_id}/brief")
async def edit_brief(
    company_id: uuid.UUID,
    body: BriefEditIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> BriefEditOut:
    """Edit fact text, pin facts, add the user's own facts or delete facts. Only the changed facts
    are sent. Edits and pins survive a refresh."""
    await _owned(db, user, company_id)
    repo = CompaniesRepo(db, user.id)
    row = await repo.current_brief(company_id)
    if row is None:
        raise ApiError(404, "no_brief", "There is no brief to edit yet.")
    content = BriefContent.model_validate(row.content)
    try:
        apply_edits(
            content,
            [
                FactEdit(
                    section_key=e.section_key,
                    text=e.text,
                    id=e.id,
                    pinned=e.pinned,
                    delete=e.delete,
                )
                for e in body.facts
            ],
        )
    except EditError as exc:
        raise ApiError(422, exc.code, exc.message) from None
    saved = await repo.save_brief_content(company_id, content.model_dump(mode="json"))
    assert saved is not None
    return BriefEditOut(brief=content, brief_version=saved.version)
