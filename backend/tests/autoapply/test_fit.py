"""The weighted fit score: worked out with plain rules after every hard requirement passed, with a
reason for each factor; off until calibrated; when on, weak fits wait for the person or are
skipped, and a person's 'apply anyway' is kept."""

from datetime import UTC, datetime

import pytest

from app.autoapply import fit, matching, pipeline
from app.models import JobPosting

from .conftest import FACTS, PROFILE, apps, job, run, start

NOW = datetime(2026, 11, 26, tzinfo=UTC)


def posting(**over) -> JobPosting:  # type: ignore[no-untyped-def]
    base = dict(
        title="Senior Product Manager",
        company="Acme",
        description=(
            "Lead our payments product. You know SQL and product strategy, and have 5+ years in "
            "fintech product roles. Remote across Africa."
        ),
        industry="fintech",
        seniority=None,
        region="Nigeria",
        arrangement="remote",
    )
    base.update(over)
    return JobPosting(**base)


def judge(p: JobPosting, criteria=None):  # type: ignore[no-untyped-def]
    criteria = criteria or PROFILE["criteria"]
    m = matching.evaluate(criteria, p, now=NOW, routes={"form"}, channels={"form": True})
    return fit.score(criteria, FACTS, p, m, NOW)


def test_a_strong_match_scores_high_and_explains_every_factor() -> None:
    f = judge(posting())
    by = {x.key: x for x in f.factors}
    assert f.score >= 85
    assert by["skills"].value == 1 and "Payments" in by["skills"].why
    assert by["experience"].value == 1 and "about 7" in by["experience"].why  # 2018 to 2025
    assert by["role"].value == 1 and by["seniority"].value == 1
    assert [x.weight for x in f.factors] == [30, 25, 20, 10, 10, 5]


def test_unknown_factors_count_as_half_and_say_so_never_a_guess() -> None:
    f = judge(posting(description="", industry=None))
    by = {x.key: x for x in f.factors}
    assert by["skills"].known is False and by["skills"].value == 0.5
    assert by["industry"].known is False


def test_a_poor_match_scores_low() -> None:
    p = posting(
        title="Product Manager, Hardware",
        description="10 years building consumer electronics; CAD; supply chain. On site in Berlin.",
        industry="hardware",
    )
    assert judge(p, {"roles": [{"value": "Product Manager", "required": True}]}).score < 70


def test_the_weights_can_be_changed() -> None:
    w = fit.weights("skills=50,role=0")
    assert w["skills"] == 50 and w["role"] == 0 and w["experience"] == 25


@pytest.fixture
def scoring(monkeypatch, settings):  # type: ignore[no-untyped-def]
    settings.autoapply_fit_scoring = True
    monkeypatch.setattr(pipeline, "fit_settings", lambda: settings)
    return settings


async def test_when_on_a_weak_fit_waits_for_the_person_and_apply_anyway_is_kept(
    ada, discovery_source, scoring
):
    await start(ada)
    discovery_source.postings = [job(1, description="Lead payments. SQL. Remote.")]
    scoring.autoapply_fit_auto = 99.0  # make this job a 'review' one
    await run(ada)
    (a,) = await apps(ada)
    assert a["status"] == "needs_input" and a["needs_input"][0]["kind"] == "fit"
    r = await ada.post(f"/api/autoapply/applications/{a['id']}/approve", json={"rule": "fit"})
    assert r.status_code == 200 and r.json()["status"] == "queued"


async def test_when_on_a_fit_below_the_bar_is_skipped_with_its_score(
    ada, discovery_source, scoring
):
    await start(ada)
    discovery_source.postings = [job(1, description="Lead payments. Remote.")]
    scoring.autoapply_fit_review = 99.0
    await run(ada)
    (a,) = await apps(ada)
    assert a["status"] == "skipped" and "fit" in a["skip_reason"]


async def test_off_by_default_nothing_changes(ada, discovery_source):
    await start(ada)
    discovery_source.postings = [job(1)]
    await run(ada)
    (a,) = await apps(ada)
    assert a["status"] == "queued" and "fit" not in (a.get("match") or {})
