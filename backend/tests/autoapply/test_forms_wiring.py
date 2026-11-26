"""What the form filler is given: contact answers from the verified facts, questions the live form
asks (with their choices), and which adapter a server uses."""

from app.autoapply import forms, package
from app.autoapply.adapters import FormField, FormSchema
from app.autoapply.fixtures import FixtureForm
from app.autoapply.outbox import form_problem
from app.config import Settings
from tests.autoapply.conftest import FACTS


def test_the_facts_answer_the_usual_contact_questions_and_nothing_more():
    v = package.contact_values(
        {**FACTS, "links": ["https://linkedin.com/in/ada", "https://ada.dev"]}
    )
    assert v["first_name"] == "Ada" and v["last_name"] == "Okoye" and v["name"] == "Ada Okoye"
    assert v["email"] == "ada@example.com" and v["phone"] == "+234 801 234 5678"
    assert v["location"] == "Lagos, Nigeria" and v["country"] == "Nigeria"
    assert v["linkedin"].endswith("/ada") and v["website"] == "https://ada.dev"
    assert v["current_company"] == "Northwind"
    assert "github" not in v  # nothing is made up for a link the CV does not have


def test_a_one_word_name_leaves_the_last_name_to_be_asked():
    v = package.contact_values({"contact": {"name": "Madonna", "email": "m@example.com"}})
    assert v["first_name"] == "Madonna" and "last_name" not in v


def test_the_form_asks_only_what_the_package_cannot_answer_and_offers_the_choices():
    schema = FormSchema(
        [
            FormField("first_name", "First Name"),
            FormField("resume", "CV", kind="file"),
            FormField("cover_letter", "Cover letter", required=False, kind="file"),
            FormField("references", "References", required=False, kind="file"),
            FormField("q1", "Authorized to work?", kind="choice", options=["Yes", "No"]),
            FormField("q2", "Anything else?", required=False),
        ],
        "v",
    )
    pkg = {"answers": {"first_name": {"value": "Ada", "source": "x"}}}
    [need] = form_problem(schema, pkg) or []
    assert need["field"] == "q1" and need["options"] == ["Yes", "No"]
    # an optional file nobody can supply does not block, a required unknown one does
    schema.fields.append(FormField("portfolio_pdf", "Portfolio", required=True, kind="file"))
    kinds = {n["field"]: n["kind"] for n in form_problem(schema, pkg) or []}
    assert kinds == {"q1": "answer", "portfolio_pdf": "unsupported"}


def test_a_captcha_is_always_handed_back():
    schema = FormSchema([FormField("captcha", "Prove you are human", kind="captcha")], "v")
    [need] = form_problem(schema, {"answers": {}}) or []
    assert need["kind"] == "unsupported"


def test_the_fixture_is_used_unless_the_browser_is_asked_for():
    assert isinstance(forms.build(Settings()), FixtureForm)
    s = Settings(autoapply_form_adapter="browser", autoapply_form_hosts="Jobs.Example.com, x.io")
    f = forms.build(s)
    assert f.name == "browser" and f.real is True and f.hosts == ("jobs.example.com", "x.io")
    default = forms.build(Settings(autoapply_form_adapter="browser"))
    assert default.supports("https://job-boards.greenhouse.io/acme/jobs/1")


def test_any_public_application_link_can_be_tried_when_the_operator_allows_it():
    from app.autoapply.browserform import BrowserForm

    f = forms.build(Settings(autoapply_form_adapter="browser", autoapply_form_hosts="*"))
    assert f.any_site is True
    for ok in (
        "https://jobs.lever.co/acme/1",
        "https://careers.example.com/apply/7?gh_jid=1",
        "https://acme.wd5.myworkdayjobs.com/en-US/External/job/X_R-1",
    ):
        assert f.supports(ok), ok
    # never over plain http, and never anything that is not a public website
    for bad in (
        "http://jobs.example.com/apply",
        "https://localhost/apply",
        "https://127.0.0.1/apply",
        "https://10.0.0.5/apply",
        "https://169.254.169.254/latest/meta-data",
        "https://service.railway.internal/apply",
        "https://intranet/apply",
        "https://user:pass@jobs.example.com/apply",
        "https://jobs.example.com:8443/apply",
        "https://www.linkedin.com/in/someone",
        "ftp://jobs.example.com/apply",
        "",
    ):
        assert not f.supports(bad), bad
    # the default and a named list are as strict as before
    assert not BrowserForm().supports("https://jobs.lever.co/acme/1")
    assert not forms.build(
        Settings(autoapply_form_adapter="browser", autoapply_form_hosts="x.io")
    ).supports("https://jobs.lever.co/acme/1")


async def test_a_name_that_points_at_a_private_address_is_refused_before_a_browser_opens(
    monkeypatch,
):
    import pytest

    from app.autoapply import browserform
    from app.autoapply.adapters import AdapterError
    from app.services.url_guard import UrlRejected

    async def refuse(url):
        raise UrlRejected("private")

    monkeypatch.setattr(browserform, "validate_public_url", refuse)
    f = browserform.BrowserForm(hosts=("*",))
    with pytest.raises(AdapterError) as e:
        await f._session("https://jobs.example.com/apply")
    assert e.value.code == "rejected"
