import uuid

from sqlalchemy import func, select, update

from app.models import (
    AuthSession,
    Company,
    CompanyBrief,
    Note,
    PracticeSession,
    User,
)
from app.repositories import CompaniesRepo, SessionsRepo


async def test_notes_round_trip_and_default_empty(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "n@example.com")
        empty = (await c.get("/api/notes")).json()
        assert empty == {
            "role": "",
            "content": "",
            "updated_at": None,
            "cv_filename": None,
            "cv_uploaded_at": None,
            "cv_layout_kept": False,
        }
        put = await c.put("/api/notes", json={"role": "PM", "content": "Led a launch."})
        got = (await c.get("/api/notes")).json()
    assert put.status_code == 200 and got["role"] == "PM" and got["content"] == "Led a launch."
    assert got["updated_at"]


async def test_notes_accept_16000_and_reject_more(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "n@example.com")
        ok = await c.put("/api/notes", json={"role": "", "content": "x" * 16_000})
        bad = await c.put("/api/notes", json={"role": "", "content": "x" * 16_001})
    assert ok.status_code == 200
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "invalid_request"
    assert "xxxx" not in bad.text  # input is never echoed back


async def test_notes_are_private_to_each_user(new_client, sign_in):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        await a.put("/api/notes", json={"role": "A-role", "content": "A secret"})
        b_view = (await b.get("/api/notes")).json()
        await b.put("/api/notes", json={"role": "B", "content": "B notes"})
        a_view = (await a.get("/api/notes")).json()
    assert b_view["content"] == ""
    assert a_view["content"] == "A secret"


async def test_notes_require_sign_in(new_client):
    async with new_client() as c:
        assert (await c.get("/api/notes")).status_code == 401
        assert (await c.put("/api/notes", json={"role": "", "content": ""})).status_code == 401


# ------------------------------------------------------------------ consent


async def _session_count(db) -> int:
    return int((await db.execute(select(func.count()).select_from(PracticeSession))).scalar_one())


async def test_a_session_needs_no_consent_box_because_it_was_agreed_at_sign_up(
    new_client, sign_in, db
):
    async with new_client() as c:
        await sign_in(c, "c@example.com")
        results = [
            await c.post("/api/sessions", json=body)
            for body in [{}, {"consent": False}, {"consent": None}, {"company_id": None}]
        ]
    assert [r.status_code for r in results] == [201, 201, 201, 201]
    assert await _session_count(db) == 4


async def test_an_account_with_no_agreement_on_record_cannot_start_a_session(
    new_client, sign_in, db
):
    async with new_client() as c:
        await sign_in(c, "n@example.com")
        await db.execute(update(User).values(practice_consent_at=None))
        await db.commit()
        r = await c.post("/api/sessions", json={"consent": True})  # a box in the request is no help
    assert r.status_code == 400 and r.json()["error"]["code"] == "consent_required"
    assert await _session_count(db) == 0


async def test_session_with_consent_stores_time_and_snapshot(new_client, sign_in, db):
    async with new_client() as c:
        await sign_in(c, "s@example.com")
        await c.put("/api/notes", json={"role": "Data Eng", "content": "Built pipelines."})
        r = await c.post("/api/sessions", json={"consent": True})
    assert r.status_code == 201
    row = (await db.execute(select(PracticeSession))).scalar_one()
    assert str(row.id) == r.json()["session_id"]
    assert row.status == "active"
    assert row.consent_confirmed_at is not None
    assert row.role == "Data Eng" and row.notes_snapshot == "Built pipelines."


async def test_session_cannot_use_another_users_company(new_client, sign_in, db):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        owner = (await db.execute(select(User).where(User.email == "a@example.com"))).scalar_one()
        company = Company(user_id=owner.id, name="Acme")
        db.add(company)
        await db.commit()
        theirs = await b.post(
            "/api/sessions", json={"consent": True, "company_id": str(company.id)}
        )
        mine = await a.post("/api/sessions", json={"consent": True, "company_id": str(company.id)})
        missing = await a.post(
            "/api/sessions", json={"consent": True, "company_id": str(uuid.uuid4())}
        )
    assert theirs.status_code == 404 and theirs.json()["error"]["code"] == "company_not_found"
    assert mine.status_code == 201
    assert missing.status_code == 404


async def test_session_records_the_current_brief_version(new_client, sign_in, db):
    async with new_client() as c:
        await sign_in(c, "b@example.com")
        user = (await db.execute(select(User))).scalar_one()
        company = Company(user_id=user.id, name="Acme")
        db.add(company)
        await db.flush()
        old = CompanyBrief(company_id=company.id, version=1, content={}, is_current=False)
        cur = CompanyBrief(company_id=company.id, version=2, content={}, is_current=True)
        db.add_all([old, cur])
        await db.commit()
        r = await c.post("/api/sessions", json={"consent": True, "company_id": str(company.id)})
    row = (await db.execute(select(PracticeSession))).scalar_one()
    assert r.status_code == 201 and row.brief_id == cur.id


async def test_idempotency_key_prevents_a_second_session(new_client, sign_in, db):
    async with new_client() as c:
        await sign_in(c, "i@example.com")
        h = {"idempotency-key": "click-1"}
        first = await c.post("/api/sessions", json={"consent": True}, headers=h)
        retry = await c.post("/api/sessions", json={"consent": True}, headers=h)
        other = await c.post(
            "/api/sessions", json={"consent": True}, headers={"idempotency-key": "click-2"}
        )
    assert first.json()["session_id"] == retry.json()["session_id"]
    assert other.json()["session_id"] != first.json()["session_id"]
    assert await _session_count(db) == 2


async def test_repositories_are_scoped_to_their_owner(new_client, sign_in, db):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        users = {u.email: u for u in (await db.execute(select(User))).scalars()}
        company = Company(user_id=users["a@example.com"].id, name="Acme")
        db.add(company)
        await db.commit()
        sid = (await a.post("/api/sessions", json={"consent": True})).json()["session_id"]
    a_id, b_id = users["a@example.com"].id, users["b@example.com"].id
    assert await CompaniesRepo(db, a_id).get(company.id) is not None
    assert await CompaniesRepo(db, b_id).get(company.id) is None
    assert await CompaniesRepo(db, b_id).current_brief(company.id) is None
    assert await SessionsRepo(db, a_id).get(uuid.UUID(sid)) is not None
    assert await SessionsRepo(db, b_id).get(uuid.UUID(sid)) is None


# ------------------------------------------------------------- account delete


async def test_delete_account_removes_everything_for_that_user_only(new_client, sign_in, db):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        users = {u.email: u for u in (await db.execute(select(User))).scalars()}
        for email in users:
            db.add(Company(user_id=users[email].id, name=f"{email}-co"))
        await db.commit()
        for client, text in ((a, "A notes"), (b, "B notes")):
            await client.put("/api/notes", json={"role": "r", "content": text})
            await client.post("/api/sessions", json={"consent": True})
        old_cookie = a.cookies.get("session")

        r = await a.delete("/api/account")
        after_me = await a.get("/api/me")
        b_me = await b.get("/api/me")

    assert r.status_code == 202
    assert after_me.status_code == 401 and old_cookie
    assert b_me.status_code == 200

    a_id = users["a@example.com"].id
    for model, col in (
        (User, User.id),
        (Note, Note.user_id),
        (Company, Company.user_id),
        (PracticeSession, PracticeSession.user_id),
        (AuthSession, AuthSession.user_id),
    ):
        n = (await db.execute(select(func.count()).select_from(model).where(col == a_id))).scalar()
        assert n == 0, f"{model.__name__} rows survived account deletion"
    # The other user is untouched.
    b_id = users["b@example.com"].id
    for model, col in ((Note, Note.user_id), (Company, Company.user_id)):
        n = (await db.execute(select(func.count()).select_from(model).where(col == b_id))).scalar()
        assert n == 1


async def test_delete_account_requires_sign_in(new_client):
    async with new_client() as c:
        assert (await c.delete("/api/account")).status_code == 401
