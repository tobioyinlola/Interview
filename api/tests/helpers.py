"""Shared fakes for tests: a fetcher with canned pages, a scripted model, a failing search."""

import json

from app.services.fetcher import FetchResult

PAGE = "Acme builds payment software for restaurants. " * 5


class FakeFetcher:
    def __init__(self, results=None):
        self.results = results or {}
        self.calls: list[str] = []

    async def fetch(self, url):
        self.calls.append(url)
        return self.results.get(url) or FetchResult(url, "blocked", "The site blocked the request.")


def ok(url, text=PAGE, title="Page"):
    return FetchResult(url, "ok", title=title, text=text, final_url=url)


class ScriptedLlm:
    """Answers with whatever `reply(user_prompt)` returns; records every prompt it saw."""

    def __init__(self, reply):
        self.reply = reply
        self.prompts: list[str] = []

    async def generate_json(self, *, system, user, schema):
        self.prompts.append(user)
        out = self.reply(user)
        if isinstance(out, Exception):
            raise out
        return out if isinstance(out, str) else json.dumps(out)

    def stream_text(self, **kw):  # pragma: no cover - not used here
        raise NotImplementedError


def good_reply(user):
    return {
        "assumed_company": None,
        "snapshot": [{"text": "Acme builds payment software.", "source_ids": [1]}],
        "likely_questions": [{"text": "Why Acme?", "source_ids": []}],
    }


class ErrSearch:
    def __init__(self, exc):
        self.exc = exc

    async def search(self, query, *, allowed_domains=None):
        raise self.exc
