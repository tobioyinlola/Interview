import asyncio
import re
import uuid

import pytest
from sqlalchemy import func, select

from app.adapters.interfaces import ProviderNotConfigured
from app.models import (
    Company,
    CompanyBrief,
    CompanySource,
    PracticeSession,
    ResearchJob,
    Usage,
)
from tests.helpers import ScriptedLlm, good_reply

FORM = {"name": "Acme", "website_url": "https://acme.com/", "role": "Backend Engineer"}


async def create(client, runner, **over):
    r = await client.post("/api/companies", json={**FORM, **over})
    await runner.wait_idle()
    return r


async def count(db, model):
    return int((await db.execute(select(func.count()).select_from(model))).scalar_one())


@pytest.fixture
async def alice(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        yield c


# ------------------------------------------------------------------ create + read


async def test_create_starts_research_and_produces_a_cited_brief(alice, runner):
    r = await create(alice, runner)
    assert r.status_code == 201
    body = r.json()
    cid = body["company"]["id"]
    assert body["company"]["name"] == "Acme" and body["job_id"]

    status = (await alice.get(f"/api/companies/{cid}/research/status")).json()
    assert status["status"] == "ready" and status["error"] is None

    detail = (await alice.get(f"/api/companies/{cid}")).json()
    assert detail["brief_version"] == 1 and detail["job"]["status"] == "ready"
    source_ids = {s["id"] for s in detail["sources"]}
    snapshot = next(s for s in detail["brief"]["sections"] if s["key"] == "snapshot")
    assert snapshot["facts"] and not snapshot["not_found"]
    assert set(snapshot["facts"][0]["source_ids"]) <= source_ids
    assert detail["company"]["last_researched_at"]

    listed = (await alice.get("/api/companies")).json()
    assert listed[0]["id"] == cid and listed[0]["job_status"] == "ready"


async def test_detail_shows_per_link_status_but_never_page_text(alice, runner, fetcher):
    fetcher.results.clear()  # every link is blocked
    cid = (await create(alice, runner, job_posting_url="https://acme.com/jobs")).json()["company"][
        "id"
    ]
    detail = (await alice.get(f"/api/companies/{cid}")).json()
    by_kind = {s["kind"]: s for s in detail["sources"]}
    assert by_kind["website"]["status"] == "blocked" and by_kind["website"]["reason"]
    assert by_kind["job_posting"]["status"] == "blocked"
    assert all("extracted_text" not in s for s in detail["sources"])
    assert detail["job"]["status"] == "failed"
    assert "No readable sources" in detail["job"]["error"]


async def test_brief_is_absent_before_research_finishes(alice, runner, llm):
    gate = asyncio.Event()

    class Slow(ScriptedLlm):
        async def generate_json(self, **kw):
            await gate.wait()
            return await super().generate_json(**kw)

    runner.llm = Slow(good_reply)
    r = await alice.post("/api/companies", json=FORM)
    cid = r.json()["company"]["id"]
    await asyncio.sleep(0.2)
    mid = (await alice.get(f"/api/companies/{cid}")).json()
    assert mid["brief"] is None and mid["job"]["status"] == "writing"
    gate.set()
    await runner.wait_idle()
    assert (await alice.get(f"/api/companies/{cid}")).json()["brief"] is not None


async def test_status_before_any_research_is_a_clear_404(alice, db):
    # A company created straight in the database has no job.
    from app.models import User

    user = (await db.execute(select(User))).scalar_one()
    c = Company(user_id=user.id, name="Bare")
    db.add(c)
    await db.commit()
    r = await alice.get(f"/api/companies/{c.id}/research/status")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_research"


# ---------------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "field,value,label",
    [
        ("website_url", "http://localhost/", "Website"),
        ("website_url", "http://127.0.0.1:80/", "Website"),
        ("website_url", "http://169.254.169.254/latest/meta-data/", "Website"),
        ("website_url", "ftp://acme.com/", "Website"),
        ("website_url", "file:///etc/passwd", "Website"),
        ("website_url", "https://user:pw@acme.com/", "Website"),
        ("website_url", "https://acme.com:8443/", "Website"),
        ("website_url", "https://private-intranet.example.com/", "Website"),  # resolves private
        ("job_posting_url", "http://10.1.2.3/jobs", "Job posting link"),
        ("job_posting_url", "https://www.linkedin.com/in/someone", "Job posting link"),
    ],
)
async def test_unsafe_links_are_rejected_with_a_clear_message_and_nothing_is_created(
    alice, runner, db, field, value, label
):
    r = await alice.post("/api/companies", json={**FORM, field: value})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_url" and err["message"].startswith(label)
    assert await count(db, Company) == 0 and await count(db, ResearchJob) == 0
    assert await count(db, Usage) == 0  # a rejected link does not use up the daily cap


async def test_extra_links_are_each_checked(alice, db):
    r = await alice.post(
        "/api/companies",
        json={**FORM, "extra_links": ["https://acme.com/about", "http://192.168.0.1/"]},
    )
    assert r.status_code == 422 and r.json()["error"]["message"].startswith("Extra link 2")


@pytest.mark.parametrize(
    "patch",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"extra_links": ["https://a.com", "https://b.com", "https://c.com", "https://d.com"]},
        {"known_text": "x" * 2001},
        {"role": "x" * 201},
    ],
)
async def test_form_limits_are_enforced(alice, db, patch):
    r = await alice.post("/api/companies", json={**FORM, **patch})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    assert await count(db, Company) == 0


async def test_boundary_values_are_accepted(alice, runner):
    r = await create(
        alice,
        runner,
        name="x" * 120,
        known_text="y" * 2000,
        extra_links=["https://a.com/1", "https://a.com/2", "https://a.com/3"],
    )
    assert r.status_code == 201


async def test_optional_links_may_be_blank(alice, runner):
    r = await create(alice, runner, website_url="", job_posting_url=None)
    assert r.status_code == 201
    assert r.json()["company"]["website_url"] is None


async def test_links_are_stored_normalised(alice, runner):
    r = await create(alice, runner, website_url="HTTPS://Acme.COM/About#team")
    assert r.json()["company"]["website_url"] == "https://acme.com/About"


# ------------------------------------------------------------------ idempotency/cap


async def test_a_retried_create_with_the_same_key_does_not_start_two_jobs(alice, runner, db):
    h = {"idempotency-key": "save-1"}
    a = await alice.post("/api/companies", json=FORM, headers=h)
    b = await alice.post("/api/companies", json=FORM, headers=h)
    await runner.wait_idle()
    assert a.json() == b.json()
    assert await count(db, Company) == 1 and await count(db, ResearchJob) == 1
    assert (await db.execute(select(Usage.research_jobs))).scalar_one() == 1


async def test_daily_research_cap_blocks_new_jobs(alice, runner, db, settings):
    settings.cap_research_jobs_daily = 2
    await create(alice, runner, name="One")
    await create(alice, runner, name="Two")
    r = await alice.post("/api/companies", json={**FORM, "name": "Three"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "daily_cap"
    assert await count(db, Company) == 2  # the blocked company was not saved


async def test_re_research_counts_against_the_cap_too(alice, runner, settings):
    settings.cap_research_jobs_daily = 2
    cid = (await create(alice, runner)).json()["company"]["id"]
    ok = await alice.post(f"/api/companies/{cid}/research")
    await runner.wait_idle()
    blocked = await alice.post(f"/api/companies/{cid}/research")
    assert ok.status_code == 202 and blocked.status_code == 429


async def test_parallel_requests_cannot_exceed_the_cap(alice, runner, db, settings):
    settings.cap_research_jobs_daily = 3
    results = await asyncio.gather(
        *[alice.post("/api/companies", json={**FORM, "name": f"Co {i}"}) for i in range(8)]
    )
    await runner.wait_idle()
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 3 and codes.count(429) == 5
    assert (await db.execute(select(Usage.research_jobs))).scalar_one() == 3


async def test_the_cap_is_per_user(new_client, sign_in, runner, settings):
    settings.cap_research_jobs_daily = 1
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        assert (await a.post("/api/companies", json=FORM)).status_code == 201
        assert (await a.post("/api/companies", json=FORM)).status_code == 429
        assert (await b.post("/api/companies", json=FORM)).status_code == 201
        await runner.wait_idle()


# ---------------------------------------------------------------------- re-research


async def test_rerun_while_running_returns_the_same_job(alice, runner):
    gate = asyncio.Event()

    class Slow(ScriptedLlm):
        async def generate_json(self, **kw):
            await gate.wait()
            return await super().generate_json(**kw)

    runner.llm = Slow(good_reply)
    first = (await alice.post("/api/companies", json=FORM)).json()
    await asyncio.sleep(0.1)
    again = await alice.post(f"/api/companies/{first['company']['id']}/research")
    assert again.status_code == 202 and again.json()["job_id"] == first["job_id"]
    gate.set()
    await runner.wait_idle()


async def test_rerun_after_finish_starts_a_fresh_job_and_new_brief_version(alice, runner, db):
    cid = (await create(alice, runner)).json()["company"]["id"]
    r = await alice.post(f"/api/companies/{cid}/research")
    await runner.wait_idle()
    assert r.status_code == 202
    detail = (await alice.get(f"/api/companies/{cid}")).json()
    assert detail["brief_version"] == 2
    assert await count(db, ResearchJob) == 2


# ----------------------------------------------- the blocked-page recovery flow


async def test_blocked_page_then_paste_text_then_research_again(alice, runner, fetcher, llm):
    fetcher.results.clear()  # the website cannot be read
    cid = (await create(alice, runner)).json()["company"]["id"]
    assert (await alice.get(f"/api/companies/{cid}/research/status")).json()["status"] == "failed"

    pasted = await alice.post(
        f"/api/companies/{cid}/sources/paste",
        json={"title": "Careers page", "text": "We hire Rust engineers in Berlin."},
    )
    assert pasted.status_code == 201
    assert pasted.json()["kind"] == "pasted" and pasted.json()["status"] == "ok"

    def reply(user):
        sid = re.search(r'<source id="(\d+)" kind="pasted"', user).group(1)
        return {"the_role": [{"text": "Hires Rust engineers.", "source_ids": [int(sid)]}]}

    runner.llm = ScriptedLlm(reply)
    again = await alice.post(f"/api/companies/{cid}/research")
    await runner.wait_idle()
    assert again.status_code == 202
    detail = (await alice.get(f"/api/companies/{cid}")).json()
    assert detail["job"]["status"] == "ready"
    role = next(s for s in detail["brief"]["sections"] if s["key"] == "the_role")
    assert role["facts"][0]["label"] == "pasted_by_you"
    assert any(s["kind"] == "pasted" and s["title"] == "Careers page" for s in detail["sources"])


async def test_paste_validation(alice, runner):
    cid = (await create(alice, runner)).json()["company"]["id"]
    for body in ({"text": ""}, {"text": "   "}, {"text": "x" * 50_001}):
        r = await alice.post(f"/api/companies/{cid}/sources/paste", json=body)
        assert r.status_code == 422
    ok = await alice.post(f"/api/companies/{cid}/sources/paste", json={"text": "x" * 50_000})
    assert ok.status_code == 201 and ok.json()["title"] == "Pasted text"


async def test_removed_source_disappears_and_is_not_used_again(alice, runner, llm):
    cid = (await create(alice, runner)).json()["company"]["id"]
    s = (
        await alice.post(
            f"/api/companies/{cid}/sources/paste", json={"title": "Wrong", "text": "BAD CLAIM"}
        )
    ).json()
    assert (await alice.delete(f"/api/companies/{cid}/sources/{s['id']}")).status_code == 200
    detail = (await alice.get(f"/api/companies/{cid}")).json()
    assert all(x["id"] != s["id"] for x in detail["sources"])
    await alice.post(f"/api/companies/{cid}/research")
    await runner.wait_idle()
    assert all("BAD CLAIM" not in p for p in llm.prompts)


async def test_failed_job_surfaces_a_plain_error(alice, runner):
    runner.llm = ScriptedLlm(lambda u: ProviderNotConfigured("The OpenAI key is not configured."))
    cid = (await create(alice, runner)).json()["company"]["id"]
    st = (await alice.get(f"/api/companies/{cid}/research/status")).json()
    assert st["status"] == "failed" and "not configured" in st["error"]


# ----------------------------------------------------------------- edit and delete


async def test_editing_a_company_validates_links_and_does_not_start_research(alice, runner, db):
    cid = (await create(alice, runner)).json()["company"]["id"]
    jobs_before = await count(db, ResearchJob)
    ok = await alice.put(
        f"/api/companies/{cid}", json={**FORM, "name": "Acme Inc", "role": "Staff Engineer"}
    )
    bad = await alice.put(f"/api/companies/{cid}", json={**FORM, "website_url": "http://localhost"})
    assert ok.status_code == 200 and ok.json()["name"] == "Acme Inc"
    assert bad.status_code == 422
    assert (await alice.get(f"/api/companies/{cid}")).json()["company"]["role"] == "Staff Engineer"
    assert await count(db, ResearchJob) == jobs_before


async def test_a_page_removed_from_the_form_stops_being_a_source(alice, runner, fetcher, llm):
    cid = (await create(alice, runner)).json()["company"]["id"]
    assert "payment software" in llm.prompts[0]
    await alice.put(f"/api/companies/{cid}", json={"name": "Acme", "website_url": None})
    fetcher.results.clear()
    await alice.post(f"/api/companies/{cid}/research")
    await runner.wait_idle()
    st = (await alice.get(f"/api/companies/{cid}/research/status")).json()
    assert st["status"] == "failed"  # the old website text is not silently reused


async def test_deleting_a_company_removes_its_research_and_unlinks_sessions(alice, runner, db):
    cid = (await create(alice, runner)).json()["company"]["id"]
    sid = (await alice.post("/api/sessions", json={"consent": True, "company_id": cid})).json()[
        "session_id"
    ]
    assert (await alice.delete(f"/api/companies/{cid}")).status_code == 200
    for model in (Company, CompanySource, CompanyBrief, ResearchJob):
        assert await count(db, model) == 0, model.__name__
    session = await db.get(PracticeSession, uuid.UUID(sid))
    assert session is not None and session.company_id is None  # history survives
    assert (await alice.get(f"/api/companies/{cid}")).status_code == 404


# ------------------------------------------------------------------- access control


async def test_one_user_cannot_touch_anothers_company(new_client, sign_in, runner, db):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        cid = (await create(a, runner)).json()["company"]["id"]
        src = (await a.get(f"/api/companies/{cid}")).json()["sources"][0]["id"]

        probes = [
            await b.get(f"/api/companies/{cid}"),
            await b.put(f"/api/companies/{cid}", json=FORM),
            await b.delete(f"/api/companies/{cid}"),
            await b.post(f"/api/companies/{cid}/research"),
            await b.get(f"/api/companies/{cid}/research/status"),
            await b.post(f"/api/companies/{cid}/sources/paste", json={"text": "x"}),
            await b.delete(f"/api/companies/{cid}/sources/{src}"),
        ]
        assert [p.status_code for p in probes] == [404] * 7
        assert (await b.get("/api/companies")).json() == []
        # ...and nothing of A's was changed by those attempts
        assert await count(db, Company) == 1
        assert (await a.get(f"/api/companies/{cid}")).json()["job"]["status"] == "ready"
        assert len((await a.get(f"/api/companies/{cid}")).json()["sources"]) >= 1


async def test_a_source_id_cannot_be_deleted_through_a_different_company(alice, runner):
    c1 = (await create(alice, runner, name="One")).json()["company"]["id"]
    c2 = (await create(alice, runner, name="Two")).json()["company"]["id"]
    s1 = (await alice.get(f"/api/companies/{c1}")).json()["sources"][0]["id"]
    r = await alice.delete(f"/api/companies/{c2}/sources/{s1}")
    assert r.status_code == 404
    assert any(s["id"] == s1 for s in (await alice.get(f"/api/companies/{c1}")).json()["sources"])


async def test_companies_need_sign_in_and_the_csrf_header(new_client, app):
    import httpx

    async with new_client() as anon:
        assert (await anon.get("/api/companies")).status_code == 401
        assert (await anon.post("/api/companies", json=FORM)).status_code == 401
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as no_csrf:
        assert (await no_csrf.post("/api/companies", json=FORM)).status_code == 403


async def test_malformed_ids_are_rejected_cleanly(alice):
    r = await alice.get("/api/companies/not-a-uuid")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    assert (await alice.get(f"/api/companies/{uuid.uuid4()}")).status_code == 404
