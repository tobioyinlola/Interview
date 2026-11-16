import json
from types import SimpleNamespace

import openai
import pytest

from app.adapters.interfaces import ProviderError, ProviderNotConfigured
from app.adapters.openai_provider import (
    OpenAILlm,
    OpenAISearch,
    UnconfiguredProvider,
    make_client,
    parse_search_response,
)

SEARCH_RESPONSE = {
    "output": [
        {"type": "web_search_call", "id": "ws_1", "status": "completed"},
        {
            "type": "message",
            "content": [
                {
                    "type": "output_text",
                    "text": "Acme raised a Series B in May 2026. It sells point-of-sale software.",
                    "annotations": [
                        {
                            "type": "url_citation",
                            "url": "https://news.example.com/acme#:~:text=Series",
                            "title": "Acme raises Series B",
                            "start_index": 0,
                            "end_index": 36,
                        },
                        {
                            "type": "url_citation",
                            "url": "https://news.example.com/acme",
                            "title": "duplicate",
                            "start_index": 0,
                            "end_index": 5,
                        },
                        {
                            "type": "url_citation",
                            "url": "https://acme.com/products",
                            "title": "Acme products",
                            "start_index": 37,
                            "end_index": 70,
                        },
                        {"type": "file_citation", "file_id": "f1"},
                    ],
                }
            ],
        },
    ],
    "usage": {"total_tokens": 1234},
}


def test_parse_search_response_dedupes_urls_and_keeps_only_url_citations():
    out = parse_search_response(SEARCH_RESPONSE)
    assert [r.url for r in out.results] == [
        "https://news.example.com/acme",
        "https://acme.com/products",
    ]
    assert out.results[0].title == "Acme raises Series B"
    assert "Series B" in out.results[0].snippet
    assert out.tokens == 1234


def test_parse_search_response_handles_empty_and_odd_shapes():
    assert parse_search_response({}).results == []
    assert parse_search_response({"output": [{"type": "message", "content": [{}]}]}).results == []


def test_missing_key_raises_a_clear_error():
    with pytest.raises(ProviderNotConfigured):
        make_client("")


class FakeResponses:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.kwargs = result, error, None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return self.result


def fake_client(**kw):
    return SimpleNamespace(responses=FakeResponses(**kw))


async def test_generate_json_sends_the_schema_and_returns_text():
    result = SimpleNamespace(output_text='{"a": 1}', usage=SimpleNamespace(total_tokens=5))
    client = fake_client(result=result)
    llm = OpenAILlm(client, answer_model="a", research_model="r")
    out = await llm.generate_json(system="sys", user="usr", schema={"type": "object"})
    assert json.loads(out) == {"a": 1}
    sent = client.responses.kwargs
    assert sent["model"] == "r" and sent["instructions"] == "sys" and sent["input"] == "usr"
    assert sent["text"]["format"]["schema"] == {"type": "object"}


async def test_search_requests_the_web_search_tool_and_domain_filter():
    result = SimpleNamespace(model_dump_json=lambda: json.dumps(SEARCH_RESPONSE))
    client = fake_client(result=result)
    out = await OpenAISearch(client, model="m").search("acme news", allowed_domains=["acme.com"])
    sent = client.responses.kwargs
    assert sent["tools"] == [{"type": "web_search", "filters": {"allowed_domains": ["acme.com"]}}]
    assert "acme news" in sent["input"]
    assert len(out.results) == 2


def _status_error(cls):
    import httpx

    req = httpx.Request("POST", "https://api.openai.com/v1/responses")
    return cls("secret request detail", response=httpx.Response(429, request=req), body=None)


@pytest.mark.parametrize(
    "exc,expected",
    [
        (_status_error(openai.RateLimitError), "busy"),
        (_status_error(openai.AuthenticationError), "rejected"),
        (openai.APITimeoutError(request=None), "reach"),
    ],
)
async def test_sdk_errors_become_plain_messages_without_leaking_details(exc, expected):
    llm = OpenAILlm(fake_client(error=exc), answer_model="a", research_model="r")
    with pytest.raises(ProviderError) as e:
        await llm.generate_json(system="s", user="u", schema={})
    assert expected in e.value.message
    assert "secret request detail" not in e.value.message


async def test_unconfigured_provider_fails_clearly():
    p = UnconfiguredProvider()
    with pytest.raises(ProviderNotConfigured):
        await p.generate_json(system="", user="", schema={})
    with pytest.raises(ProviderNotConfigured):
        await p.search("x")
