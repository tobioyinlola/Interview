"""Turn an uploaded CV into plain text.

The file itself is never stored: only the text it holds (that is what outlines are grounded in) and
its name. The type is decided from the file's own bytes, never from its name or declared type, and
every parser is bounded so a hostile file cannot use up memory or time:

- PDF: at most 20 pages; encrypted files that need a password are refused.
- Word (.docx): only the main document part is read, at most 8 MB once unpacked, and XML that
  declares entities or a DOCTYPE is refused (that is how XML bombs work).
- Plain text: UTF-8 only.
There is no OCR: a scan or a photo has no text to read, and the person is told so."""

import io
import re
import zipfile
from dataclasses import dataclass
from xml.etree import ElementTree

from pypdf import PdfReader

from app.schemas.api import NOTES_MAX

MAX_BYTES = 5 * 1024 * 1024
MAX_PDF_PAGES = 20
MAX_DOCX_XML_BYTES = 8 * 1024 * 1024
MAX_CHARS = NOTES_MAX

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class CvError(Exception):
    """A reason the file cannot be used, written for the person who uploaded it."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class CvText:
    text: str
    truncated: bool
    kind: str  # pdf | docx | txt


UNSUPPORTED = "That file type isn't supported. Upload your CV as a PDF or a Word (.docx) file."
NO_TEXT = (
    "We couldn't find any text in that file. If it's a scan or an image, export a text-based "
    "PDF, or upload the Word version."
)
UNREADABLE = "We couldn't read that file. Try exporting it again as a PDF or a Word (.docx) file."


def sniff(data: bytes) -> str:
    if b"%PDF-" in data[:1024]:
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        return "docx"
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        raise CvError(
            415,
            "unsupported_cv_type",
            "That's an old Word (.doc) file. Save it as .docx or PDF and upload it again.",
        )
    if b"\x00" not in data[:4096]:
        return "txt"
    raise CvError(415, "unsupported_cv_type", UNSUPPORTED)


def _pdf(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise CvError(
                422,
                "cv_password_protected",
                "That PDF is password protected. Remove the password and upload it again.",
            )
        if len(reader.pages) > MAX_PDF_PAGES:
            raise CvError(
                422, "cv_too_long", f"That PDF has more than {MAX_PDF_PAGES} pages. Upload your CV."
            )
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except CvError:
        raise
    except Exception as exc:  # noqa: BLE001 - a malformed file can fail in many ways
        raise CvError(422, "cv_unreadable", UNREADABLE) from exc


def _docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            try:
                info = z.getinfo("word/document.xml")
            except KeyError:
                raise CvError(415, "unsupported_cv_type", UNSUPPORTED) from None
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise CvError(422, "cv_unreadable", UNREADABLE)
            with z.open(info) as part:
                xml = part.read(MAX_DOCX_XML_BYTES + 1)  # bounded even if the header lies
        if len(xml) > MAX_DOCX_XML_BYTES or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
            raise CvError(422, "cv_unreadable", UNREADABLE)
        root = ElementTree.fromstring(xml)  # noqa: S314 - DOCTYPE/ENTITY refused above, size bounded
    except CvError:
        raise
    except (zipfile.BadZipFile, ElementTree.ParseError, RuntimeError, OSError) as exc:
        raise CvError(422, "cv_unreadable", UNREADABLE) from exc
    lines: list[str] = []
    for para in root.iter(f"{_W}p"):
        parts: list[str] = []
        for node in para.iter():
            if node.tag == f"{_W}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{_W}tab":
                parts.append("\t")
            elif node.tag in (f"{_W}br", f"{_W}cr"):
                parts.append("\n")
        lines.append("".join(parts))
    return "\n".join(lines)


def _txt(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CvError(415, "unsupported_cv_type", UNSUPPORTED) from None


def clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    text = _CONTROL.sub("", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_text(data: bytes) -> CvText:
    if not data:
        raise CvError(400, "cv_empty", "That file is empty.")
    if len(data) > MAX_BYTES:
        raise CvError(413, "cv_too_large", "That file is over 5 MB. Upload a smaller version.")
    kind = sniff(data)
    raw = {"pdf": _pdf, "docx": _docx, "txt": _txt}[kind](data)
    text = clean(raw)
    if not text:
        raise CvError(422, "cv_no_text", NO_TEXT)
    truncated = len(text) > MAX_CHARS
    if truncated:
        cut = text[:MAX_CHARS]
        text = cut[: cut.rfind(" ")] if " " in cut[-200:] else cut  # end on a word
    return CvText(text=text, truncated=truncated, kind=kind)


def safe_filename(raw: str) -> str:
    """The name shown back to the person: no path, no control characters, at most 255 long."""
    name = _CONTROL.sub("", raw).replace("\\", "/").split("/")[-1].strip()
    return (name[:255] or "CV").strip()
