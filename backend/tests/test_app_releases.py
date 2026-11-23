"""The newest-version list the installed apps check, read from GitHub's release list."""

import httpx

from app.deps import get_settings  # noqa: F401
from app.services.app_releases import TTL_SECONDS, AppReleases, parse

REPO = "owner/repo"
BASE = f"https://github.com/{REPO}/releases/download"


def asset(name: str, tag: str) -> dict:  # type: ignore[type-arg]
    return {"name": name, "browser_download_url": f"{BASE}/{tag}/{name}"}


RELEASES = [
    {
        "tag_name": "android-latest",
        "name": "InterviewMeet for Android 0.2.14",
        "draft": False,
        "assets": [asset("InterviewMeet-android.apk", "android-latest")],
    },
    {
        "tag_name": "desktop-v0.2.13",
        "draft": False,
        "assets": [
            asset("InterviewMeet-Setup.exe", "desktop-v0.2.13"),
            asset("InterviewMeet-mac-arm64.dmg", "desktop-v0.2.13"),
            asset("InterviewMeet-mac-x64.dmg", "desktop-v0.2.13"),
            asset("latest.yml", "desktop-v0.2.13"),
        ],
    },
    {
        "tag_name": "desktop-v0.1.3",
        "draft": False,
        "assets": [asset("InterviewMeet-Setup.exe", "desktop-v0.1.3")],
    },
    {
        "tag_name": "desktop-v9.9.9",
        "draft": True,
        "assets": [asset("InterviewMeet-Setup.exe", "desktop-v9.9.9")],
    },
]


def test_picks_the_newest_published_desktop_release_and_the_android_file():
    out = parse(RELEASES, REPO)
    assert out.desktop and out.desktop.version == "0.2.13"  # not the draft, not the older one
    assert out.desktop.windows == f"{BASE}/desktop-v0.2.13/InterviewMeet-Setup.exe"
    assert out.desktop.mac_arm64 and out.desktop.mac_x64
    assert out.android and out.android.version == "0.2.14"
    assert out.android.url.endswith("InterviewMeet-android.apk")


def test_versions_compare_as_numbers_not_text():
    rels = [
        {
            "tag_name": "desktop-v0.2.9",
            "assets": [asset("InterviewMeet-Setup.exe", "desktop-v0.2.9")],
        },
        {
            "tag_name": "desktop-v0.2.10",
            "assets": [asset("InterviewMeet-Setup.exe", "desktop-v0.2.10")],
        },
    ]
    assert parse(rels, REPO).desktop.version == "0.2.10"  # type: ignore[union-attr]


def test_links_that_do_not_point_at_this_projects_releases_are_dropped():
    rels = [
        {
            "tag_name": "desktop-v0.3.0",
            "assets": [
                {
                    "name": "InterviewMeet-Setup.exe",
                    "browser_download_url": "https://evil.test/x.exe",
                }
            ],
        }
    ]
    out = parse(rels, REPO)
    assert out.desktop and out.desktop.windows is None


def test_empty_and_odd_lists_give_nothing_rather_than_an_error():
    assert parse([], REPO).desktop is None
    assert parse([{"tag_name": "nonsense"}, {}], REPO).android is None


async def test_the_answer_is_cached_and_survives_a_github_outage() -> None:
    calls = []
    state = {"fail": False}

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if state["fail"]:
            return httpx.Response(503)
        return httpx.Response(200, json=RELEASES)

    svc = AppReleases(REPO, httpx.MockTransport(handler))
    first = await svc.latest(now=1000.0)
    await svc.latest(now=1000.0 + 60)
    assert len(calls) == 1 and first.desktop  # the second call came from the cache
    state["fail"] = True
    later = await svc.latest(now=1000.0 + TTL_SECONDS + 1)
    assert (
        len(calls) == 2 and later.desktop and later.desktop.version == "0.2.13"
    )  # last good answer kept


async def test_the_endpoint_is_public_and_returns_the_list(new_client, app) -> None:
    from app.routers.app_releases import get_app_releases

    svc = AppReleases(REPO, httpx.MockTransport(lambda r: httpx.Response(200, json=RELEASES)))
    app.dependency_overrides[get_app_releases] = lambda: svc
    async with new_client() as c:
        r = await c.get("/api/app/releases")
    assert r.status_code == 200
    body = r.json()
    assert body["desktop"]["version"] == "0.2.13" and body["android"]["version"] == "0.2.14"
