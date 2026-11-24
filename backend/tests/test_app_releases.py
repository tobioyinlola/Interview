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


DIGEST = "a" * 64


def with_digest(a: dict, digest: str = DIGEST) -> dict:  # type: ignore[type-arg]
    return {**a, "digest": f"sha256:{digest}"}


def test_the_android_file_carries_its_checksum_and_build_number():
    out = parse(
        [
            {
                "tag_name": "android-latest",
                "name": "InterviewMeet for Android 0.2.24",
                "draft": False,
                "assets": [with_digest(asset("InterviewMeet-android.apk", "android-latest"))],
            }
        ],
        REPO,
    )
    assert out.android and out.android.sha256 == DIGEST and out.android.build == 100024
    odd = parse(
        [
            {
                "tag_name": "android-latest",
                "name": "InterviewMeet for Android 0.2.24",
                "assets": [
                    {**asset("InterviewMeet-android.apk", "android-latest"), "digest": "md5:zz"}
                ],
            }
        ],
        REPO,
    )
    assert odd.android and odd.android.sha256 is None  # never a checksum we cannot trust


def interface_release(**over):  # type: ignore[no-untyped-def]
    base = {
        "tag_name": "interface-latest",
        "draft": False,
        "body": '{"version": "0.2.25", "native_min": 100020}',
        "assets": [with_digest(asset("interface.zip", "interface-latest"))],
    }
    base.update(over)
    return base


def test_a_new_interface_is_offered_with_its_checksum_and_the_oldest_build_that_can_run_it():
    out = parse([interface_release()], REPO)
    assert out.ui and out.ui.version == "0.2.25" and out.ui.native_min == 100020
    assert out.ui.sha256 == DIGEST and out.ui.url == f"{BASE}/interface-latest/interface.zip"


def test_an_interface_release_that_is_incomplete_or_foreign_is_ignored():
    for bad in (
        interface_release(body="not json"),
        interface_release(body='{"version": "0.2.25"}'),  # no native_min
        interface_release(assets=[asset("interface.zip", "interface-latest")]),  # no checksum
        interface_release(assets=[]),
        interface_release(
            assets=[
                with_digest(
                    {
                        "name": "interface.zip",
                        "browser_download_url": "https://evil.example/interface.zip",
                    }
                )
            ]
        ),
    ):
        assert parse([bad], REPO).ui is None
