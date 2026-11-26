"""Interview modes. Mock practice and authorised live assistance get real-time answers; a Standard
Interview never does. Live assistance in a real interview needs the person to confirm, and name,
who authorised it, and that is kept with the session."""

import pytest

from tests.helpers import NOTES

QUESTION = "Tell me about a time you led a project under a tight deadline?"


@pytest.fixture
async def alice(new_client, sign_in):  # type: ignore[no-untyped-def]
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        await c.put("/api/notes", json={"role": "Product Manager", "content": NOTES})
        yield c


async def start(c, **body):  # type: ignore[no-untyped-def]
    return await c.post("/api/sessions", json=body)


async def ask(c, sid):  # type: ignore[no-untyped-def]
    return await c.post(
        f"/api/sessions/{sid}/suggest",
        json={"question_text": QUESTION, "utterance_ids": [], "regenerate": False},
    )


async def test_sessions_are_mock_practice_unless_said_otherwise(alice) -> None:
    r = await start(alice)
    assert r.status_code == 201 and r.json()["mode"] == "mock"
    d = (await alice.get(f"/api/sessions/{r.json()['session_id']}")).json()
    assert d["mode"] == "mock" and d["assist_authorized_by"] is None


async def test_a_standard_interview_never_gets_real_time_answers(alice) -> None:
    r = await start(alice, mode="standard")
    assert r.status_code == 201 and r.json()["mode"] == "standard"
    a = await ask(alice, r.json()["session_id"])
    assert a.status_code == 409 and a.json()["error"]["code"] == "assistance_off"


async def test_live_assistance_needs_a_confirmed_and_named_authorisation(alice) -> None:
    for body in (
        {"mode": "assisted"},
        {"mode": "assisted", "assist_authorized": True},
        {"mode": "assisted", "assist_authorized": True, "assist_authorized_by": "   "},
        {"mode": "assisted", "assist_authorized_by": "Jo, the recruiter at Acme"},
    ):
        r = await start(alice, **body)
        assert r.status_code == 422, body
        assert r.json()["error"]["code"] == "authorization_required"
    r = await start(
        alice, mode="assisted", assist_authorized=True,
        assist_authorized_by="Jo Smith, recruiter at Acme (email of 25 Nov)",
    )  # fmt: skip
    assert r.status_code == 201 and r.json()["mode"] == "assisted"
    d = (await alice.get(f"/api/sessions/{r.json()['session_id']}")).json()
    assert d["assist_authorized_by"] == "Jo Smith, recruiter at Acme (email of 25 Nov)"


async def test_an_unknown_mode_is_refused(alice) -> None:
    assert (await start(alice, mode="stealth")).status_code == 422
