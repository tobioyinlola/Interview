"""More public job feeds. Same rules as sources.py: each only finds jobs, needs no account or key,
and submits nothing.

Honest status: Jobicy was written from its published README. The others (Himalayas, The Muse,
Working Nomads, We Work Remotely, SmartRecruiters, Recruitee, Workable, Personio) were written from
descriptions of each feed's format and tested only against sample responses of that shape. NONE has
been run against the live service (no outbound network here), so expect to adjust a field name or
two the first time each is switched on."""

import re
from datetime import datetime
from typing import Any

import httpx
from defusedxml import ElementTree

from app.autoapply.adapters import AdapterError, RawPosting
from app.autoapply.sources import MAX_PER_SOURCE, UA, JsonSource, text_of, when


def _clean(items: list[RawPosting]) -> list[RawPosting]:
    seen: dict[str, RawPosting] = {}
    for p in items:
        if p.source_url and p.title:
            seen.setdefault(p.source_url, p)
    return list(seen.values())[:MAX_PER_SOURCE]


class JobicySource(JsonSource):
    """jobicy.com: remote jobs. Its README asks for at most one poll an hour and a visible credit
    with the original link, which every listing keeps."""

    name = "jobicy"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        lo, hi = job.get("salaryMin"), job.get("salaryMax")
        return RawPosting(
            source="jobicy",
            source_url=job.get("url") or "",
            company=job.get("companyName") or "",
            title=job.get("jobTitle") or "",
            description=text_of(job.get("jobDescription") or job.get("jobExcerpt")),
            requisition_id=f"jobicy-{job['id']}" if job.get("id") else None,
            region=(job.get("jobGeo") or "").strip() or None,
            arrangement="remote",
            contract=", ".join(job.get("jobType") or []).replace("-", " ") or None,
            industry=", ".join(job.get("jobIndustry") or []) or None,
            salary_min=float(lo) if lo else None,
            salary_max=float(hi) if hi else None,
            salary_currency=job.get("salaryCurrency") if lo else None,
            salary_period=(job.get("salaryPeriod") or "").lower() or None if lo else None,
            posted_at=when(job.get("pubDate")),
            application_url=job.get("url") or None,
            evidence={"region": "Jobicy's eligibility field", "listing": "jobicy.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        data = await self._get("https://jobicy.com/api/jobs", {"count": 100})
        return _clean([self.parse(j) for j in (data or {}).get("jobs", []) if isinstance(j, dict)])


class HimalayasSource(JsonSource):
    """himalayas.app: remote jobs. Twenty a request, a few pages."""

    name = "himalayas"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        places = job.get("locationRestrictions") or []
        lo, hi = job.get("minSalary"), job.get("maxSalary")
        return RawPosting(
            source="himalayas",
            source_url=job.get("applicationLink") or job.get("guid") or "",
            company=job.get("companyName") or "",
            title=job.get("title") or "",
            description=text_of(job.get("description") or job.get("excerpt")),
            requisition_id=f"himalayas-{job['guid']}" if job.get("guid") else None,
            region=", ".join(places) or "Anywhere",
            arrangement="remote",
            contract=(job.get("employmentType") or "").replace("_", " ").lower() or None,
            industry=", ".join(job.get("categories") or []) or None,
            salary_min=float(lo) if lo else None,
            salary_max=float(hi) if hi else None,
            salary_currency=job.get("currency") if lo else None,
            salary_period="year" if lo else None,
            posted_at=when(job.get("pubDate")),
            application_url=job.get("applicationLink") or None,
            evidence={"region": "Himalayas' location restrictions", "listing": "himalayas.app"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for page in range(3):
            data = await self._get(
                "https://himalayas.app/jobs/api", {"limit": 20, "offset": page * 20}
            )
            rows = (data or {}).get("jobs", [])
            out += [self.parse(j) for j in rows if isinstance(j, dict)]
            if len(rows) < 20:
                break
        return _clean(out)


class MuseSource(JsonSource):
    """themuse.com: company-curated jobs, mostly in the US and some remote."""

    name = "themuse"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        places = [p.get("name") for p in job.get("locations") or [] if p.get("name")]
        flexible = any("flexible" in p.lower() or "remote" in p.lower() for p in places)
        return RawPosting(
            source="themuse",
            source_url=(job.get("refs") or {}).get("landing_page") or "",
            company=(job.get("company") or {}).get("name") or "",
            title=job.get("name") or "",
            description=text_of(job.get("contents")),
            requisition_id=f"themuse-{job['id']}" if job.get("id") else None,
            region=", ".join(places) or None,
            arrangement="remote" if flexible else None,
            industry=", ".join(c.get("name") for c in job.get("categories") or [] if c.get("name"))
            or None,
            posted_at=when(job.get("publication_date")),
            application_url=(job.get("refs") or {}).get("landing_page") or None,
            evidence={"region": "The Muse's locations", "listing": "themuse.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for page in (0, 1, 2):
            data = await self._get("https://www.themuse.com/api/public/jobs", {"page": page})
            rows = (data or {}).get("results", [])
            out += [self.parse(j) for j in rows if isinstance(j, dict)]
            if not rows:
                break
        return _clean(out)


class WorkingNomadsSource(JsonSource):
    """workingnomads.com: curated remote jobs."""

    name = "workingnomads"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        return RawPosting(
            source="workingnomads",
            source_url=job.get("url") or "",
            company=job.get("company_name") or "",
            title=job.get("title") or "",
            description=text_of(job.get("description")),
            requisition_id=f"workingnomads-{job['url']}" if job.get("url") else None,
            region=(job.get("location") or "").strip() or "Anywhere",
            arrangement="remote",
            industry=job.get("category_name") or None,
            posted_at=when(job.get("pub_date")),
            application_url=job.get("url") or None,
            evidence={"region": "Working Nomads' location", "listing": "workingnomads.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        data = await self._get("https://www.workingnomads.com/api/exports/jobs")
        rows = data if isinstance(data, list) else []
        return _clean([self.parse(j) for j in rows if isinstance(j, dict)])


class _XmlSource(JsonSource):
    """A feed that answers with XML. Parsed with defusedxml: a feed is outside input."""

    async def _xml(self, url: str) -> Any:
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=20, follow_redirects=False
            ) as c:
                r = await c.get(url, headers={"user-agent": UA})
        except httpx.HTTPError:
            raise AdapterError(
                "network", f"{self.name} could not be reached.", transient=True
            ) from None
        if r.status_code == 404:
            return None
        if r.status_code == 429 or r.status_code >= 500:
            raise AdapterError("unavailable", f"{self.name} is busy.", transient=True)
        if r.status_code != 200:
            raise AdapterError("rejected", f"{self.name} answered {r.status_code}.")
        try:
            return ElementTree.fromstring(r.content)
        except Exception:
            raise AdapterError("rejected", f"{self.name} sent something unreadable.") from None


class WeWorkRemotelySource(_XmlSource):
    """weworkremotely.com, through its RSS feed. Titles read 'Company: Role'."""

    name = "weworkremotely"

    @staticmethod
    def parse(item: Any) -> RawPosting:
        full = (item.findtext("title") or "").strip()
        company, _, title = full.partition(": ")
        if not title:
            company, title = "", full
        link = (item.findtext("link") or "").strip()
        posted = None
        try:
            from email.utils import parsedate_to_datetime

            posted = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            posted = None
        return RawPosting(
            source="weworkremotely",
            source_url=link,
            company=company.strip(),
            title=title.strip(),
            description=text_of(item.findtext("description")),
            requisition_id=f"wwr-{link}" if link else None,
            region=(item.findtext("region") or "").strip() or "Anywhere",
            arrangement="remote",
            contract=(item.findtext("type") or "").strip().lower() or None,
            industry=(item.findtext("category") or "").strip() or None,
            posted_at=posted,
            application_url=link or None,
            evidence={"region": "We Work Remotely's region", "listing": "weworkremotely.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        root = await self._xml("https://weworkremotely.com/remote-jobs.rss")
        if root is None:
            return []
        return _clean([self.parse(i) for i in root.iter("item")])


class _CompanySource(JsonSource):
    """Employers that use one applicant-tracking system. Each is named in a setting."""

    def __init__(
        self, companies: list[str], transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(transport)
        self.companies = companies


def _title(slug: str) -> str:
    return slug.replace("-", " ").title()


class SmartRecruitersSource(_CompanySource):
    """smartrecruiters.com career pages. The list holds no text, so each posting is read once."""

    name = "smartrecruiters"
    DETAIL_CAP = 40

    @staticmethod
    def parse(company: str, job: dict[str, Any], detail: dict[str, Any] | None) -> RawPosting:
        loc = job.get("location") or {}
        sections = ((detail or {}).get("jobAd") or {}).get("sections") or {}
        body = " ".join(
            text_of((sections.get(k) or {}).get("text"))
            for k in ("jobDescription", "qualifications", "additionalInformation")
        ).strip()
        place = ", ".join(x for x in (loc.get("city"), (loc.get("country") or "").upper()) if x)
        return RawPosting(
            source="smartrecruiters",
            source_url=f"https://jobs.smartrecruiters.com/{company}/{job.get('id')}",
            company=(job.get("company") or {}).get("name") or _title(company),
            title=job.get("name") or "",
            description=body,
            requisition_id=f"{company}-{job['id']}" if job.get("id") else None,
            region=place or None,
            arrangement="remote" if loc.get("remote") else None,
            contract=((job.get("typeOfEmployment") or {}).get("label") or "").lower() or None,
            industry=(job.get("department") or {}).get("label") or None,
            posted_at=when(job.get("releasedDate")),
            application_url=f"https://jobs.smartrecruiters.com/{company}/{job.get('id')}",
            evidence={
                "region": "the SmartRecruiters posting's location",
                "listing": "smartrecruiters.com",
            },
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for company in self.companies:
            data = await self._get(
                f"https://api.smartrecruiters.com/v1/companies/{company}/postings",
                {"limit": 100},
            )
            for n, job in enumerate((data or {}).get("content", [])):
                if not isinstance(job, dict) or not job.get("id"):
                    continue
                detail = (
                    await self._get(
                        f"https://api.smartrecruiters.com/v1/companies/{company}/postings/{job['id']}"
                    )
                    if n < self.DETAIL_CAP
                    else None
                )
                out.append(self.parse(company, job, detail))
        return _clean(out)


class RecruiteeSource(_CompanySource):
    """recruitee.com career pages."""

    name = "recruitee"

    @staticmethod
    def parse(company: str, job: dict[str, Any]) -> RawPosting:
        place = ", ".join(x for x in (job.get("city"), job.get("country")) if x)
        remote = bool(job.get("remote")) or "remote" in (job.get("location") or "").lower()
        url = job.get("careers_url") or ""
        return RawPosting(
            source="recruitee",
            source_url=url,
            company=job.get("company_name") or _title(company),
            title=job.get("title") or "",
            description=text_of(f"{job.get('description') or ''} {job.get('requirements') or ''}"),
            requisition_id=f"{company}-{job['id']}" if job.get("id") else None,
            region=place or job.get("location") or None,
            arrangement="remote" if remote else None,
            contract=(job.get("employment_type_code") or "").replace("_", " ") or None,
            industry=job.get("department") or None,
            posted_at=when(job.get("published_at") or job.get("created_at")),
            application_url=url or None,
            evidence={"region": "the Recruitee offer's location", "listing": "recruitee.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for company in self.companies:
            data = await self._get(f"https://{company}.recruitee.com/api/offers/")
            out += [
                self.parse(company, j)
                for j in (data or {}).get("offers", [])
                if isinstance(j, dict)
            ]
        return _clean(out)


class WorkableSource(_CompanySource):
    """workable.com career pages, through the public widget feed."""

    name = "workable"

    @staticmethod
    def parse(company: str, name: str, job: dict[str, Any]) -> RawPosting:
        place = ", ".join(x for x in (job.get("city"), job.get("country")) if x)
        url = job.get("url") or job.get("application_url") or ""
        return RawPosting(
            source="workable",
            source_url=url,
            company=name or _title(company),
            title=job.get("title") or "",
            description=text_of(job.get("description")),
            requisition_id=f"{company}-{job['shortcode']}" if job.get("shortcode") else None,
            region=place or None,
            arrangement="remote" if job.get("telecommuting") else None,
            contract=(job.get("employment_type") or "").lower() or None,
            industry=job.get("department") or None,
            posted_at=when(job.get("published_on") or job.get("created_at")),
            application_url=job.get("application_url") or url or None,
            evidence={"region": "the Workable posting's location", "listing": "workable.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for company in self.companies:
            data = await self._get(
                f"https://apply.workable.com/api/v1/widget/accounts/{company}", {"details": "true"}
            )
            name = (data or {}).get("name") or ""
            out += [
                self.parse(company, name, j)
                for j in (data or {}).get("jobs", [])
                if isinstance(j, dict)
            ]
        return _clean(out)


class PersonioSource(_XmlSource, _CompanySource):
    """Employers that use Personio, through its public XML feed."""

    name = "personio"

    @staticmethod
    def parse(company: str, pos: Any) -> RawPosting:
        pid = (pos.findtext("id") or "").strip()
        body = " ".join(text_of(d.findtext("value")) for d in pos.iter("jobDescription")).strip()
        office = (pos.findtext("office") or "").strip()
        url = f"https://{company}.jobs.personio.de/job/{pid}" if pid else ""
        return RawPosting(
            source="personio",
            source_url=url,
            company=_title(company),
            title=(pos.findtext("name") or "").strip(),
            description=body,
            requisition_id=f"{company}-{pid}" if pid else None,
            region=office or None,
            arrangement="remote" if re.search(r"remote", office, re.I) else None,
            contract=(pos.findtext("employmentType") or "").replace("_", " ").lower() or None,
            industry=(pos.findtext("department") or "").strip() or None,
            posted_at=when((pos.findtext("createdAt") or "").strip()),
            application_url=url or None,
            evidence={"region": "the Personio position's office", "listing": "personio.de"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for company in self.companies:
            root = await self._xml(f"https://{company}.jobs.personio.de/xml")
            if root is not None:
                out += [self.parse(company, p) for p in root.iter("position")]
        return _clean(out)
