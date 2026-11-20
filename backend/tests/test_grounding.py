import pytest

from app.services.grounding import bullets, check_outline, cited_sources, outline_type

NOTES = (
    "Led the 2025 launch at Acme with a team of 6. Cut onboarding time by 30%. Used Python and SQL."
)


def outline(*points):
    body = "\n".join(f"- {p}" for p in points)
    return f"TYPE: behavioral\nOPENER: Let me share.\nPOINTS:\n{body}\nCLOSE: Thanks."


def test_bullets_strip_labels_and_ignore_other_lines():
    out = outline("Led a launch [note: Launch]", "Cut time by 30% [brief: blog]")
    assert bullets(out) == ["Led a launch", "Cut time by 30%"]


def test_clean_outline_has_no_flags():
    out = outline(
        "Led the 2025 launch with a team of 6 [note: Launch]",
        "Cut onboarding time by 30% [note: Launch]",
        "Used Python and SQL [note: Tools]",
    )
    assert check_outline(out, [NOTES]) == []


@pytest.mark.parametrize(
    "bullet",
    [
        "Cut onboarding time by 45%",  # invented number
        "Grew the team to 12 people",  # invented number
        "Worked at Globex on the same project",  # invented employer
        "Built it with Kubernetes and Terraform",  # invented tools
    ],
)
def test_invented_numbers_and_names_are_flagged(bullet):
    flagged = check_outline(outline(bullet + " [note: x]"), [NOTES])
    assert len(flagged) == 1


def test_only_the_offending_bullet_is_flagged():
    out = outline("Led the 2025 launch [note: a]", "Saved $2,000,000 for Initech [note: b]")
    flagged = check_outline(out, [NOTES])
    assert len(flagged) == 1 and "Initech" in flagged[0]


def test_facts_from_the_brief_and_the_question_are_allowed():
    out = outline(
        "Acme sells payment software to cafes [brief: blog]",
        "You asked about Berlin, where I'd be based [note: x]",
    )
    assert (
        check_outline(
            out,
            [NOTES, "Acme sells payment software to cafes in Europe."],
        )
        != []
    )
    ok = check_outline(out, [NOTES, "Acme sells payment software to cafes.", "Why Berlin?"])
    assert ok == []


def test_the_no_matching_story_bullet_and_star_framework_are_exempt():
    out = outline(
        "No matching story in your CV",
        "Use STAR: Situation, Task, Action, Result; bring a story about leading a team",
    )
    assert check_outline(out, [NOTES]) == []


def test_the_old_notes_wording_in_saved_sessions_is_still_recognised():
    out = outline("No matching story in your notes", "Use STAR: Situation, Task, Action, Result")
    assert check_outline(out, [NOTES]) == []


def test_sentence_initial_capital_is_not_treated_as_a_name():
    assert check_outline(outline("Mention the launch you led [note: a]"), [NOTES]) == []


def test_numbers_match_regardless_of_thousands_separators():
    assert check_outline(outline("Handled 1,200 tickets [note: a]"), ["Handled 1200 tickets"]) == []


def test_cited_sources_and_type():
    out = outline("A [note: Launch]", "B [brief: Acme blog]", "C [note: Launch]")
    assert cited_sources(out) == ["note: Launch", "brief: Acme blog"]
    assert outline_type(out) == "behavioral"
    assert outline_type("no type here") == ""


def test_general_advice_and_samples_may_name_things_not_in_the_cv():
    out = outline(
        "Explain the CAP theorem: with a partition you trade consistency for availability [general]",
        "Say the project cut costs by 20% for a retailer [sample]",
    )
    assert check_outline(out, [NOTES]) == []
    assert bullets(out)[0].endswith("availability")  # labels are still stripped


def test_a_cv_citation_is_still_checked_even_if_it_also_says_general():
    # Calling a claim "general" must not let an invented CV fact through.
    out = outline("Cut onboarding time by 45% [note: Launch] [general]")
    assert len(check_outline(out, [NOTES])) == 1


def test_an_unlabelled_invented_claim_is_still_flagged():
    assert len(check_outline(outline("Grew the team to 12 people"), [NOTES])) == 1


def test_the_answer_section_is_not_mistaken_for_a_bullet_but_its_numbers_are_checked():
    out = outline("Led the 2025 launch [note: Launch]") + (
        "\nSAMPLE ANSWER: For example, I grew a team to 50 people at Globex."
    )
    # "Globex" is a name, which is not checked outside labelled bullets; "50" is a number, which is.
    assert check_outline(out, [NOTES]) == ["For example, I grew a team to 50 people at Globex."]


NEW = (
    "TYPE: behavioral\nANSWER: At Acme I led the 2025 launch with a team of 6. "
    "Onboarding time fell by 30%. {extra}\nSOURCES:\n- Led the launch [note: Launch]\n"
)


def test_answer_text_is_what_sits_between_answer_and_sources():
    from app.services.grounding import answer_text

    assert answer_text(NEW.format(extra="")).startswith("At Acme I led the 2025 launch")
    assert "SOURCES" not in answer_text(NEW.format(extra=""))
    assert answer_text("TYPE: other\nOPENER: Hi\nPOINTS:\n- a") == ""


def test_numbers_in_the_answer_must_come_from_the_cv_or_the_question():
    assert check_outline(NEW.format(extra="That was nine years ago."), [NOTES]) == []
    flagged = check_outline(NEW.format(extra="I managed 14 engineers."), [NOTES])
    assert flagged == ["I managed 14 engineers."]


def test_a_number_from_the_question_is_allowed_in_the_answer():
    out = NEW.format(extra="Over the last 5 years I kept this up.")
    assert check_outline(out, [NOTES, "Tell me about the last 5 years"]) == []
