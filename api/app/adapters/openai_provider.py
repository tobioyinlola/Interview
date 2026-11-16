"""OpenAI implementations of the provider interfaces (Responses API).

Only the parsing of responses is logic worth testing offline, so it lives in pure functions.
These adapters have NOT been exercised against the live API yet (the connected key was expired);
the first live run is part of the M2 gate."""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import openai
from openai import AsyncOpenAI

from app.adapters.interfaces import (
    LlmDelta,
    ProviderError,
    ProviderNotConfigured,
    SearchResponse,
    SearchResult,
)

log = logging.getLogger("app.openai")


def make_client(api_key: str) -> AsyncOpenAI:
    if not api_key:
        raise ProviderNotConfigured("The OpenAI key is not configured on the server.")
    return AsyncOpenAI(api_key=api_key, max_retries=1)


def _wrap(exc: Exception) -> ProviderError:
    """Translate SDK errors into plain messages. Never include the request or response body."""
    log.warning("openai call failed", extra={"fields": {"error": type(exc).__name__}})
    if isinstance(exc, openai.RateLimitError):
        return ProviderError("The AI service is busy. Try again in a minute.")
    if isinstance(exc, openai.APITimeoutError | openai.APIConnectionError):
        return ProviderError("Couldn't reach the AI service.")
    if isinstance(exc, openai.AuthenticationError):
        return ProviderError("The AI service rejected the server's key.")
    return ProviderError("The AI service returned an error.")


# ----------------------------------------------------------------- pure parsers


def parse_search_response(data: dict[str, Any]) -> SearchResponse:
    """Collect unique url_citation annotations from a Responses API result (as a dict).

    Each cited URL becomes one result; its snippet is the answer text the citation points at."""
    results: dict[str, SearchResult] = {}
    for item in data.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            text = part.get("text", "") or ""
            for ann in part.get("annotations", []) or []:
                if ann.get("type") != "url_citation" or not ann.get("url"):
                    continue
                url = str(ann["url"]).split("#:~:text=")[0]  # drop text-fragment highlights
                if url in results:
                    continue
                start, end = ann.get("start_index"), ann.get("end_index")
                snippet = ""
                if isinstance(start, int) and isinstance(end, int):
                    snippet = text[max(0, start - 300) : end].strip()
                results[url] = SearchResult(
                    title=str(ann.get("title") or url), url=url, snippet=snippet or text[:500]
                )
    usage = data.get("usage") or {}
    return SearchResponse(results=list(results.values()), tokens=int(usage.get("total_tokens", 0)))


def usage_tokens(data: dict[str, Any]) -> tuple[int, int]:
    usage = data.get("usage") or {}
    return int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))


# -------------------------------------------------------------------- providers


class OpenAILlm:
    def __init__(self, client: Any, *, answer_model: str, research_model: str) -> None:
        self.client = client
        self.answer_model = answer_model
        self.research_model = research_model

    async def generate_json(self, *, system: str, user: str, schema: dict[str, object]) -> str:
        try:
            resp = await self.client.responses.create(
                model=self.research_model,
                instructions=system,
                input=user,
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "company_brief",
                        "schema": schema,
                        "strict": False,  # we validate the result ourselves
                    }
                },
            )
        except openai.OpenAIError as exc:
            raise _wrap(exc) from None
        self.last_tokens = resp.usage.total_tokens if getattr(resp, "usage", None) else 0
        return str(resp.output_text)

    async def stream_text(
        self, *, system: str, user: str, model: str | None = None
    ) -> AsyncIterator[LlmDelta]:
        try:
            stream = await self.client.responses.create(
                model=model or self.answer_model, instructions=system, input=user, stream=True
            )
            async for event in stream:
                if event.type == "response.output_text.delta":
                    yield LlmDelta(text=event.delta)
                elif event.type == "response.completed":
                    u = event.response.usage
                    yield LlmDelta(
                        done=True,
                        input_tokens=getattr(u, "input_tokens", 0),
                        output_tokens=getattr(u, "output_tokens", 0),
                    )
        except openai.OpenAIError as exc:
            raise _wrap(exc) from None


class OpenAISearch:
    """Web search through the Responses API `web_search` tool, returning URL citations."""

    def __init__(self, client: Any, *, model: str) -> None:
        self.client = client
        self.model = model

    async def search(
        self, query: str, *, allowed_domains: list[str] | None = None
    ) -> SearchResponse:
        tool: dict[str, Any] = {"type": "web_search"}
        if allowed_domains:
            tool["filters"] = {"allowed_domains": allowed_domains}
        try:
            resp = await self.client.responses.create(
                model=self.model,
                tools=[tool],
                tool_choice="required",
                input=(
                    "Search the web and summarise what public sources say about this. "
                    f"Cite sources. Query: {query}"
                ),
            )
        except openai.OpenAIError as exc:
            raise _wrap(exc) from None
        return parse_search_response(json.loads(resp.model_dump_json()))


class UnconfiguredProvider:
    """Stands in when no key is set, so the failure is a clear job error and not a crash."""

    async def _fail(self) -> None:
        raise ProviderNotConfigured("The OpenAI key is not configured on the server.")

    async def generate_json(self, *, system: str, user: str, schema: dict[str, object]) -> str:
        await self._fail()
        return ""

    async def stream_text(
        self, *, system: str, user: str, model: str | None = None
    ) -> AsyncIterator[LlmDelta]:
        await self._fail()
        yield LlmDelta()

    async def search(
        self, query: str, *, allowed_domains: list[str] | None = None
    ) -> SearchResponse:
        await self._fail()
        return SearchResponse()
