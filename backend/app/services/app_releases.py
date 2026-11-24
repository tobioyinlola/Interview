"""Which version of each installed app is the newest, from the project's public GitHub releases.

The apps compare this with the version they are running and, where they cannot update themselves
(a Mac app that is not yet signed, an Android app installed from a file), show an "update
available" banner with the download. Cached for half an hour; if GitHub cannot be reached the last
good answer is kept, and with none the answer is simply "nothing newer known"."""

import json
import re
import time
from typing import Any

import httpx
from pydantic import BaseModel

TTL_SECONDS = 30 * 60
ASSETS = {
    "windows": "InterviewMeet-Setup.exe",
    "mac_arm64": "InterviewMeet-mac-arm64.dmg",
    "mac_x64": "InterviewMeet-mac-x64.dmg",
}
ANDROID_ASSET = "InterviewMeet-android.apk"
UI_ASSET = "interface.zip"
SHA256 = re.compile(r"^sha256:([0-9a-f]{64})$")
BUILD_BASE = 100000  # the Android build number is this plus the release's last number
VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


class DesktopRelease(BaseModel):
    version: str
    windows: str | None = None
    mac_arm64: str | None = None
    mac_x64: str | None = None


class AndroidRelease(BaseModel):
    version: str
    url: str
    sha256: str | None = None  # what the app checks the download against before installing it
    build: int | None = None  # Android's build number for that version


class UiRelease(BaseModel):
    """A new copy of the interface the phone app can fetch and switch to without a new install."""

    version: str
    url: str
    sha256: str
    native_min: int  # the oldest installed build (Android build number) that can run it


class AppReleasesOut(BaseModel):
    desktop: DesktopRelease | None = None
    android: AndroidRelease | None = None
    ui: UiRelease | None = None


def _version(text: str) -> str | None:
    m = VERSION.search(text or "")
    return m.group(0) if m else None


def _key(version: str) -> tuple[int, ...]:
    return tuple(int(x) for x in version.split("."))


def parse(releases: list[dict[str, Any]], repo: str) -> AppReleasesOut:
    """The newest desktop release and the Android download, from GitHub's release list. Only links
    that really point at this project's own release downloads are passed on."""
    prefix = f"https://github.com/{repo}/releases/download/"

    def url_of(release: dict[str, Any], name: str) -> str | None:
        for a in release.get("assets") or []:
            link = a.get("browser_download_url") or ""
            if a.get("name") == name and link.startswith(prefix):
                return str(link)
        return None

    def digest_of(release: dict[str, Any], name: str) -> str | None:
        for a in release.get("assets") or []:
            if a.get("name") == name and (m := SHA256.match(str(a.get("digest") or ""))):
                return m.group(1)
        return None

    desktop: DesktopRelease | None = None
    android: AndroidRelease | None = None
    ui: UiRelease | None = None
    for r in releases:
        if r.get("draft"):
            continue
        tag = str(r.get("tag_name") or "")
        if tag.startswith("desktop-v") and (version := _version(tag[len("desktop-v") :])):
            if desktop is None or _key(version) > _key(desktop.version):
                desktop = DesktopRelease(
                    version=version, **{k: url_of(r, n) for k, n in ASSETS.items()}
                )
        elif tag == "android-latest" and (version := _version(str(r.get("name") or ""))):
            if link := url_of(r, ANDROID_ASSET):
                android = AndroidRelease(
                    version=version,
                    url=link,
                    sha256=digest_of(r, ANDROID_ASSET),
                    build=BUILD_BASE + int(version.split(".")[2]),
                )
        elif tag == "interface-latest":
            # the release's text is a small JSON note: {"version": "0.2.24", "native_min": 100020}
            try:
                note = json.loads(str(r.get("body") or ""))
                version = _version(str(note["version"]))
                native_min = int(note["native_min"])
            except (ValueError, KeyError, TypeError):
                continue
            link, digest = url_of(r, UI_ASSET), digest_of(r, UI_ASSET)
            if version and link and digest:
                ui = UiRelease(version=version, url=link, sha256=digest, native_min=native_min)
    return AppReleasesOut(desktop=desktop, android=android, ui=ui)


class AppReleases:
    def __init__(self, repo: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.repo = repo
        self._transport = transport
        self._at = 0.0
        self._last = AppReleasesOut()

    async def latest(self, now: float | None = None) -> AppReleasesOut:
        now = time.monotonic() if now is None else now
        if self._at and now - self._at < TTL_SECONDS:
            return self._last
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=8) as c:
                r = await c.get(
                    f"https://api.github.com/repos/{self.repo}/releases",
                    params={"per_page": 30},
                    headers={
                        "accept": "application/vnd.github+json",
                        "user-agent": "InterviewMeet",
                    },
                )
            if r.status_code == 200:
                self._last = parse(r.json(), self.repo)
        except (httpx.HTTPError, ValueError):
            pass  # keep the last good answer
        self._at = now  # do not hammer GitHub while it is unwell either
        return self._last
