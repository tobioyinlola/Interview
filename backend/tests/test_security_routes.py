"""Every route that is not meant to be public refuses a caller with no sign-in. A new route that
forgets its guard fails here, so it cannot ship open by accident."""

import re
import uuid

PUBLIC = {
    # sign-in and sign-up
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/password-login"),
    ("POST", "/api/auth/verify"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/reset-password"),
    ("POST", "/api/auth/app-exchange"),
    ("GET", "/api/auth/providers"),
    ("GET", "/api/auth/google/start"),
    ("GET", "/api/auth/google/callback"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/admin/auth/login"),
    ("POST", "/api/admin/auth/verify"),
    ("POST", "/api/admin/auth/logout"),
    ("GET", "/api/admin/auth/me"),  # answers 401 itself
    # health, metrics (token), published releases
    ("GET", "/api/app/releases"),  # the download links on the website
    ("GET", "/healthz"),
    ("GET", "/readyz"),
    ("GET", "/metrics"),
}


def _fill(path: str) -> str:
    return re.sub(r"\{[^}]+\}", lambda m: str(uuid.uuid4()), path)


async def test_nothing_but_the_sign_in_routes_answers_a_stranger(app, new_client) -> None:
    spec = app.openapi()
    open_routes: list[str] = []
    async with new_client() as stranger:
        for path, ops in spec["paths"].items():
            for method in ops:
                if method.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    continue
                if (method.upper(), path) in PUBLIC:
                    continue
                r = await stranger.request(
                    method.upper(),
                    _fill(path),
                    json={} if method.upper() != "GET" else None,
                    headers={"x-requested-with": "meet-practice"},
                )
                if r.status_code not in (401, 403, 404, 405, 422, 503):
                    open_routes.append(f"{method.upper()} {path} -> {r.status_code}")
    assert open_routes == []


def test_a_written_note_may_not_carry_a_link_address_or_phone_number() -> None:
    from app.hunt import draft

    facts = "I led a team of 12 and shipped payments."
    good = " ".join(["I build payment products and I enjoy small teams that ship."] * 8)
    assert draft.problem(good, facts + " 12") is None or "short" not in (
        draft.problem(good, facts) or ""
    )
    for bad in (
        "See https://evil.example/apply for details",
        "Visit www.acme-careers.net now",
        "Reply to me at jobs@evil.example please",
        "Join the call on evil-site.io today",
        "Call +1 415 555 0100 any time",
    ):
        text = good + " " + bad
        assert "link, an email address or a phone number" in (draft.problem(text, facts) or "")
        assert draft.grounded(text, facts) is False
