import uuid

import pytest
from sqlalchemy import select

from app.models import Company, CompanyBrief, CompanySource, PracticeSession, User
from app.schemas.brief import BriefContent, BriefFact, BriefSection
from app.services.brief_edit import (
    EditError,
    FactEdit,
    apply_edits,
    carry_over,
    protected_source_ids,
    remove_source,
)
from tests.helpers import ScriptedLlm

S1, S2 = uuid.uuid4(), uuid.uuid4()


def fact(text, sources=(), **kw):
    return BriefFact(id=uuid.uuid4(), text=text, source_ids=list(sources), **kw)


def brief(**sections):
    keys = [
        "snapshot", "products_customers", "recent_news", "culture_values",
        "the_role", "interview_process", "likely_questions", "questions_to_ask",
    ]  # fmt: skip
    return BriefContent(
        sections=[
            BriefSection(key=k, title=k, facts=sections.get(k, []), not_found=not sections.get(k))
            for k in keys
        ]
    )


def sec(b, key):
    return next(s for s in b.sections if s.key == key)


# ------------------------------------------------------------------ service


def test_adding_a_fact_labels_it_from_you_and_clears_not_found():
    b = brief()
    apply_edits(b, [FactEdit(section_key="snapshot", text="  They use Kafka. ", pinned=True)])
    f = sec(b, "snapshot").facts[0]
    assert (f.text, f.label, f.source_ids, f.pinned, f.edited_by_user) == (
        "They use Kafka.", "from_you", [], True, True,
    )  # fmt: skip
    assert sec(b, "snapshot").not_found is False


def test_editing_text_marks_it_edited_but_pinning_alone_does_not():
    f = fact("Old text", [S1])
    b = brief(snapshot=[f])
    apply_edits(b, [FactEdit(section_key="snapshot", id=f.id, text="Old text", pinned=True)])
    assert f.pinned and not f.edited_by_user
    apply_edits(b, [FactEdit(section_key="snapshot", id=f.id, text="New text", pinned=True)])
    assert f.text == "New text" and f.edited_by_user and f.source_ids == [S1]  # source kept


def test_deleting_a_fact_restores_not_found():
    f = fact("x", [S1])
    b = brief(snapshot=[f])
    apply_edits(b, [FactEdit(section_key="snapshot", id=f.id, text="", delete=True)])
    assert sec(b, "snapshot").facts == [] and sec(b, "snapshot").not_found


@pytest.mark.parametrize(
    "edit,code",
    [
        (FactEdit(section_key="nope", text="x"), "invalid_section"),
        (FactEdit(section_key="snapshot", text="   "), "empty_fact"),
        (FactEdit(section_key="snapshot", id=uuid.uuid4(), text="x"), "fact_not_found"),
        (FactEdit(section_key="snapshot", id=uuid.uuid4(), text="", delete=True), "fact_not_found"),
        (FactEdit(section_key="snapshot", text="x", delete=True), "fact_not_found"),
    ],
)
def test_bad_edits_are_refused_with_a_code(edit, code):
    with pytest.raises(EditError) as e:
        apply_edits(brief(), [edit])
    assert e.value.code == code


def test_a_full_section_refuses_more_facts():
    b = brief(snapshot=[fact(f"f{i}", [S1]) for i in range(60)])
    with pytest.raises(EditError) as e:
        apply_edits(b, [FactEdit(section_key="snapshot", text="one more")])
    assert e.value.code == "too_many_facts"


def test_a_failed_edit_in_a_batch_is_reported_even_after_earlier_ones_applied():
    # The router discards the whole batch on error (nothing is saved), so partial application of
    # the in-memory copy is never persisted.
    b = brief()
    with pytest.raises(EditError):
        apply_edits(
            b, [FactEdit(section_key="snapshot", text="ok"), FactEdit(section_key="x", text="y")]
        )


def test_removing_a_source_drops_researched_facts_that_cited_only_it():
    only1 = fact("only S1", [S1])
    both = fact("S1 and S2", [S1, S2])
    mine = fact("my own", [], label="from_you", edited_by_user=True)
    edited = fact("I edited this", [S1], edited_by_user=True)
    q = fact("A question?", [S1], label="suggestion")
    b = brief(snapshot=[only1, both, mine, edited], likely_questions=[q])
    remove_source(b, S1)
    texts = [f.text for f in sec(b, "snapshot").facts]
    assert texts == ["S1 and S2", "my own", "I edited this"]
    assert both.source_ids == [S2] and edited.source_ids == []
    assert sec(b, "likely_questions").facts == [q]  # suggestions need no source


def test_removing_the_last_fact_marks_the_section_not_found():
    b = brief(snapshot=[fact("x", [S1])])
    remove_source(b, S1)
    assert sec(b, "snapshot").not_found


def test_carry_over_keeps_pins_edits_and_own_facts_and_nothing_else():
    pinned = fact("Pinned researched fact", [S1], pinned=True)
    edited = fact("Edited wording", [S1], edited_by_user=True)
    mine = fact("My own fact", [], label="from_you", edited_by_user=True)
    plain = fact("Plain old fact", [S1])
    old = brief(snapshot=[pinned, edited, plain], culture_values=[mine])
    fresh = brief(snapshot=[fact("Fresh fact", [S2])])
    out = carry_over(old, fresh)
    assert [f.text for f in sec(out, "snapshot").facts] == [
        "Fresh fact", "Pinned researched fact", "Edited wording",
    ]  # fmt: skip
    assert [f.text for f in sec(out, "culture_values").facts] == ["My own fact"]
    assert sec(out, "culture_values").not_found is False
    assert "Plain old fact" not in [f.text for s in out.sections for f in s.facts]


def test_a_pinned_fact_that_research_found_again_is_merged_not_duplicated():
    old = brief(snapshot=[fact("Acme sells POS.", [S1], pinned=True)])
    fresh = brief(snapshot=[fact("acme sells pos.", [S2])])
    out = carry_over(old, fresh)
    facts = sec(out, "snapshot").facts
    assert len(facts) == 1 and facts[0].pinned and facts[0].source_ids == [S2]


def test_carry_over_with_no_previous_brief_is_a_no_op():
    fresh = brief(snapshot=[fact("x", [S1])])
    assert carry_over(None, fresh) is fresh


def test_protected_sources_are_those_cited_by_kept_facts():
    b = brief(snapshot=[fact("a", [S1], pinned=True), fact("b", [S2])])
    assert protected_source_ids(b) == {S1} and protected_source_ids(None) == set()


# ---------------------------------------------------------------------- API


@pytest.fixture
async def alice(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        yield c


async def researched(alice, runner, **over):
    r = await alice.post(
        "/api/companies", json={"name": "Acme", "website_url": "https://acme.com/", **over}
    )
    await runner.wait_idle()
    return r.json()["company"]["id"]


async def detail(alice, cid):
    return (await alice.get(f"/api/companies/{cid}")).json()


def snapshot(d):
    return next(s for s in d["brief"]["sections"] if s["key"] == "snapshot")


async def test_edit_pin_add_and_delete_through_the_api(alice, runner):
    cid = await researched(alice, runner)
    fid = snapshot(await detail(alice, cid))["facts"][0]["id"]

    r = await alice.put(
        f"/api/companies/{cid}/brief",
        json={
            "facts": [
                {
                    "id": fid,
                    "section_key": "snapshot",
                    "text": "Acme builds payments software.",
                    "pinned": True,
                },
                {"section_key": "culture_values", "text": "My friend says it is fast-paced."},
            ]
        },
    )
    assert r.status_code == 200
    d = await detail(alice, cid)
    f = snapshot(d)["facts"][0]
    assert (f["text"], f["pinned"], f["edited_by_user"]) == (
        "Acme builds payments software.",
        True,
        True,
    )
    assert f["source_ids"]  # a researched fact keeps its source
    cv = next(s for s in d["brief"]["sections"] if s["key"] == "culture_values")
    assert cv["facts"][0]["label"] == "from_you" and cv["not_found"] is False

    await alice.put(
        f"/api/companies/{cid}/brief",
        json={"facts": [{"id": fid, "section_key": "snapshot", "text": "", "delete": True}]},
    )
    assert snapshot(await detail(alice, cid))["not_found"] is True


async def test_edits_validate_and_never_half_apply(alice, runner):
    cid = await researched(alice, runner)
    before = await detail(alice, cid)
    fid = snapshot(before)["facts"][0]["id"]
    bad = await alice.put(
        f"/api/companies/{cid}/brief",
        json={
            "facts": [
                {"id": fid, "section_key": "snapshot", "text": "CHANGED"},
                {"section_key": "bogus", "text": "x"},
            ]
        },
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_section"
    assert (
        snapshot(await detail(alice, cid))["facts"][0]["text"]
        == snapshot(before)["facts"][0]["text"]
    )
    for body in ({"facts": []}, {}, {"facts": [{"section_key": "snapshot", "text": "x" * 501}]}):
        assert (await alice.put(f"/api/companies/{cid}/brief", json=body)).status_code == 422


async def test_no_brief_yet_is_a_clear_404(alice, db):
    user = (await db.execute(select(User))).scalar_one()
    c = Company(user_id=user.id, name="Bare")
    db.add(c)
    await db.commit()
    r = await alice.put(
        f"/api/companies/{c.id}/brief", json={"facts": [{"section_key": "snapshot", "text": "x"}]}
    )
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_brief"


async def test_another_users_brief_cannot_be_edited(new_client, sign_in, runner):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        cid = await researched(a, runner)
        fid = snapshot(await detail(a, cid))["facts"][0]["id"]
        r = await b.put(
            f"/api/companies/{cid}/brief",
            json={
                "facts": [{"id": fid, "section_key": "snapshot", "text": "HACKED", "pinned": True}]
            },
        )
        assert r.status_code == 404
        assert snapshot(await detail(a, cid))["facts"][0]["text"] != "HACKED"


async def test_a_brief_a_session_used_is_versioned_not_overwritten(alice, runner, db):
    cid = await researched(alice, runner)
    sid = (await alice.post("/api/sessions", json={"consent": True, "company_id": cid})).json()[
        "session_id"
    ]
    used = (await db.execute(select(PracticeSession.brief_id))).scalar_one()
    original = (await db.get(CompanyBrief, used)).content["sections"][0]["facts"][0]["text"]

    await alice.put(
        f"/api/companies/{cid}/brief",
        json={"facts": [{"section_key": "snapshot", "text": "Added after the session started"}]},
    )
    db.expire_all()
    rows = (await db.execute(select(CompanyBrief).order_by(CompanyBrief.version))).scalars().all()
    assert [(r.version, r.is_current) for r in rows] == [(1, False), (2, True)]
    assert (
        rows[0].content["sections"][0]["facts"][0]["text"] == original
    )  # the session's brief is untouched
    assert len(rows[0].content["sections"][0]["facts"]) == 1
    assert len(rows[1].content["sections"][0]["facts"]) == 2
    assert sid


async def test_an_unused_brief_is_edited_in_place(alice, runner, db):
    cid = await researched(alice, runner)
    for i in range(3):
        await alice.put(
            f"/api/companies/{cid}/brief",
            json={"facts": [{"section_key": "snapshot", "text": f"fact {i}"}]},
        )
    db.expire_all()
    assert len((await db.execute(select(CompanyBrief))).scalars().all()) == 1  # no version spam


async def test_removing_a_source_removes_facts_that_only_it_supported(alice, runner):
    cid = await researched(alice, runner)
    d = await detail(alice, cid)
    sid = snapshot(d)["facts"][0]["source_ids"][0]
    await alice.put(
        f"/api/companies/{cid}/brief",
        json={"facts": [{"section_key": "culture_values", "text": "Mine stays."}]},
    )
    assert (await alice.delete(f"/api/companies/{cid}/sources/{sid}")).status_code == 200
    d = await detail(alice, cid)
    assert snapshot(d)["not_found"] is True  # the researched fact lost its only source
    cv = next(s for s in d["brief"]["sections"] if s["key"] == "culture_values")
    assert [f["text"] for f in cv["facts"]] == ["Mine stays."]
    for s in d["brief"]["sections"]:  # invariant: every researched fact still cites a live source
        for f in s["facts"]:
            if f["label"] not in ("suggestion", "from_you") and not f["edited_by_user"]:
                assert f["source_ids"]


# ------------------------------------------------- refresh keeps the user's work


async def test_refresh_keeps_pins_edits_added_facts_and_pasted_sources(alice, runner, llm):
    cid = await researched(alice, runner)
    d = await detail(alice, cid)
    fid = snapshot(d)["facts"][0]["id"]
    await alice.put(
        f"/api/companies/{cid}/brief",
        json={
            "facts": [
                {
                    "id": fid,
                    "section_key": "snapshot",
                    "text": "Acme builds payments software (my wording).",
                    "pinned": True,
                },
                {"section_key": "interview_process", "text": "Two rounds, per my friend."},
            ]
        },
    )
    paste = (
        await alice.post(
            f"/api/companies/{cid}/sources/paste", json={"title": "Jobs", "text": "We hire."}
        )
    ).json()

    runner.llm = ScriptedLlm(
        lambda u: {"snapshot": [{"text": "Fresh fact from the new run.", "source_ids": [1]}]}
    )
    assert (await alice.post(f"/api/companies/{cid}/research")).status_code == 202
    await runner.wait_idle()

    d = await detail(alice, cid)
    assert d["brief_version"] == 2  # a refresh saves a new brief version
    texts = [f["text"] for f in snapshot(d)["facts"]]
    assert "Fresh fact from the new run." in texts
    assert "Acme builds payments software (my wording)." in texts
    kept = next(f for f in snapshot(d)["facts"] if f["pinned"])
    assert kept["edited_by_user"]
    ip = next(s for s in d["brief"]["sections"] if s["key"] == "interview_process")
    assert [f["text"] for f in ip["facts"]] == ["Two rounds, per my friend."] and not ip[
        "not_found"
    ]
    assert any(s["id"] == paste["id"] for s in d["sources"])  # pasted source survives
    assert "Acme builds payment software." not in texts  # an un-kept old fact is replaced, not kept


async def test_refresh_does_not_delete_a_search_result_a_pinned_fact_cites(
    alice, runner, search, db
):
    from app.adapters.interfaces import SearchResult

    search.results = [SearchResult("News", "https://news.example.com/a", "Acme raised money.")]
    runner.llm = ScriptedLlm(
        lambda u: {"recent_news": [{"text": "Acme raised money.", "source_ids": [2]}]}
    )
    cid = await researched(alice, runner)
    d = await detail(alice, cid)
    news = next(s for s in d["brief"]["sections"] if s["key"] == "recent_news")["facts"][0]
    await alice.put(
        f"/api/companies/{cid}/brief",
        json={
            "facts": [
                {
                    "id": news["id"],
                    "section_key": "recent_news",
                    "text": news["text"],
                    "pinned": True,
                }
            ]
        },
    )

    search.results = [
        SearchResult("Other", "https://other.example.com/b", "Something else.")
    ]  # the old one is gone
    runner.llm = ScriptedLlm(lambda u: {"snapshot": [{"text": "Fresh.", "source_ids": [1]}]})
    await alice.post(f"/api/companies/{cid}/research")
    await runner.wait_idle()

    d = await detail(alice, cid)
    kept = next(s for s in d["brief"]["sections"] if s["key"] == "recent_news")["facts"][0]
    assert kept["pinned"]
    cited = {s["id"] for s in d["sources"]}
    assert set(kept["source_ids"]) <= cited  # the pinned fact still points at a real, listed source
    urls = (
        (await db.execute(select(CompanySource.url).where(CompanySource.kind == "search_result")))
        .scalars()
        .all()
    )
    assert "https://news.example.com/a" in urls


async def test_user_facts_reach_the_live_prompt_labelled_from_you(alice, runner, answer_llm):
    cid = await researched(alice, runner)
    await alice.put(
        f"/api/companies/{cid}/brief",
        json={
            "facts": [
                {
                    "section_key": "culture_values",
                    "text": "Mentor says they value ownership.",
                    "pinned": True,
                }
            ]
        },
    )
    sid = (await alice.post("/api/sessions", json={"consent": True, "company_id": cid})).json()[
        "session_id"
    ]
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Why do you want to work here?"}
    )
    prompt = answer_llm.calls[0]["user"]
    assert "Mentor says they value ownership. [brief: From you]" in prompt
    assert prompt.index("Mentor says") < prompt.index(
        "Acme builds payment software"
    )  # pinned first
