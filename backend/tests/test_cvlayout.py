"""The look of an uploaded CV is read, kept, and used to draw the tailored CV as a PDF."""

import io
import zipfile

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

from app.autoapply import cvfile
from app.services.cvlayout import clean_profile, is_heading, read_layout

TEXT = (
    "Ada Okoye\nada@example.com | +234 801 234 5678 | Lagos\nlinkedin.com/in/adaokoye\n\n"
    "SUMMARY\nPayments product leader.\n\nSKILLS\nProduct strategy, Payments, SQL\n\n"
    "EXPERIENCE\nSenior Product Manager, Northwind (2021 - 2025)\n- Led the payments roadmap.\n\n"
    "EDUCATION\nBSc Computer Science"
)


def a_serif_cv_with_blue_headings() -> bytes:
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFillColorRGB(0.12, 0.25, 0.5)
    c.setFont("Times-Bold", 24)
    c.drawCentredString(w / 2, h - 60, "Ada Okoye")
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.setFont("Times-Roman", 10)
    c.drawCentredString(w / 2, h - 78, "ada@example.com | +234 801 234 5678 | Lagos")
    y = h - 120
    for head, rows in (
        ("EXPERIENCE", ["Senior Product Manager, Northwind (2021 - 2025)", "Led payments."]),
        ("EDUCATION", ["BSc Computer Science"]),
        ("SKILLS", ["Product strategy, Payments, SQL"]),
    ):
        c.setFillColorRGB(0.12, 0.25, 0.5)
        c.setFont("Times-Bold", 13)
        c.drawString(60, y, head)
        c.setStrokeColorRGB(0.12, 0.25, 0.5)
        c.line(60, y - 4, w - 60, y - 4)
        y -= 22
        for row in rows:
            c.setFillColorRGB(0, 0, 0)
            c.setFont("Times-Bold" if "(" in row else "Times-Roman", 10.5)
            c.drawString(60, y, row)
            y -= 15
        y -= 12
    c.save()
    return buf.getvalue()


def a_docx(centered: bool = True) -> bytes:
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    jc = '<w:jc w:val="center"/>' if centered else ""

    def para(text: str, size: int, bold: bool, color: str, ppr: str = "") -> str:
        b = "<w:b/>" if bold else ""
        return (
            f'<w:p><w:pPr>{ppr}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Georgia"/>{b}'
            f'<w:sz w:val="{size}"/><w:color w:val="{color}"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'
        )

    rule = '<w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr>'
    body = "".join(
        [
            para("Ada Okoye", 44, True, "7A1F3D", jc),
            para("ada@example.com | +234 801 234 5678", 20, False, "555555", jc),
            para("EXPERIENCE", 26, True, "7A1F3D", rule),
            para("Senior Product Manager, Northwind (2021 - 2025)", 22, True, "000000"),
            para("Led the payments roadmap.", 22, False, "000000"),
            para("EDUCATION", 26, True, "7A1F3D", rule),
            para("BSc Computer Science", 22, False, "000000"),
        ]
    )
    doc = (
        f'<w:document {ns}><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        "</w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


def test_the_look_of_a_pdf_cv_is_read():
    look = read_layout(a_serif_cv_with_blue_headings(), "pdf")
    assert look is not None
    assert look["font"] == "Times-Roman"
    assert look["name"]["align"] == "center" and look["name"]["bold"]
    assert look["name"]["size"] == 24 and look["name"]["color"] == "#1f4080"
    assert look["heading"]["upper"] and look["heading"]["bold"] and look["heading"]["rule"]
    assert look["heading"]["color"] == "#1f4080" and look["accent"] == "#1f4080"
    assert look["body"]["size"] == 10.5 and look["body"]["entry_bold"]


def test_the_look_of_a_word_cv_is_read():
    look = read_layout(a_docx(), "docx")
    assert look is not None
    assert look["name"]["color"] == "#7a1f3d" and look["name"]["align"] == "center"
    assert look["font"] == "Times-Roman"  # Georgia is a serif face
    assert look["heading"]["rule"] and look["heading"]["size"] == 13
    assert look["page"]["left"] == 56.7  # 1134 twips


def test_a_plain_text_cv_or_a_broken_file_has_no_look_and_never_fails():
    assert read_layout(b"just some words", "txt") is None
    assert read_layout(b"%PDF-1.4 not really", "pdf") is None
    assert read_layout(b"PK\x03\x04nope", "docx") is None


def test_the_tailored_cv_is_drawn_in_the_look_of_the_uploaded_one():
    look = read_layout(a_serif_cv_with_blue_headings(), "pdf")
    pdf = cvfile.render_pdf(TEXT, look)
    assert pdf.startswith(b"%PDF")
    words = cvfile.pdf_text(pdf)
    for line in ("Ada Okoye", "SUMMARY", "Payments product leader.", "BSc Computer Science"):
        assert line in words
    assert "Led the payments roadmap." in words
    # read back, the new file looks like the one it copied
    again = read_layout(pdf, "pdf")
    assert again is not None
    assert again["font"] == "Times-Roman" and again["heading"]["color"] == "#1f4080"
    assert again["name"]["align"] == "center" and again["heading"]["rule"]


def test_without_a_look_the_plain_pdf_is_made_as_before():
    plain = cvfile.render_pdf(TEXT)
    assert cvfile.pdf_text(plain).splitlines()[0] == "Ada Okoye"
    assert cvfile.render_pdf(TEXT, {"v": 2}) == plain  # an unknown profile is ignored


def test_a_long_cv_flows_onto_more_pages():
    look = read_layout(a_serif_cv_with_blue_headings(), "pdf")
    body = (
        TEXT + "\n" + "\n".join(f"- Shipped project number {i} for a customer." for i in range(120))
    )
    pdf = cvfile.render_pdf(body, look)
    from pypdf import PdfReader

    assert len(PdfReader(io.BytesIO(pdf)).pages) >= 2


def test_a_stored_profile_is_forced_into_a_safe_range():
    bad = {
        "v": 1,
        "page": {"w": 1e9, "h": -5, "left": "x", "right": float("nan")},
        "font": "Comic Sans",
        "name": {"size": 9999, "color": "red; drop table"},
        "heading": {"size": 0},
    }
    ok = clean_profile(bad)
    assert ok is not None
    assert ok["page"]["w"] == 900 and ok["page"]["h"] == 400 and ok["page"]["left"] == 50
    assert ok["font"] == "Helvetica" and ok["name"]["size"] == 40
    assert ok["name"]["color"] == "#000000" and ok["heading"]["size"] == 8
    assert clean_profile("junk") is None and clean_profile({"v": 9}) is None
    assert cvfile.render_pdf(TEXT, bad).startswith(b"%PDF")  # still drawable


def test_section_names_are_told_from_ordinary_lines():
    assert is_heading("EXPERIENCE") and is_heading("Work history:") and is_heading("Skills")
    assert not is_heading("Senior Product Manager, Northwind (2021 - 2025)")
    assert not is_heading("ada@example.com")
