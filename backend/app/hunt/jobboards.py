"""Complete open-role lists from the hosted job boards startups use. A careers page that loads its
roles with a script shows none in its HTML, but the board it loads them from publishes the same
list as public JSON, with the address of each role's own application page. Only those public feeds
are read, politely, through the same fetcher as every other page."""

import json
from typing import Any
from urllib.parse import quote, urlsplit

from app.services.fetcher import Fetcher

MAX_ROLES = 200
Opening = dict[str, str]


def identify(urls: tuple[str, ...] | list[str]) -> list[tuple[str, str]]:
    """(board kind, company slug) for each hosted board the addresses point at, once each."""
    out: list[tuple[str, str]] = []
    for url in urls:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        seg = [x for x in parts.path.split("/") if x]
        found: tuple[str, str] | None = None
        if host in ("boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io"):
            if seg and seg[0] == "embed" and "for=" in parts.query:
                slug = parts.query.split("for=", 1)[1].split("&")[0]
                found = ("greenhouse", slug)
            elif seg and seg[0] != "embed":
                found = ("greenhouse", seg[0])
        elif host in ("jobs.lever.co", "jobs.eu.lever.co") and seg:
            found = ("lever", seg[0])
        elif host == "jobs.ashbyhq.com" and seg:
            found = ("ashby", seg[0])
        elif host == "apply.workable.com" and seg and seg[0] != "api":
            found = ("workable", seg[0])
        elif host in ("jobs.smartrecruiters.com", "careers.smartrecruiters.com") and seg:
            found = ("smartrecruiters", seg[0])
        elif host.endswith(".recruitee.com") and host.count(".") == 2:
            found = ("recruitee", host.split(".")[0])
        if found and found[1] and found not in out:
            out.append(found)
    return out


def api_url(kind: str, slug: str) -> str:
    s = quote(slug, safe="")
    return {
        "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs",
        "lever": f"https://api.lever.co/v0/postings/{s}?mode=json",
        "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{s}",
        "workable": f"https://apply.workable.com/api/v1/widget/accounts/{s}",
        "smartrecruiters": f"https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100",
        "recruitee": f"https://{s}.recruitee.com/api/offers/",
    }[kind]


def _text(v: Any) -> str:
    return " ".join(str(v or "").split())[:120]


def _web(v: Any) -> str:
    u = str(v or "").strip()
    return u if u.startswith(("https://", "http://")) else ""


def parse(kind: str, slug: str, body: str) -> list[Opening]:
    """Role titles with the address of each role's own page, from a board's public JSON."""
    try:
        data = json.loads(body)
    except ValueError:
        return []
    rows: list[tuple[Any, Any]] = []
    if kind == "greenhouse" and isinstance(data, dict):
        rows = [(j.get("title"), j.get("absolute_url")) for j in data.get("jobs", [])]
    elif kind == "lever" and isinstance(data, list):
        rows = [(j.get("text"), j.get("hostedUrl") or j.get("applyUrl")) for j in data]
    elif kind == "ashby" and isinstance(data, dict):
        rows = [
            (j.get("title"), j.get("jobUrl") or j.get("applyUrl"))
            for j in data.get("jobs", [])
            if j.get("isListed", True)
        ]
    elif kind == "workable" and isinstance(data, dict):
        rows = [
            (j.get("title"), j.get("url") or j.get("application_url")) for j in data.get("jobs", [])
        ]
    elif kind == "smartrecruiters" and isinstance(data, dict):
        rows = [
            (j.get("name"), f"https://jobs.smartrecruiters.com/{quote(slug, safe='')}/{j['id']}")
            for j in data.get("content", [])
            if j.get("id")
        ]
    elif kind == "recruitee" and isinstance(data, dict):
        rows = [(j.get("title"), j.get("careers_url")) for j in data.get("offers", [])]
    out: list[Opening] = []
    for title, url in rows:
        t, u = _text(title), _web(url)
        if t and u and {"title": t, "url": u} not in out:
            out.append({"title": t, "url": u})
    return out[:MAX_ROLES]


async def openings(fetcher: Fetcher, urls: tuple[str, ...] | list[str]) -> list[Opening]:
    """Every role the startup's hosted boards list, each with its own application address. Empty if
    the startup uses no known board or the board cannot be read."""
    found: list[Opening] = []
    for kind, slug in identify(urls)[:3]:
        got = await fetcher.fetch(api_url(kind, slug))
        if got.status != "ok":
            continue
        for o in parse(kind, slug, got.text):
            if o not in found:
                found.append(o)
    return found[:MAX_ROLES]
