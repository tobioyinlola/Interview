"""Real job sources. Each reads a public feed and returns normalised listings. None needs an account
or a key, and none submits anything: they only find jobs.

Honest status: written from each feed's published format and tested against sample responses. They
have NOT been run against the live services from this repository (no outbound network here)."""

import re
from datetime import UTC, datetime
from html import unescape
from typing import Any

import httpx

from app.autoapply.adapters import AdapterError, RawPosting

UA = "InterviewMeet-AutoApply/1.0 (+job discovery for candidates who asked for it)"
MAX_PER_SOURCE = 300
MAX_ROLE_QUERIES = 3


def text_of(html: str | None) -> str:
    """Readable text from a feed's HTML description."""
    raw = unescape(html or "")
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw)).strip()[:30_000]


def when(value: Any) -> datetime | None:
    """A timestamp from an ISO string or epoch seconds/milliseconds, or None."""
    if value in (None, "", 0):
        return None
    try:
        if isinstance(value, int | float):
            seconds = value / 1000 if value > 1e11 else value
            return datetime.fromtimestamp(seconds, UTC)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None


class JsonSource:
    """Shared plumbing: one polite GET with a clear user agent, errors turned into AdapterError."""

    name = "source"
    broad = True  # returns far more than one candidate wants: filter by role before storing

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> Any:
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=20, follow_redirects=False
            ) as c:
                r = await c.get(
                    url, params=params, headers={"accept": "application/json", "user-agent": UA}
                )
        except httpx.HTTPError:
            raise AdapterError(
                "network", f"{self.name} could not be reached.", transient=True
            ) from None
        if r.status_code == 404:
            return None
        if r.status_code in (429,) or r.status_code >= 500:
            raise AdapterError("unavailable", f"{self.name} is busy.", transient=True)
        if r.status_code != 200:
            raise AdapterError("rejected", f"{self.name} answered {r.status_code}.")
        try:
            return r.json()
        except ValueError:
            raise AdapterError("rejected", f"{self.name} sent something unreadable.") from None

    async def fetch(self, url: str) -> RawPosting | None:
        return None  # a pasted link is read by the board-specific source that owns the address


def _roles(criteria: dict[str, Any]) -> list[str]:
    return [r["value"] for r in (criteria.get("roles") or [])][:MAX_ROLE_QUERIES]


class RemotiveSource(JsonSource):
    """remotive.com: remote jobs worldwide. Asked once for each role the candidate wants."""

    name = "remotive"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        region = (job.get("candidate_required_location") or "").strip() or None
        return RawPosting(
            source="remotive",
            source_url=job.get("url") or "",
            company=job.get("company_name") or "",
            title=job.get("title") or "",
            description=text_of(job.get("description")),
            requisition_id=f"remotive-{job['id']}" if job.get("id") else None,
            region=region,
            arrangement="remote",
            contract=(job.get("job_type") or "").replace("_", " ") or None,
            industry=job.get("category") or None,
            posted_at=when(job.get("publication_date")),
            application_url=job.get("url") or None,  # the listing page, not an employer form
            evidence={"region": "Remotive's required-location field", "listing": "remotive.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: dict[str, RawPosting] = {}
        for role in _roles(criteria) or [""]:
            params: dict[str, Any] = {"limit": 100}
            if role:
                params["search"] = role
            data = await self._get("https://remotive.com/api/remote-jobs", params)
            for job in (data or {}).get("jobs", []):
                p = self.parse(job)
                if p.source_url and p.title:
                    out[p.source_url] = p
        return list(out.values())[:MAX_PER_SOURCE]


class ArbeitnowSource(JsonSource):
    """arbeitnow.com: jobs in Europe and remote."""

    name = "arbeitnow"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        remote = bool(job.get("remote"))
        location = (job.get("location") or "").strip()
        return RawPosting(
            source="arbeitnow",
            source_url=job.get("url") or "",
            company=job.get("company_name") or "",
            title=job.get("title") or "",
            description=text_of(job.get("description")),
            requisition_id=f"arbeitnow-{job['slug']}" if job.get("slug") else None,
            region=location or None,
            arrangement="remote" if remote else None,
            contract=", ".join(job.get("job_types") or []) or None,
            posted_at=when(job.get("created_at")),
            application_url=job.get("url") or None,
            evidence={"region": "Arbeitnow's location field", "listing": "arbeitnow.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for page in (1, 2, 3):
            data = await self._get("https://www.arbeitnow.com/api/job-board-api", {"page": page})
            rows = (data or {}).get("data", [])
            out += [self.parse(j) for j in rows]
            if not rows or len(out) >= MAX_PER_SOURCE:
                break
        return [p for p in out if p.source_url and p.title][:MAX_PER_SOURCE]


class RemoteOkSource(JsonSource):
    """remoteok.com. Their terms ask for a link back and credit, so every listing keeps its address
    and says where it came from."""

    name = "remoteok"

    @staticmethod
    def parse(job: dict[str, Any]) -> RawPosting:
        return RawPosting(
            source="remoteok",
            source_url=job.get("url") or "",
            company=job.get("company") or "",
            title=job.get("position") or "",
            description=text_of(job.get("description")),
            requisition_id=f"remoteok-{job['id']}" if job.get("id") else None,
            region=(job.get("location") or "").strip() or None,
            arrangement="remote",
            salary_min=float(job["salary_min"]) if job.get("salary_min") else None,
            salary_max=float(job["salary_max"]) if job.get("salary_max") else None,
            salary_currency="USD" if job.get("salary_min") else None,
            salary_period="year" if job.get("salary_min") else None,
            posted_at=when(job.get("date") or job.get("epoch")),
            application_url=job.get("url") or None,
            evidence={"region": "Remote OK's location field", "listing": "remoteok.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        data = await self._get("https://remoteok.com/api")
        rows = [
            j for j in (data or []) if isinstance(j, dict) and j.get("position")
        ]  # [0] is a notice
        return [p for p in (self.parse(j) for j in rows) if p.source_url][:MAX_PER_SOURCE]


class LeverSource(JsonSource):
    """Employers that use Lever. Each company is named in AUTOAPPLY_LEVER_COMPANIES."""

    name = "lever"

    def __init__(
        self, companies: list[str], transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(transport)
        self.companies = companies

    @staticmethod
    def parse(company: str, job: dict[str, Any]) -> RawPosting:
        cats = job.get("categories") or {}
        workplace = (job.get("workplaceType") or "").lower()
        location = (cats.get("location") or "").strip()
        return RawPosting(
            source="lever",
            source_url=job.get("hostedUrl") or "",
            company=company.replace("-", " ").title(),
            title=job.get("text") or "",
            description=(job.get("descriptionPlain") or text_of(job.get("description")))[:30_000],
            requisition_id=f"{company}-{job['id']}" if job.get("id") else None,
            region=job.get("country") or location or None,
            arrangement=workplace
            if workplace in ("remote", "hybrid", "onsite")
            else ("remote" if "remote" in location.lower() else None),
            contract=cats.get("commitment") or None,
            industry=cats.get("department") or None,
            posted_at=when(job.get("createdAt")),
            application_url=job.get("applyUrl") or job.get("hostedUrl") or None,
            evidence={"region": "the Lever posting's location", "listing": "jobs.lever.co"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for company in self.companies:
            data = await self._get(f"https://api.lever.co/v0/postings/{company}", {"mode": "json"})
            out += [self.parse(company, j) for j in (data or []) if isinstance(j, dict)]
        return [p for p in out if p.source_url and p.title][:MAX_PER_SOURCE]

    async def fetch(self, url: str) -> RawPosting | None:
        m = re.search(r"jobs\.lever\.co/([\w-]+)/([0-9a-f-]{36})", url)
        if not m:
            return None
        data = await self._get(f"https://api.lever.co/v0/postings/{m[1]}/{m[2]}")
        return self.parse(m[1], data) if isinstance(data, dict) else None


class AshbySource(JsonSource):
    """Employers that use Ashby. Each board is named in AUTOAPPLY_ASHBY_BOARDS."""

    name = "ashby"

    def __init__(
        self, boards: list[str], transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(transport)
        self.boards = boards

    @staticmethod
    def parse(board: str, job: dict[str, Any]) -> RawPosting:
        location = (job.get("location") or "").strip()
        addr = (job.get("address") or {}).get("postalAddress") or {}
        return RawPosting(
            source="ashby",
            source_url=job.get("jobUrl") or "",
            company=board.replace("-", " ").title(),
            title=job.get("title") or "",
            description=(job.get("descriptionPlain") or text_of(job.get("descriptionHtml")))[
                :30_000
            ],
            requisition_id=f"{board}-{job['id']}" if job.get("id") else None,
            region=addr.get("addressCountry") or location or None,
            arrangement="remote" if job.get("isRemote") else None,
            contract=(job.get("employmentType") or "").replace("Full", "full ").lower().strip()
            or None,
            industry=job.get("department") or None,
            posted_at=when(job.get("publishedAt")),
            application_url=job.get("applyUrl") or job.get("jobUrl") or None,
            evidence={"region": "the Ashby posting's location", "listing": "jobs.ashbyhq.com"},
        )

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        out: list[RawPosting] = []
        for board in self.boards:
            data = await self._get(f"https://api.ashbyhq.com/posting-api/job-board/{board}")
            out += [
                self.parse(board, j)
                for j in (data or {}).get("jobs", [])
                if j.get("isListed", True)
            ]
        return [p for p in out if p.source_url and p.title][:MAX_PER_SOURCE]

    async def fetch(self, url: str) -> RawPosting | None:
        return None
