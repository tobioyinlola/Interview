"""The real job sources, against sample responses in each feed's published format. They have not been
run against the live services from here (no outbound network)."""

from datetime import UTC, datetime

import httpx
import pytest

from app.autoapply import discovery, matching
from app.autoapply import sources as src
from app.autoapply.adapters import AdapterError
from app.hardening import _autoapply_problems

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)
CRIT = {"roles": [{"value": "Product Manager", "required": True}]}


def feed(payload, status=200, seen=None):
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        return httpx.Response(status, json=payload)

    return httpx.MockTransport(handler)


# ----------------------------------------------------------------------------- remotive


REMOTIVE = {
    "jobs": [
        {
            "id": 11,
            "url": "https://remotive.com/remote-jobs/product/senior-pm-11",
            "title": "Senior Product Manager",
            "company_name": "Acme",
            "category": "Product",
            "job_type": "full_time",
            "publication_date": "2026-11-01T10:00:00",
            "candidate_required_location": "Africa",
            "description": "<p>Lead <b>payments</b>.&nbsp;Remote.</p>",
        },
        {"id": 12, "url": "", "title": "No address", "company_name": "X"},
    ]
}


async def test_remotive_is_asked_once_per_wanted_role_and_parsed():
    seen: list[httpx.Request] = []
    crit = {"roles": [{"value": "Product Manager"}, {"value": "Data Analyst"}]}
    jobs = await src.RemotiveSource(feed(REMOTIVE, seen=seen)).search(crit, NOW)
    assert [r.url.params["search"] for r in seen] == ["Product Manager", "Data Analyst"]
    assert all(r.headers["user-agent"].startswith("InterviewMeet") for r in seen)
    assert (
        len(jobs) == 1
    )  # the same job from two searches is one; one without an address is dropped
    j = jobs[0]
    assert j.company == "Acme" and j.region == "Africa" and j.arrangement == "remote"
    assert j.description == "Lead payments . Remote." or "payments" in j.description
    assert "<" not in j.description and j.requisition_id == "remotive-11"
    assert j.posted_at == datetime(2026, 11, 1, 10, 0)
    assert j.application_url == j.source_url


# ---------------------------------------------------------------------------- arbeitnow


async def test_arbeitnow_reads_the_first_pages_and_keeps_location_and_remote():
    page = {
        "data": [
            {
                "slug": "pm-berlin",
                "company_name": "Beta",
                "title": "Product Manager",
                "description": "<p>Hi</p>",
                "remote": False,
                "url": "https://www.arbeitnow.com/jobs/pm-berlin",
                "job_types": ["Full Time"],
                "location": "Berlin",
                "created_at": 1762000000,
            }
        ]
    }
    seen: list[httpx.Request] = []
    jobs = await src.ArbeitnowSource(feed(page, seen=seen)).search({}, NOW)
    assert len(seen) == 3 and [r.url.params["page"] for r in seen] == ["1", "2", "3"]
    assert jobs and jobs[0].region == "Berlin" and jobs[0].arrangement is None
    assert jobs[0].posted_at.year == 2025 or jobs[0].posted_at.year == 2026


# ----------------------------------------------------------------------------- remoteok


async def test_remote_ok_skips_its_notice_row_and_keeps_the_link_back():
    data = [
        {"legal": "Please link back to Remote OK"},
        {
            "id": "99",
            "url": "https://remoteok.com/remote-jobs/pm-99",
            "position": "Product Manager",
            "company": "Gamma",
            "location": "Worldwide",
            "salary_min": 90000,
            "salary_max": 120000,
            "description": "<p>Remote</p>",
            "date": "2026-11-02T08:00:00+00:00",
        },
    ]
    jobs = await src.RemoteOkSource(feed(data)).search({}, NOW)
    assert len(jobs) == 1
    j = jobs[0]
    assert (
        j.source_url == "https://remoteok.com/remote-jobs/pm-99"
        and j.evidence["listing"] == "remoteok.com"
    )
    assert (j.salary_min, j.salary_max, j.salary_currency, j.salary_period) == (
        90000.0,
        120000.0,
        "USD",
        "year",
    )


# ------------------------------------------------------------------------------- lever


LEVER = [
    {
        "id": "5a1b2c3d-1111-2222-3333-444455556666",
        "text": "Product Manager",
        "hostedUrl": "https://jobs.lever.co/acme/5a1b2c3d-1111-2222-3333-444455556666",
        "applyUrl": "https://jobs.lever.co/acme/5a1b2c3d-1111-2222-3333-444455556666/apply",
        "workplaceType": "remote",
        "country": "NG",
        "descriptionPlain": "Own the roadmap.",
        "createdAt": 1762000000000,
        "categories": {"commitment": "Full-time", "department": "Product", "location": "Lagos"},
    }
]


async def test_lever_reads_each_named_company():
    seen: list[httpx.Request] = []
    jobs = await src.LeverSource(["acme", "globex"], feed(LEVER, seen=seen)).search({}, NOW)
    assert [r.url.path for r in seen] == ["/v0/postings/acme", "/v0/postings/globex"]
    assert seen[0].url.params["mode"] == "json"
    j = jobs[0]
    assert j.company == "Acme" and j.arrangement == "remote" and j.industry == "Product"
    assert j.application_url.endswith("/apply") and j.posted_at.year in (2025, 2026)


async def test_lever_can_read_a_pasted_link():
    s = src.LeverSource([], feed(LEVER[0]))
    got = await s.fetch("https://jobs.lever.co/acme/5a1b2c3d-1111-2222-3333-444455556666")
    assert got and got.title == "Product Manager"
    assert await s.fetch("https://example.com/job") is None


# -------------------------------------------------------------------------------- ashby


ASHBY = {
    "jobs": [
        {
            "id": "abc",
            "title": "Product Manager",
            "department": "Product",
            "location": "Remote - Africa",
            "isRemote": True,
            "isListed": True,
            "jobUrl": "https://jobs.ashbyhq.com/ramp/abc",
            "applyUrl": "https://jobs.ashbyhq.com/ramp/abc/application",
            "descriptionPlain": "Own onboarding.",
            "employmentType": "FullTime",
            "publishedAt": "2026-11-01T09:00:00.000+00:00",
        },
        {
            "id": "hid",
            "title": "Hidden",
            "isListed": False,
            "jobUrl": "https://jobs.ashbyhq.com/ramp/hid",
        },
    ]
}


async def test_ashby_keeps_only_listed_jobs():
    jobs = await src.AshbySource(["ramp"], feed(ASHBY)).search({}, NOW)
    assert [j.title for j in jobs] == ["Product Manager"]
    assert jobs[0].arrangement == "remote" and jobs[0].region == "Remote - Africa"


# ---------------------------------------------------------------------------- failures


@pytest.mark.parametrize(
    "status, code, transient",
    [(429, "unavailable", True), (503, "unavailable", True), (403, "rejected", False)],
)
async def test_a_feed_that_refuses_or_is_busy_is_an_explicit_error(status, code, transient):
    with pytest.raises(AdapterError) as e:
        await src.RemotiveSource(feed({}, status=status)).search({}, NOW)
    assert e.value.code == code and e.value.transient is transient


async def test_an_unreachable_feed_can_be_retried_and_garbage_cannot():
    def down(req):
        raise httpx.ConnectError("no", request=req)

    with pytest.raises(AdapterError) as e:
        await src.RemotiveSource(httpx.MockTransport(down)).search({}, NOW)
    assert e.value.code == "network" and e.value.transient
    bad = httpx.MockTransport(lambda r: httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(AdapterError) as e2:
        await src.RemoteOkSource(bad).search({}, NOW)
    assert e2.value.code == "rejected"


def test_dates_are_read_from_text_seconds_or_milliseconds():
    assert src.when("2026-11-01T10:00:00Z") == datetime(2026, 11, 1, 10, 0, tzinfo=UTC)
    assert src.when(1762000000) == src.when(1762000000000)
    assert src.when("nonsense") is None and src.when(None) is None


# -------------------------------------------------------------- many sources together


def test_several_sources_can_be_named_and_unknown_ones_are_refused(settings):
    settings.autoapply_discovery_sources = "remotive, arbeitnow ,remoteok,lever,ashby,greenhouse"
    settings.autoapply_lever_companies = "acme,globex"
    settings.autoapply_ashby_boards = "ramp"
    settings.autoapply_greenhouse_boards = "stripe"
    built = discovery.build_sources(settings)
    assert [s.name for s in built] == [
        "remotive",
        "arbeitnow",
        "remoteok",
        "lever",
        "ashby",
        "greenhouse",
    ]
    assert (
        built[3].companies == ["acme", "globex"]
        and built[4].boards == ["ramp"]
        and built[5].boards == ["stripe"]
    )
    assert all(s.broad for s in built)
    settings.autoapply_enabled = True
    settings.autoapply_discovery_sources = "remotive,monster"
    assert any("monster" in m for m in _autoapply_problems(settings))
    settings.autoapply_discovery_sources = "remotive,arbeitnow"
    assert _autoapply_problems(settings) == []


# ----------------------------------------------------------------------- thinning feeds


def test_a_big_feed_is_thinned_to_titles_that_could_be_a_wanted_role():
    assert matching.role_could_fit(CRIT, "Senior Product Manager")
    assert matching.role_could_fit(CRIT, "Product Manager, Payments")
    assert not matching.role_could_fit(CRIT, "Warehouse Operative")
    assert not matching.role_could_fit(CRIT, "Product Designer")  # only half the words match
    assert matching.role_could_fit({}, "Anything")  # no role chosen: nothing is filtered


class Wide:
    """A source that returns everything, like a big public feed."""

    name, broad = "wide", True

    def __init__(self, postings):
        self.postings = postings

    async def search(self, criteria, now):
        return list(self.postings)

    async def fetch(self, url):
        return None


async def test_unrelated_jobs_from_a_big_feed_never_become_applications(ada, tick, maker):
    from sqlalchemy import func, select

    from app.models import Application
    from app.routers.autoapply import get_sources
    from tests.autoapply.conftest import job, start

    wide = Wide(
        [
            job(1),
            job(2, title="Warehouse Operative"),
            job(3, title="Truck Driver"),
            job(4, title="Dishwasher"),
        ]
    )
    ada._transport.app.dependency_overrides[get_sources] = lambda: [wide]
    await start(ada)
    run = (await ada.post("/api/autoapply/discovery/run")).json()
    assert run["found"] == 1  # the three unrelated titles were dropped before anything was stored
    async with maker() as db:
        assert (await db.execute(select(func.count()).select_from(Application))).scalar_one() == 1


async def test_a_job_that_fits_but_needs_the_employers_own_site_is_prepared_for_you(ada):
    """It used to be skipped. A link we cannot fill in is not a dead end: the job is kept, the CV and
    note are prepared, and you submit it on the employer's own site."""
    from app.routers.autoapply import get_sources
    from tests.autoapply.conftest import apps, job, start

    onsite = job(1, application_url="https://careers.example.com/apply/1")  # not a form we can fill
    ada._transport.app.dependency_overrides[get_sources] = lambda: [Wide([onsite])]
    await start(ada)
    await ada.post("/api/autoapply/discovery/run")
    (a,) = await apps(ada)
    assert a["status"] == "apply_yourself" and a["channel"] == "manual"
    assert a["skip_reason"] is None
    assert a["posting"]["application_url"] == "https://careers.example.com/apply/1"
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    assert d["package"]["destination"] == {
        "channel": "manual",
        "url": "https://careers.example.com/apply/1",
    }
    assert d["package"]["cv"]["submitted_text"] and d["package"]["cover_text"]  # ready to use
    how = next(r for r in d["match"]["rules"] if r["key"] == "channel")
    assert "careers.example.com" in how["evidence"] and "you submit it there" in how["evidence"]
    assert "ready_for_you" in [h["kind"] for h in d["history"]]
    # nothing is ever sent for it by Auto-Apply
    assert d["attempts"] == []

    # it stays put when the search runs again, and the person can say they applied
    await ada.post("/api/autoapply/discovery/run")
    assert [x["status"] for x in await apps(ada)] == ["apply_yourself"]
    done = await ada.post(f"/api/autoapply/applications/{a['id']}/applied")
    assert done.status_code == 200 and done.json()["status"] == "applied_by_you"
    again = await ada.post(f"/api/autoapply/applications/{a['id']}/applied")
    assert again.status_code == 409 and again.json()["error"]["code"] == "not_waiting"
    await ada.post("/api/autoapply/discovery/run")
    assert [x["status"] for x in await apps(ada)] == ["applied_by_you"]  # never undone


async def test_a_job_with_no_link_and_no_email_is_still_skipped(ada):
    from app.routers.autoapply import get_sources
    from tests.autoapply.conftest import apps, job, start

    bare = job(1, application_url=None)
    ada._transport.app.dependency_overrides[get_sources] = lambda: [Wide([bare])]
    await start(ada)
    await ada.post("/api/autoapply/discovery/run")
    (a,) = await apps(ada)
    assert (
        a["status"] == "skipped"
        and "neither an email address nor an application link" in (a["skip_reason"])
    )


async def test_a_job_that_says_to_email_your_cv_is_applied_for_by_email(ada, maker):
    """The address is in the listing's own words: 'send your CV to ...'. It is kept with the sentence
    that says so, and the job goes by email even though its link is on a site we cannot fill in."""
    from sqlalchemy import select

    from app.models import JobPosting
    from app.routers.autoapply import get_sources
    from tests.autoapply.conftest import apps, job, start

    listing = job(
        1,
        application_url="https://careers.example.com/apply/1",
        description="Lead payments product. Remote. To apply, email your CV to careers@acme.test.",
    )
    ada._transport.app.dependency_overrides[get_sources] = lambda: [Wide([listing])]
    from tests.autoapply.conftest import connect_mailbox

    await start(ada)
    await connect_mailbox(ada)  # email on, with a mailbox to send from
    await ada.post("/api/autoapply/discovery/run")
    (a,) = await apps(ada)
    assert a["channel"] == "email" and a["status"] == "queued"
    async with maker() as db:
        p = (await db.execute(select(JobPosting))).scalar_one()
    assert p.apply_email == "careers@acme.test"
    assert "email your CV to careers@acme.test" in p.evidence["apply_email"]


async def test_the_same_job_from_two_feeds_is_one_application(ada, maker):
    from sqlalchemy import func, select

    from app.models import Application
    from app.routers.autoapply import get_sources
    from tests.autoapply.conftest import job, start

    a = job(1)
    b = job(
        1, source_url="https://other.feed.test/xyz", source="other"
    )  # same requisition, another feed
    ada._transport.app.dependency_overrides[get_sources] = lambda: [Wide([a]), Wide([b])]
    await start(ada)
    run = (await ada.post("/api/autoapply/discovery/run")).json()
    assert run["found"] == 2 and run["new"] == 1
    async with maker() as db:
        assert (await db.execute(select(func.count()).select_from(Application))).scalar_one() == 1


async def test_a_job_that_only_accepts_what_you_switched_off_is_handed_to_you_not_dropped(ada):
    """It says to email, you have email off, and it has a link: kept and prepared, not skipped."""
    from app.routers.autoapply import get_sources
    from tests.autoapply.conftest import apps, job, start

    listing = job(
        1,
        application_url="https://careers.example.com/apply/1",
        description="Lead payments product. Remote. To apply, email your CV to careers@acme.test.",
    )
    ada._transport.app.dependency_overrides[get_sources] = lambda: [Wide([listing])]
    await start(ada)  # email is off in this search
    await ada.post("/api/autoapply/discovery/run")
    (a,) = await apps(ada)
    assert a["status"] == "apply_yourself" and a["channel"] == "manual"
    d = (await ada.get(f"/api/autoapply/applications/{a['id']}")).json()
    how = next(r for r in d["match"]["rules"] if r["key"] == "channel")
    assert "switched off in your search" in how["evidence"]
