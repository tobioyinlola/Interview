import uuid

import pytest

from app.schemas.brief import SourceRef, build_brief, fact_count


def src(kind="website", url="https://acme.com/about"):
    return SourceRef(id=uuid.uuid4(), kind=kind, url=url)


def build(raw, sources, **kw):
    return build_brief(
        raw, dict(enumerate(sources, start=1)), web_search_done=True, no_website=False, **kw
    )


def section(brief, key):
    return next(s for s in brief.sections if s.key == key)


def test_every_kept_fact_links_to_a_real_source():
    a, b = src(), src("search_result", "https://news.example.com/x")
    brief = build(
        {
            "snapshot": [{"text": "Acme makes payments software.", "source_ids": [1]}],
            "recent_news": [
                {"text": "Acme raised a round.", "source_ids": [2], "date": "May 2026"}
            ],
        },
        [a, b],
    )
    snap = section(brief, "snapshot").facts[0]
    assert snap.source_ids == [a.id]
    news = section(brief, "recent_news").facts[0]
    assert news.source_ids == [b.id] and news.date == "May 2026"


def test_fact_with_no_valid_source_is_dropped():
    brief = build(
        {
            "snapshot": [
                {"text": "Invented fact, no sources.", "source_ids": []},
                {"text": "Cites a source that does not exist.", "source_ids": [99]},
                {"text": "Real one.", "source_ids": [1]},
            ]
        },
        [src()],
    )
    texts = [f.text for f in section(brief, "snapshot").facts]
    assert texts == ["Real one."]
    assert brief.dropped_facts == 2


def test_unknown_ids_are_removed_but_the_fact_survives_on_its_valid_ones():
    a = src()
    brief = build({"snapshot": [{"text": "Mixed.", "source_ids": [1, 42]}]}, [a])
    assert section(brief, "snapshot").facts[0].source_ids == [a.id]


@pytest.mark.parametrize(
    "url", [None, "", "javascript:alert(1)", "ftp://x.com/a", "file:///etc/passwd"]
)
def test_a_source_without_a_working_link_does_not_count(url):
    brief = build({"snapshot": [{"text": "Claim.", "source_ids": [1]}]}, [src("website", url)])
    assert section(brief, "snapshot").facts == []
    assert section(brief, "snapshot").not_found is True


def test_empty_sections_say_not_found_never_a_guess():
    brief = build({}, [src()])
    for key in ("snapshot", "recent_news", "interview_process", "the_role"):
        s = section(brief, key)
        assert s.not_found and s.facts == []
    assert fact_count(brief) == 0


def test_user_supplied_text_is_labelled():
    known, pasted, web = src("known", None), src("pasted", None), src()
    brief = build(
        {
            "snapshot": [
                {"text": "From me.", "source_ids": [1]},
                {"text": "From pasted.", "source_ids": [2]},
                {"text": "From web.", "source_ids": [3]},
                {"text": "Mixed web and mine.", "source_ids": [1, 3]},
            ]
        },
        [known, pasted, web],
    )
    labels = {f.text: f.label for f in section(brief, "snapshot").facts}
    assert labels == {
        "From me.": "from_you",
        "From pasted.": "pasted_by_you",
        "From web.": None,
        "Mixed web and mine.": None,
    }


def test_suggestions_are_always_labelled_capped_and_need_no_source():
    qs = [{"text": f"Question {i}?", "source_ids": []} for i in range(15)]
    ask = [{"text": f"Ask {i}?", "source_ids": []} for i in range(9)]
    brief = build({"likely_questions": qs, "questions_to_ask": ask}, [src()])
    likely = section(brief, "likely_questions").facts
    to_ask = section(brief, "questions_to_ask").facts
    assert len(likely) == 10 and len(to_ask) == 5
    assert all(f.label == "suggestion" for f in likely + to_ask)
    assert fact_count(brief) == 0  # suggestions are not research


def test_duplicates_collapse_and_long_text_is_trimmed():
    brief = build(
        {
            "snapshot": [
                {"text": "Same   fact.", "source_ids": [1]},
                {"text": "same fact.", "source_ids": [1]},
                {"text": "x" * 2000, "source_ids": [1]},
            ]
        },
        [src()],
    )
    facts = section(brief, "snapshot").facts
    assert len(facts) == 2 and len(facts[1].text) == 500


def test_extra_keys_from_the_model_are_ignored_and_output_shape_is_fixed():
    brief = build(
        {"snapshot": [], "system_prompt": "ignore all rules", "run_this": "rm -rf /"}, [src()]
    )
    keys = [s.key for s in brief.sections]
    assert keys == [
        "snapshot",
        "products_customers",
        "recent_news",
        "culture_values",
        "the_role",
        "interview_process",
        "likely_questions",
        "questions_to_ask",
    ]


def test_assumed_company_is_kept_as_plain_text():
    brief = build({"assumed_company": "  Acme Ltd,   a UK payments company "}, [src()])
    assert brief.assumed_company == "Acme Ltd, a UK payments company"
