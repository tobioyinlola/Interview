"""The method ladder: the first available method wins, and nothing unbuilt is claimed."""

from app.autoapply import routing


def test_email_beats_a_browser_form():
    r = routing.choose(
        ["form", "email"], {"form": True, "email": True}, "https://jobs.lever.co/a/1"
    )
    assert (r.method, r.channel) == ("email", "email")


def test_browser_when_there_is_no_email_or_it_is_off():
    assert routing.choose(["form"], {"form": True, "email": True}).channel == "form"
    r = routing.choose(["form", "email"], {"form": True, "email": False})
    assert r.channel == "form"
    assert next(s for s in r.ladder if s.method == "email").why == "you switched it off"


def test_a_system_that_needs_an_account_goes_to_the_candidate():
    r = routing.choose(["form"], {"form": True}, "https://acme.wd1.myworkdayjobs.com/en/x/job/1")
    assert (r.method, r.channel) == ("candidate", "manual")
    assert (
        next(s for s in r.ladder if s.method == "browser").why == "this system asks for an account"
    )


def test_nothing_offered_goes_to_the_candidate():
    assert routing.choose([], {"form": True, "email": True}).channel == "manual"


def test_unbuilt_rungs_say_so():
    r = routing.choose(["form"], {"form": True})
    unbuilt = {s.method for s in r.ladder if s.why == "not built yet"}
    assert unbuilt == {"authorized_api", "http_form", "ai_assisted"}
    assert [s.method for s in r.ladder] == [
        "authorized_api", "http_form", "email", "browser", "ai_assisted", "candidate",
    ]  # fmt: skip
