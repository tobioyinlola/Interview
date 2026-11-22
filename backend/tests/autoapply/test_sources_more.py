"""The second set of job sources, against sample responses in each feed's format. None has been run
against its live service from here (no outbound network)."""

from datetime import UTC, datetime

import httpx
import pytest

from app.autoapply import discovery
from app.autoapply import sources_more as more
from app.autoapply.adapters import AdapterError
from app.config import Settings

NOW = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


def reply(body, status=200, seen=None):
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        if isinstance(body, bytes | str):
            return httpx.Response(status, content=body)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler)


async def test_jobicy():
    body = {
        "jobs": [
            {
                "id": 5,
                "url": "https://jobicy.com/jobs/5-pm",
                "jobTitle": "Product Manager",
                "companyName": "Acme",
                "jobGeo": "Anywhere",
                "jobType": ["full-time"],
                "jobIndustry": ["Product"],
                "jobDescription": "<p>Lead <b>it</b></p>",
                "pubDate": "2026-11-01T08:00:00+00:00",
                "salaryMin": 90000,
                "salaryMax": 120000,
                "salaryCurrency": "USD",
                "salaryPeriod": "yearly",
            },
            {"id": 6, "url": "", "jobTitle": "No link"},
        ]
    }
    jobs = await more.JobicySource(reply(body)).search({}, NOW)
    assert len(jobs) == 1
    j = jobs[0]
    assert j.company == "Acme" and j.arrangement == "remote" and j.salary_min == 90000
    assert "<" not in j.description and j.requisition_id == "jobicy-5"


async def test_himalayas_pages_until_short():
    seen: list[httpx.Request] = []
    rows = [
        {
            "title": f"Role {i}",
            "companyName": "Co",
            "applicationLink": f"https://himalayas.app/j/{i}",
            "guid": f"g{i}",
            "locationRestrictions": ["Nigeria"],
            "pubDate": 1793000000,
        }
        for i in range(3)
    ]
    jobs = await more.HimalayasSource(reply({"jobs": rows}, seen=seen)).search({}, NOW)
    assert len(seen) == 1 and len(jobs) == 3 and jobs[0].region == "Nigeria"


async def test_muse_and_working_nomads():
    muse = {
        "results": [
            {
                "id": 1,
                "name": "Designer",
                "company": {"name": "Muse Co"},
                "locations": [{"name": "Flexible / Remote"}],
                "refs": {"landing_page": "https://www.themuse.com/jobs/1"},
                "contents": "<p>Design</p>",
                "publication_date": "2026-11-01T00:00:00Z",
            }
        ]
    }
    (m,) = await more.MuseSource(reply(muse)).search({}, NOW)
    assert m.company == "Muse Co" and m.arrangement == "remote"
    nomads = [
        {
            "url": "https://www.workingnomads.com/jobs/x",
            "title": "Dev",
            "company_name": "N",
            "description": "<b>hi</b>",
            "pub_date": "2026-11-01T00:00:00Z",
        }
    ]
    (n,) = await more.WorkingNomadsSource(reply(nomads)).search({}, NOW)
    assert n.region == "Anywhere" and n.description == "hi"


RSS = """<?xml version="1.0"?><rss><channel><item>
<title>Acme: Senior PM</title><link>https://weworkremotely.com/jobs/1</link>
<region>Anywhere in the World</region><category>Product</category><type>Full-Time</type>
<pubDate>Mon, 02 Nov 2026 09:00:00 +0000</pubDate><description>&lt;p&gt;Lead&lt;/p&gt;</description>
</item></channel></rss>"""


async def test_weworkremotely_splits_company_from_title():
    (j,) = await more.WeWorkRemotelySource(reply(RSS)).search({}, NOW)
    assert j.company == "Acme" and j.title == "Senior PM" and j.description == "Lead"
    assert j.posted_at is not None


async def test_xml_with_entity_tricks_is_refused():
    bomb = (
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><rss>&b;</rss>'
    )
    with pytest.raises(AdapterError):
        await more.WeWorkRemotelySource(reply(bomb)).search({}, NOW)


async def test_smartrecruiters_reads_each_posting_once():
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.url.path.endswith("/postings"):
            return httpx.Response(
                200,
                json={
                    "content": [
                        {
                            "id": "77",
                            "name": "Analyst",
                            "company": {"name": "Big Co"},
                            "location": {"city": "Lagos", "country": "ng", "remote": False},
                            "typeOfEmployment": {"label": "Full-time"},
                            "releasedDate": "2026-11-01T00:00:00Z",
                        }
                    ]
                },
            )
        return httpx.Response(
            200, json={"jobAd": {"sections": {"jobDescription": {"text": "<p>Numbers</p>"}}}}
        )

    (j,) = await more.SmartRecruitersSource(["bigco"], httpx.MockTransport(handler)).search({}, NOW)
    assert len(seen) == 2 and j.description == "Numbers" and j.region == "Lagos, NG"
    assert j.source_url == "https://jobs.smartrecruiters.com/bigco/77"


async def test_recruitee_workable_personio():
    rec = {
        "offers": [
            {
                "id": 1,
                "title": "Ops",
                "careers_url": "https://a.recruitee.com/o/1",
                "city": "Berlin",
                "country": "Germany",
                "remote": True,
                "description": "<p>x</p>",
            }
        ]
    }
    (r,) = await more.RecruiteeSource(["a"], reply(rec)).search({}, NOW)
    assert r.arrangement == "remote" and r.region == "Berlin, Germany"
    wk = {
        "name": "Wk Co",
        "jobs": [
            {
                "title": "QA",
                "shortcode": "AB1",
                "url": "https://apply.workable.com/wk/j/AB1/",
                "city": "Accra",
                "country": "Ghana",
                "description": "<p>t</p>",
            }
        ],
    }
    (w,) = await more.WorkableSource(["wk"], reply(wk)).search({}, NOW)
    assert w.company == "Wk Co" and w.region == "Accra, Ghana"
    xml = """<workzag-jobs><position><id>9</id><name>HR Lead</name><office>Munich</office>
    <department>People</department><employmentType>permanent</employmentType>
    <jobDescriptions><jobDescription><name>Tasks</name><value>&lt;p&gt;Hire&lt;/p&gt;</value></jobDescription></jobDescriptions>
    <createdAt>2026-11-01T00:00:00+00:00</createdAt></position></workzag-jobs>"""
    (p,) = await more.PersonioSource(["pco"], reply(xml)).search({}, NOW)
    assert p.title == "HR Lead" and p.description == "Hire" and p.source_url.endswith("/job/9")


async def test_busy_source_is_transient():
    with pytest.raises(AdapterError) as e:
        await more.JobicySource(reply({}, status=429)).search({}, NOW)
    assert e.value.transient


def test_all_are_built_by_name_and_labelled():
    names = ",".join([*discovery.MORE_BROAD, *discovery.MORE_COMPANY])
    s = Settings(autoapply_discovery_sources=names, autoapply_recruitee_companies="a")
    built = discovery.build_sources(s)
    assert len(built) == 9
    assert len(discovery.source_labels(s)) == 9
    assert all(n in discovery.KNOWN_SOURCES for n in names.split(","))
