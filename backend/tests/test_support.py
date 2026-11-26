"""Support: a person writes to the team from any app; staff answer in the back office."""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import SupportMessage, SupportTicket


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def boss(new_client, staff_sign_in, settings):
    settings.admin_emails = "boss@example.com"
    async with new_client() as c:
        await staff_sign_in(c, "boss@example.com")
        yield c


NEW = {
    "subject": "My CV will not upload",
    "category": "bug",
    "body": "It says it could not read the file.",
    "context": {"platform": "desktop", "app_version": "1.4.0", "page": "/settings/cv?token=abc"},
}


async def test_a_person_writes_in_and_sees_their_conversation(new_client, sign_in, sender):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        r = await c.post("/api/support/tickets", json=NEW)
        assert r.status_code == 201
        t = r.json()
        assert t["status"] == "open" and t["messages"][0]["author"] == "You"
        mine = (await c.get("/api/support/tickets")).json()["items"]
        assert [x["subject"] for x in mine] == ["My CV will not upload"]
        got = (await c.get(f"/api/support/tickets/{t['id']}")).json()
        assert got["messages"][0]["body"] == NEW["body"]
        more = await c.post(
            f"/api/support/tickets/{t['id']}/messages", json={"body": "It is a PDF, 2 MB."}
        )
        assert more.status_code == 201 and len(more.json()["messages"]) == 2


async def test_the_team_is_told_and_the_page_is_kept_without_its_query(
    new_client, sign_in, sender, settings, maker
):
    settings.support_email = "help@interviewmeet.test"
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        await c.post("/api/support/tickets", json=NEW)
    told = [m for m in sender.messages if m.kind == "support_new"]
    assert told and told[0].to == "help@interviewmeet.test"
    assert "ada@example.com" in told[0].text
    async with maker() as db:
        t = (await db.execute(select(SupportTicket))).scalar_one()
    assert t.context["page"] == "/settings/cv" and t.context["platform"] == "desktop"


async def test_staff_see_it_reply_and_the_person_is_emailed_and_sees_it(
    new_client, sign_in, boss, sender
):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        tid = (await c.post("/api/support/tickets", json=NEW)).json()["id"]
        inbox = (await boss.get("/api/admin/support")).json()
        assert inbox["counts"]["open"] == 1
        assert inbox["items"][0]["user_email"] == "ada@example.com" and inbox["items"][0]["unread"]
        detail = (await boss.get(f"/api/admin/support/{tid}")).json()
        assert detail["thread"][0]["author"] in ("Test Person", "ada@example.com")
        assert detail["context"]["platform"] == "desktop"
        r = await boss.post(
            f"/api/admin/support/{tid}/reply", json={"body": "Export it as a PDF and retry."}
        )
        assert r.status_code == 201 and r.json()["status"] == "answered"
        mail = [m for m in sender.messages if m.kind == "support_reply"]
        assert mail and mail[0].to == "ada@example.com"
        assert "Export it as a PDF" in mail[0].text and f"/support/{tid}" in mail[0].text
        assert (await c.get("/api/support/unread")).json() == {"count": 1}
        seen = (await c.get(f"/api/support/tickets/{tid}")).json()
        assert seen["status"] == "answered" and seen["messages"][-1]["author"] == "Support team"
        assert (await c.get("/api/support/unread")).json() == {"count": 0}


async def test_private_notes_are_never_shown_to_the_person(new_client, sign_in, boss, sender):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        tid = (await c.post("/api/support/tickets", json=NEW)).json()["id"]
        n = await boss.post(f"/api/admin/support/{tid}/note", json={"body": "SECRET-NOTE"})
        assert n.status_code == 201
        assert "SECRET-NOTE" in str((await boss.get(f"/api/admin/support/{tid}")).json())
        theirs = (await c.get(f"/api/support/tickets/{tid}")).text
        assert "SECRET-NOTE" not in theirs
        assert "SECRET-NOTE" not in str((await c.get("/api/support/tickets")).json())
    assert "support_reply" not in sender.kinds()


async def test_resolving_and_a_person_writing_back_reopens_it(new_client, sign_in, boss):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        tid = (await c.post("/api/support/tickets", json=NEW)).json()["id"]
        r = await boss.post(f"/api/admin/support/{tid}/status", json={"status": "resolved"})
        assert r.json()["status"] == "resolved"
        assert (await boss.get("/api/admin/support?status=resolved")).json()["items"]
        back = await c.post(f"/api/support/tickets/{tid}/messages", json={"body": "Still broken."})
        assert back.json()["status"] == "open"
        done = await c.post(f"/api/support/tickets/{tid}/resolve")
        assert done.json()["status"] == "resolved"


async def test_nobody_can_read_or_write_in_another_persons_conversation(new_client, sign_in):
    async with new_client() as ada, new_client() as eve:
        await sign_in(ada, "ada@example.com")
        await sign_in(eve, "eve@example.com")
        tid = (await ada.post("/api/support/tickets", json=NEW)).json()["id"]
        assert (await eve.get("/api/support/tickets")).json()["items"] == []
        for method, path, body in (
            ("get", f"/api/support/tickets/{tid}", None),
            ("post", f"/api/support/tickets/{tid}/messages", {"body": "hi"}),
            ("post", f"/api/support/tickets/{tid}/resolve", None),
        ):
            r = await getattr(eve, method)(path, **({"json": body} if body else {}))
            assert r.status_code == 404, path
        assert (await eve.get(f"/api/support/tickets/{uuid.uuid4()}")).status_code == 404


async def test_the_back_office_support_inbox_needs_the_staff_sign_in(new_client, sign_in):
    async with new_client() as c:
        assert (await c.get("/api/admin/support")).status_code == 401
        await sign_in(c, "ada@example.com")  # an ordinary account is not staff
        assert (await c.get("/api/admin/support")).status_code == 401
        assert (await c.post("/api/support/tickets", json=NEW)).status_code == 201


async def test_support_needs_an_account_and_limits_how_much_one_person_can_send(
    new_client, sign_in
):
    async with new_client() as anon:
        assert (await anon.post("/api/support/tickets", json=NEW)).status_code == 401
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        assert (await c.post("/api/support/tickets", json={**NEW, "body": ""})).status_code == 422
        for _ in range(5):
            assert (await c.post("/api/support/tickets", json=NEW)).status_code == 201
        assert (await c.post("/api/support/tickets", json=NEW)).status_code == 429


async def test_text_is_cleaned_before_it_is_kept(new_client, sign_in, maker):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        r = await c.post(
            "/api/support/tickets", json={**NEW, "subject": "Hi\n there", "body": "a\x00b\x07c"}
        )
        assert r.status_code == 201 and r.json()["subject"] == "Hi there"
        assert r.json()["messages"][0]["body"] == "abc"
    async with maker() as db:
        assert (await db.execute(select(SupportMessage))).scalars().all()
