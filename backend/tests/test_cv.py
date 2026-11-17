import io
import zipfile

import httpx
import pytest
from pypdf import PdfWriter

from app.schemas.api import NOTES_MAX
from app.services.cv import CvError, clean, extract_text, safe_filename, sniff
from tests.cvfiles import CV_LINES, docx, pdf

PDF_CV = pdf(["\n".join(CV_LINES)])
DOCX_CV = docx(CV_LINES)


# ------------------------------------------------------------------ reading files


def test_a_text_pdf_is_read() -> None:
    out = extract_text(PDF_CV)
    assert out.kind == "pdf" and not out.truncated
    assert "Led the payments migration at Northfield" in out.text and "18 percent" in out.text


def test_a_word_file_is_read_with_its_paragraphs() -> None:
    out = extract_text(DOCX_CV)
    assert out.kind == "docx"
    assert out.text.splitlines() == CV_LINES


def test_plain_text_is_read_including_a_byte_order_mark() -> None:
    out = extract_text("\ufeffSenior PM\nLed a launch.".encode())
    assert out.kind == "txt" and out.text == "Senior PM\nLed a launch."


def test_the_type_comes_from_the_bytes_not_the_name() -> None:
    assert sniff(PDF_CV) == "pdf" and sniff(DOCX_CV) == "docx"
    assert sniff(b"just some text") == "txt"


def test_a_pdf_with_no_text_such_as_a_scan_is_refused_with_advice() -> None:
    with pytest.raises(CvError) as e:
        extract_text(pdf([""]))
    assert e.value.code == "cv_no_text" and "scan" in e.value.message


def test_a_password_protected_pdf_is_refused() -> None:
    w = PdfWriter()
    w.add_blank_page(612, 792)
    w.encrypt("secret", algorithm="RC4-128")
    buf = io.BytesIO()
    w.write(buf)
    with pytest.raises(CvError) as e:
        extract_text(buf.getvalue())
    assert e.value.code == "cv_password_protected"


def test_a_pdf_over_twenty_pages_is_refused() -> None:
    with pytest.raises(CvError) as e:
        extract_text(pdf(["page"] * 21))
    assert e.value.code == "cv_too_long"
    assert extract_text(pdf(["page"] * 20)).kind == "pdf"


@pytest.mark.parametrize(
    "data, code",
    [
        (b"", "cv_empty"),
        (b"\xd0\xcf\x11\xe0" + b"\x00" * 600, "unsupported_cv_type"),  # old .doc
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "unsupported_cv_type"),  # an image
        (b"MZ\x90\x00" + b"\x00" * 100, "unsupported_cv_type"),  # a program
        (b"\xff\xfe\xfa\xfb plain? no", "unsupported_cv_type"),  # not UTF-8
        (b"PK\x03\x04 not really a zip", "cv_unreadable"),
        (b"%PDF-1.4 this is not a real pdf", "cv_unreadable"),
    ],
)
def test_files_that_are_not_a_cv_are_refused_with_a_reason(data: bytes, code: str) -> None:
    with pytest.raises(CvError) as e:
        extract_text(data)
    assert e.value.code == code and e.value.message


def test_a_zip_that_is_not_a_word_file_is_refused() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "hi")
    with pytest.raises(CvError) as e:
        extract_text(buf.getvalue())
    assert e.value.code == "unsupported_cv_type"


WNS = b'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def test_a_word_file_that_unpacks_to_a_huge_document_is_refused_unread() -> None:
    # well-formed XML, so only the size guards can be what stops it
    bomb = docx(
        [], raw_xml=b"<w:document " + WNS + b">" + b" " * (9 * 1024 * 1024) + b"</w:document>"
    )
    assert len(bomb) < 60_000  # tiny on the wire, 9 MB once unpacked
    with pytest.raises(CvError) as e:
        extract_text(bomb)
    assert e.value.code == "cv_unreadable"


@pytest.mark.parametrize(
    "xml",
    [
        b'<!DOCTYPE d [<!ENTITY a "aaaa">]><w:document '
        + WNS
        + b"><w:body>&a;</w:body></w:document>",
        b"<!DOCTYPE lolz><w:document " + WNS + b"/>",
        b'<!ENTITY x "y"><w:document ' + WNS + b"/>",
    ],
)
def test_xml_that_declares_entities_or_a_doctype_is_refused(xml: bytes) -> None:
    with pytest.raises(CvError) as e:
        extract_text(docx([], raw_xml=xml))
    assert e.value.code == "cv_unreadable"


def test_the_same_well_formed_document_without_a_doctype_is_read() -> None:
    xml = (
        b"<w:document "
        + WNS
        + b"><w:body><w:p><w:r><w:t>Fine</w:t></w:r></w:p></w:body></w:document>"
    )
    assert extract_text(docx([], raw_xml=xml)).text == "Fine"


def test_an_old_word_file_gets_a_message_that_says_what_to_do() -> None:
    with pytest.raises(CvError) as e:
        extract_text(b"\xd0\xcf\x11\xe0" + b"\x00" * 600)
    assert e.value.status == 415 and ".docx" in e.value.message and "old Word" in e.value.message


def test_a_file_over_five_megabytes_is_refused() -> None:
    with pytest.raises(CvError) as e:
        extract_text(b"a" * (5 * 1024 * 1024 + 1))
    assert e.value.status == 413 and e.value.code == "cv_too_large"


def test_a_long_cv_is_cut_at_a_word_and_flagged() -> None:
    out = extract_text(("experience " * 3000).encode())
    assert out.truncated and len(out.text) <= NOTES_MAX and out.text.endswith("experience")


def test_text_is_cleaned_without_losing_content() -> None:
    raw = "Name\x00\x07  \r\n\r\n\r\n\r\nRole\u00a0title\t\n   \nEnd   "
    assert clean(raw) == "Name\n\nRole title\n\nEnd"


@pytest.mark.parametrize(
    "raw, shown",
    [
        ("cv.pdf", "cv.pdf"),
        ("../../etc/passwd", "passwd"),
        ("C:\\Users\\me\\My CV.docx", "My CV.docx"),
        ("na\x00me\x1b.pdf", "name.pdf"),
        ("", "CV"),
        ("   ", "CV"),
        ("x" * 400 + ".pdf", ("x" * 400 + ".pdf")[:255]),
    ],
)
def test_the_file_name_shown_back_is_made_safe(raw: str, shown: str) -> None:
    assert safe_filename(raw) == shown


# ------------------------------------------------------------------ the endpoints


async def upload(c: httpx.AsyncClient, data: bytes, name: str = "My CV.pdf", **kw: str):  # type: ignore[no-untyped-def]
    headers = {"x-filename": name, "content-type": "application/octet-stream", **kw}
    return await c.post("/api/notes/cv", content=data, headers=headers)


async def test_uploading_a_cv_saves_its_text_and_name(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        r = await upload(c, PDF_CV, "Jordan Reyes CV.pdf")
        assert r.status_code == 200
        body = r.json()
        assert body["cv_filename"] == "Jordan Reyes CV.pdf" and body["cv_uploaded_at"]
        assert "Led the payments migration" in body["content"] and body["truncated"] is False
        again = (await c.get("/api/notes")).json()
    assert again["content"] == body["content"] and again["cv_filename"] == "Jordan Reyes CV.pdf"


async def test_a_word_file_and_a_text_file_upload_too(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        assert (await upload(c, DOCX_CV, "cv.docx")).json()["content"].startswith("Jordan Reyes")
        assert (await upload(c, b"Plain CV text", "cv.txt")).json()["content"] == "Plain CV text"


async def test_a_new_upload_replaces_the_old_cv_and_keeps_the_role(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        await c.put("/api/notes", json={"role": "Product Manager"})
        await upload(c, b"First CV", "first.txt")
        second = (await upload(c, b"Second CV", "second.txt")).json()
    assert second["content"] == "Second CV" and second["cv_filename"] == "second.txt"
    assert second["role"] == "Product Manager"


async def test_saving_the_role_alone_leaves_the_cv_untouched(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        await upload(c, PDF_CV, "cv.pdf")
        r = (await c.put("/api/notes", json={"role": "Senior PM"})).json()
    assert (
        r["role"] == "Senior PM" and "Northfield" in r["content"] and r["cv_filename"] == "cv.pdf"
    )


async def test_setting_the_text_directly_means_it_no_longer_comes_from_a_file(
    new_client, sign_in
) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        await upload(c, PDF_CV, "cv.pdf")
        r = (await c.put("/api/notes", json={"content": "typed by hand"})).json()
    assert r["content"] == "typed by hand" and r["cv_filename"] is None


async def test_removing_the_cv_clears_the_text_and_keeps_the_role(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        await c.put("/api/notes", json={"role": "PM"})
        await upload(c, PDF_CV, "cv.pdf")
        r = await c.delete("/api/notes/cv")
        after = (await c.get("/api/notes")).json()
    assert r.status_code == 200
    assert after["content"] == "" and after["cv_filename"] is None and after["role"] == "PM"


async def test_removing_when_there_is_nothing_is_fine(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        r = await c.delete("/api/notes/cv")
    assert r.status_code == 200 and r.json()["content"] == ""


async def test_a_cv_belongs_to_one_person(new_client, sign_in) -> None:
    async with new_client() as alice, new_client() as bob:
        await sign_in(alice, "alice@example.com")
        await sign_in(bob, "bob@example.com")
        await upload(alice, PDF_CV, "alice.pdf")
        seen = (await bob.get("/api/notes")).json()
        await bob.delete("/api/notes/cv")
        still = (await alice.get("/api/notes")).json()
    assert seen["content"] == "" and seen["cv_filename"] is None
    assert "Northfield" in still["content"]


async def test_uploads_need_a_signed_in_user_and_the_csrf_header(new_client, sign_in) -> None:
    async with new_client() as anon:
        assert (await upload(anon, PDF_CV)).status_code == 401
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        bad = await upload(c, PDF_CV, **{"x-requested-with": "something-else"})
    assert bad.status_code == 403


@pytest.mark.parametrize(
    "data, status, code",
    [
        (b"", 400, "cv_empty"),
        (pdf([""]), 422, "cv_no_text"),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, 415, "unsupported_cv_type"),
        (b"a" * (5 * 1024 * 1024 + 100), 413, "cv_too_large"),
    ],
)
async def test_a_bad_upload_is_refused_with_a_code_and_changes_nothing(
    new_client, sign_in, data: bytes, status: int, code: str
) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        await upload(c, b"Existing CV", "keep.txt")
        r = await upload(c, data)
        kept = (await c.get("/api/notes")).json()
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert kept["content"] == "Existing CV" and kept["cv_filename"] == "keep.txt"


async def test_a_body_over_the_hard_limit_is_stopped_before_it_is_read(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        r = await upload(c, b"a" * (6 * 1024 * 1024))
    assert r.status_code == 413 and r.json()["error"]["code"] == "body_too_large"


async def test_a_long_cv_is_cut_and_the_response_says_so(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        r = (await upload(c, ("experience " * 3000).encode(), "long.txt")).json()
    assert r["truncated"] is True and len(r["content"]) <= NOTES_MAX


async def test_the_uploaded_text_is_what_answers_are_grounded_in(
    new_client, sign_in, engine
) -> None:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import PracticeSession

    async with new_client() as c:
        await sign_in(c, "a@example.com")
        await upload(c, PDF_CV, "cv.pdf")
        r = await c.post("/api/sessions", json={"consent": True})
    assert r.status_code == 201
    async with async_sessionmaker(engine)() as s:
        snapshot = (await s.execute(select(PracticeSession.notes_snapshot))).scalar_one()
    assert "Led the payments migration at Northfield" in snapshot


async def test_the_file_name_is_shown_safely_and_the_file_content_is_never_logged(
    new_client, sign_in, caplog: pytest.LogCaptureFixture
) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        r = await upload(c, PDF_CV, "%2e%2e%2fsecret%2fMy%20CV.pdf")
    assert r.json()["cv_filename"] == "My CV.pdf"
    logged = " ".join(x.getMessage() + str(getattr(x, "fields", "")) for x in caplog.records)
    assert "Northfield" not in logged and "payments migration" not in logged
