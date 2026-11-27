"""Every CV is drawn in the house layout (set from a reference CV)."""

import io

from pypdf import PdfReader

from app.autoapply import cvfile

CV = """Justus Oyinlola
justus@example.com | +234 703 244 7412 | Lagos, Nigeria
linkedin.com/in/justusoyinlola

SUMMARY
Senior Product Manager with 5+ years building fintech products.

SKILLS
Consumer Funnel, KYC/KYB, Cross-Border Payments, SQL

EXPERIENCE
Senior Product Manager, Bitstac (Jan 2026 - Aug 2026)
- Owned the consumer transaction funnel end to end.
- Scaled the platform to over $45M in monthly volume.
Product Manager, Vurt (Mar 2023 - Feb 2024)
Led feature development for cross-border settlement. Integrated real-time transaction APIs.

EDUCATION
Bachelor of Science (B.Sc.) in Industrial Chemistry - Obafemi Awolowo University (Graduated 2020)

TOOLS
Analytics: Google Analytics · Mixpanel · SQL
"""


def lines(pdf: bytes) -> list[str]:
    return cvfile.pdf_text(pdf).splitlines()


def test_the_name_is_in_capitals_over_one_contact_line_in_a_fixed_order():
    got = lines(cvfile.render_pdf(CV))
    assert got[0] == "JUSTUS OYINLOLA"
    # place, phone, email, then the link: whatever order they were written in
    assert (
        got[1]
        == "Lagos, Nigeria | +234 703 244 7412 | justus@example.com | linkedin.com/in/justusoyinlola"
    )


def test_headings_take_the_house_names_and_the_skills_become_one_bulleted_line():
    got = cvfile.pdf_text(cvfile.render_pdf(CV))
    for heading in (
        "PROFESSIONAL SUMMARY",
        "CORE COMPETENCIES",
        "PROFESSIONAL EXPERIENCE",
        "EDUCATION",
    ):
        assert heading in got
    for item in ("Consumer Funnel", "KYC/KYB", "Cross-Border Payments", "SQL"):
        assert item in got


def test_a_job_has_its_title_then_its_dates_then_the_company_then_its_points():
    got = lines(cvfile.render_pdf(CV))
    i = got.index("Senior Product Manager")
    assert got[i + 1] == "Jan 2026 – Aug 2026"  # the hyphen becomes an en dash
    assert got[i + 2] == "Bitstac"
    assert "Owned the consumer transaction funnel end to end." in got[i + 3]


def test_a_paragraph_under_a_job_becomes_one_point_per_sentence():
    got = cvfile.pdf_text(cvfile.render_pdf(CV))
    assert "Led feature development for cross-border settlement." in got
    assert "Integrated real-time transaction APIs." in got


def test_education_and_labelled_lines_are_kept():
    got = cvfile.pdf_text(cvfile.render_pdf(CV))
    assert "Bachelor of Science (B.Sc.) in Industrial Chemistry — Obafemi Awolowo University" in got
    assert "Analytics: Google Analytics · Mixpanel · SQL" in got


def test_the_page_is_us_letter_and_long_text_runs_onto_more_pages():
    short = PdfReader(io.BytesIO(cvfile.render_pdf(CV)))
    assert len(short.pages) == 1
    box = short.pages[0].mediabox
    assert (float(box.width), float(box.height)) == (612.0, 792.0)
    long = CV + "\nPROJECTS\n" + "- A project that shipped on time.\n" * 150
    assert len(PdfReader(io.BytesIO(cvfile.render_pdf(long))).pages) >= 3


def test_odd_text_never_breaks_the_file():
    for text in (
        "",
        "   \n",
        "Only a name",
        "Ada\n\nSUMMARY\n",
        "Ada 😀 Ökoye\nEXPERIENCE\nChef, 中文 (2020 - 2021)",
    ):
        assert cvfile.render_pdf(text).startswith(b"%PDF-")


def test_a_cover_note_is_a_plain_letter_not_the_cv_layout():
    got = cvfile.pdf_text(cvfile.render_letter("Dear team,\n\nI would like to apply."))
    assert got.splitlines()[0] == "Dear team,"
    assert "PROFESSIONAL" not in got
