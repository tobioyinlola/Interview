import asyncio

import httpx
import pytest

from app.services.fetcher import Fetcher

PARA = (
    "Acme builds payment software for small restaurants and cafes across Europe. "
    "Our platform helps owners take orders, manage staff and understand daily sales. "
)
GOOD_HTML = (
    "<html><head><title>About Acme</title></head><body><article>"
    + "".join(f"<p>{PARA}Paragraph {i}.</p>" for i in range(6))
    + "</article></body></html>"
)
PUBLIC = "93.184.216.34"


class Site:
    """A fake internet: maps (host, path) to a response, and records every request made."""

    def __init__(self):
        self.pages: dict[tuple[str, str], httpx.Response | Exception] = {}
        self.requests: list[httpx.Request] = []

    def add(self, host, path, status=200, body=GOOD_HTML, ctype="text/html; charset=utf-8", **h):
        headers = {"content-type": ctype, **h}
        self.pages[(host, path)] = httpx.Response(status, content=body, headers=headers)

    def redirect(self, host, path, location, status=302):
        self.pages[(host, path)] = httpx.Response(status, headers={"location": location})

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        key = (request.headers["host"], request.url.path)
        page = self.pages.get(key)
        if page is None:
            return httpx.Response(404, content=b"nope", headers={"content-type": "text/plain"})
        if isinstance(page, Exception):
            raise page
        return httpx.Response(page.status_code, content=page.content, headers=page.headers)

    def connected_hosts(self) -> list[str]:
        return [r.url.host for r in self.requests]


class FakeTime:
    def __init__(self):
        self.now = 1000.0
        self.sleeps: list[float] = []

    def clock(self):
        return self.now

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture
def site():
    return Site()


@pytest.fixture
def make(site):
    dns = {"example.com": [PUBLIC], "other.com": ["93.184.216.35"], "evil.com": ["10.0.0.9"]}
    calls = {"n": 0}

    def build(**kw):
        ft = FakeTime()

        async def resolver(host, port):
            calls["n"] += 1
            if host not in dns:
                raise OSError("unknown host")
            return dns[host]

        f = Fetcher(
            resolver=kw.pop("resolver", resolver),
            transport=httpx.MockTransport(site.handler),
            sleep=ft.sleep,
            clock=ft.clock,
            **kw,
        )
        f.ft = ft  # type: ignore[attr-defined]
        f.dns = dns  # type: ignore[attr-defined]
        f.dns_calls = calls  # type: ignore[attr-defined]
        return f

    return build


# --------------------------------------------------------------------- happy path


async def test_fetches_and_extracts_main_text(site, make):
    site.add("example.com", "/about")
    r = await make().fetch("https://example.com/about")
    assert r.status == "ok"
    assert r.title == "About Acme"
    assert "payment software for small restaurants" in r.text


async def test_connects_to_the_checked_ip_and_keeps_the_real_host(site, make):
    site.add("example.com", "/about")
    await make().fetch("https://example.com/about")
    page_req = [r for r in site.requests if r.url.path == "/about"][0]
    assert page_req.url.host == PUBLIC  # the address we validated, not a fresh lookup
    assert page_req.headers["host"] == "example.com"
    assert page_req.extensions["sni_hostname"] == "example.com"  # TLS verifies the real name
    assert page_req.headers["user-agent"].startswith("MeetPracticeAssistant")


async def test_plain_text_is_accepted(site, make):
    site.add("example.com", "/a.txt", body=PARA * 3, ctype="text/plain")
    r = await make().fetch("https://example.com/a.txt")
    assert r.status == "ok" and "payment software" in r.text


async def test_text_is_trimmed_to_the_configured_length(site, make):
    site.add("example.com", "/a", body=PARA * 100, ctype="text/plain")
    r = await make(text_max_chars=500).fetch("https://example.com/a")
    assert len(r.text) == 500


# ------------------------------------------------------------- SSRF protections


@pytest.mark.parametrize(
    "target",
    [
        "http://127.0.0.1/admin",
        "http://localhost/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "http://[::1]/",
        "http://2130706433/",
        "http://evil.com/",  # public name that resolves to a private address
    ],
)
async def test_blocked_addresses_never_receive_a_request(site, make, target):
    r = await make().fetch(target)
    assert r.status == "blocked"
    assert site.requests == []


@pytest.mark.parametrize(
    "location",
    [
        "http://127.0.0.1/secret",
        "http://169.254.169.254/latest/meta-data/",
        "https://evil.com/x",
        "http://localhost:80/",
        "file:///etc/passwd",
        "http://[::ffff:10.0.0.1]/",
    ],
)
async def test_redirect_into_private_space_is_blocked_before_connecting(site, make, location):
    site.add("example.com", "/robots.txt", status=404)
    site.redirect("example.com", "/go", location)
    r = await make().fetch("https://example.com/go")
    assert r.status == "blocked"
    assert all(h == PUBLIC for h in site.connected_hosts())  # nothing else was contacted


async def test_a_public_to_public_redirect_chain_works(site, make):
    site.redirect("example.com", "/a", "https://other.com/b")
    site.redirect("other.com", "/b", "/c", status=301)
    site.add("other.com", "/c")
    r = await make().fetch("https://example.com/a")
    assert r.status == "ok"
    assert r.final_url == "https://other.com/c"


async def test_at_most_three_redirects(site, make):
    for i in range(6):
        site.redirect("example.com", f"/r{i}", f"/r{i + 1}")
    site.add("example.com", "/r6")
    r = await make().fetch("https://example.com/r0")
    assert r.status == "blocked" and "too many" in r.reason
    three = Fetcher  # exactly three redirects still succeeds
    site.redirect("example.com", "/s0", "/s1")
    site.redirect("example.com", "/s1", "/s2")
    site.redirect("example.com", "/s2", "/s3")
    site.add("example.com", "/s3")
    assert (await make().fetch("https://example.com/s0")).status == "ok"
    assert three is Fetcher


async def test_dns_answer_is_used_once_so_rebinding_cannot_redirect_the_connection(site, make):
    """A hostile DNS server answers public first, then private. We must connect to the first."""
    answers = iter([[PUBLIC], ["10.0.0.9"], ["10.0.0.9"], ["10.0.0.9"]])

    async def rebinding(host, port):
        return next(answers)

    site.add("example.com", "/about")
    r = await make(resolver=rebinding).fetch("https://example.com/about")
    assert r.status == "ok"
    assert set(site.connected_hosts()) == {PUBLIC}


async def test_non_default_port_and_credentials_are_refused(site, make):
    for url in ("http://example.com:8080/", "http://u:p@example.com/"):
        assert (await make().fetch(url)).status == "blocked"
    assert site.requests == []


# ------------------------------------------------------------ limits and content


async def test_declared_oversize_is_too_large(site, make):
    site.add("example.com", "/big", body=b"x", **{"content-length": str(5 * 1024 * 1024)})
    r = await make().fetch("https://example.com/big")
    assert r.status == "too_large"


async def test_streamed_oversize_without_content_length_is_too_large(site, make):
    site.add("example.com", "/big", body=b"x" * (2 * 1024 * 1024 + 10), ctype="text/plain")
    r = await make().fetch("https://example.com/big")
    assert r.status == "too_large"


@pytest.mark.parametrize("ctype", ["application/pdf", "image/png", "application/json", "video/mp4"])
async def test_only_html_and_text_are_kept(site, make, ctype):
    site.add("example.com", "/f", body=b"%PDF-1.4 ...", ctype=ctype)
    r = await make().fetch("https://example.com/f")
    assert r.status == "blocked" and "not a web page" in r.reason


async def test_page_with_no_readable_text_is_reported(site, make):
    site.add("example.com", "/spa", body="<html><body><div id='root'></div></body></html>")
    r = await make().fetch("https://example.com/spa")
    assert r.status == "blocked" and "No readable text" in r.reason


@pytest.mark.parametrize(
    "code,status",
    [
        (401, "login_required"),
        (403, "blocked"),
        (429, "blocked"),
        (404, "blocked"),
        (500, "blocked"),
    ],
)
async def test_http_errors_map_to_clear_statuses(site, make, code, status):
    site.add("example.com", "/p", status=code, body="x", ctype="text/plain")
    r = await make().fetch("https://example.com/p")
    assert r.status == status and r.reason


async def test_redirect_to_a_sign_in_page_is_login_required(site, make):
    site.redirect("example.com", "/team", "https://example.com/login?next=/team")
    r = await make().fetch("https://example.com/team")
    assert r.status == "login_required"


async def test_slow_server_times_out(site, make):
    async def slow(request):
        await asyncio.sleep(1)
        return httpx.Response(200, content=GOOD_HTML, headers={"content-type": "text/html"})

    f = make(timeout=0.05)
    f.transport = httpx.MockTransport(slow)
    r = await f.fetch("https://example.com/slow")
    assert r.status == "timeout"


async def test_transport_timeout_is_reported_as_timeout(site, make):
    site.pages[("example.com", "/t")] = httpx.ReadTimeout("slow")
    site.add("example.com", "/robots.txt", status=404)
    r = await make().fetch("https://example.com/t")
    assert r.status == "timeout"


async def test_connection_failure_does_not_raise(site, make):
    site.pages[("example.com", "/c")] = httpx.ConnectError("refused")
    site.add("example.com", "/robots.txt", status=404)
    r = await make().fetch("https://example.com/c")
    assert r.status == "blocked"


# -------------------------------------------------------------------- robots.txt


async def test_robots_disallow_is_respected(site, make):
    site.add(
        "example.com", "/robots.txt", body="User-agent: *\nDisallow: /private\n", ctype="text/plain"
    )
    site.add("example.com", "/private/team")
    site.add("example.com", "/public")
    f = make()
    assert (await f.fetch("https://example.com/private/team")).status == "disallowed"
    assert (await f.fetch("https://example.com/public")).status == "ok"
    assert [r.url.path for r in site.requests].count("/private/team") == 0


async def test_missing_robots_allows_but_server_error_disallows(site, make):
    site.add("example.com", "/p")
    site.add("example.com", "/robots.txt", status=404, body="", ctype="text/plain")
    assert (await make().fetch("https://example.com/p")).status == "ok"
    site.add("example.com", "/robots.txt", status=503, body="", ctype="text/plain")
    assert (await make().fetch("https://example.com/p")).status == "disallowed"


async def test_robots_is_fetched_once_per_host(site, make):
    site.add("example.com", "/robots.txt", status=404, body="", ctype="text/plain")
    site.add("example.com", "/a")
    site.add("example.com", "/b")
    f = make()
    await f.fetch("https://example.com/a")
    await f.fetch("https://example.com/b")
    assert [r.url.path for r in site.requests].count("/robots.txt") == 1


# ---------------------------------------------------------------------- politeness


async def test_at_most_one_request_per_second_to_a_host(site, make):
    site.add("example.com", "/a")
    site.add("example.com", "/b")
    site.add("example.com", "/robots.txt", status=404, body="", ctype="text/plain")
    f = make()
    await f.fetch("https://example.com/a")
    await f.fetch("https://example.com/b")
    # robots, a, b = three requests to one host: the later two had to wait a full second
    assert len(f.ft.sleeps) == 2 and all(s >= 0.99 for s in f.ft.sleeps)


async def test_different_hosts_are_not_delayed(site, make):
    site.add("example.com", "/a")
    site.add("other.com", "/b")
    f = make()
    await f.fetch("https://example.com/a")
    await f.fetch("https://other.com/b")
    # Each host waits once, between its own robots.txt request and its page request. Nothing
    # waits for the other host: a cross-host delay would add a third sleep.
    assert len(f.ft.sleeps) == 2
