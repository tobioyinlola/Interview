from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import User


async def test_a_new_account_has_not_had_the_tour(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        assert (await c.get("/api/me")).json()["tour_done"] is False


async def test_finishing_or_skipping_it_is_remembered_and_can_be_undone(
    new_client, sign_in, engine
) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        r = await c.put("/api/tour", json={"done": True})
        assert r.status_code == 200 and r.json()["tour_done"] is True
        assert (await c.get("/api/me")).json()["tour_done"] is True
        async with async_sessionmaker(engine)() as s:
            assert (await s.execute(select(User))).scalar_one().tour_done_at is not None
        again = await c.put("/api/tour", json={"done": False})
        assert again.json()["tour_done"] is False
        assert (await c.get("/api/me")).json()["tour_done"] is False


async def test_the_default_is_done_so_a_bare_call_means_skip(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        assert (await c.put("/api/tour", json={})).json()["tour_done"] is True


async def test_it_is_per_person(new_client, sign_in) -> None:
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        await a.put("/api/tour", json={"done": True})
        assert (await b.get("/api/me")).json()["tour_done"] is False


async def test_it_needs_a_signed_in_person(new_client) -> None:
    async with new_client() as c:
        assert (await c.put("/api/tour", json={"done": True})).status_code == 401
