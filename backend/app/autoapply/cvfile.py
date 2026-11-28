"""The CV as a file an employer can open: a PDF made from the CV text, so the exact text the
candidate approved is the text that is attached.

Every CV is drawn in one house layout (set from a reference CV): US Letter, Times, the name in
capitals and centred over one contact line, section headings in bold capitals with a rule under
them, each job as a bold title with its dates in italics on the right and the company in italics
under it, round bullets with a hanging indent, and the skills as one line of "•"-separated items.
The text decides what goes in; this decides how it looks."""

import io
import re

from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas

# ---- the page (points)
PAGE_W, PAGE_H = 612.0, 792.0
LEFT = RIGHT_MARGIN = 45.0
TOP, BOTTOM = 51.0, 51.0
DATE_RIGHT = 56.0  # dates end this far inside the right margin, like a tab stop
BULLET_AT, BULLET_TEXT = 20.0, 36.0  # bullet and text indents from the left margin

# ---- type
REG, BOLD, ITAL, BOLD_ITAL = "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"
NAME_SIZE, CONTACT_SIZE, HEAD_SIZE, BODY_SIZE = 16.0, 9.0, 10.5, 10.0
LEAD = 11.8  # body line step

HEADING_WORDS = {
    "summary", "profile", "objective", "about", "experience", "employment", "work", "history",
    "education", "skills", "competencies", "projects", "certifications", "certificates",
    "awards", "languages", "interests", "references", "publications", "volunteer",
    "volunteering", "achievements", "qualifications", "training", "courses", "leadership",
    "community", "tools", "stack", "professional", "core", "key",
}  # fmt: skip
TITLES = {
    "summary": "PROFESSIONAL SUMMARY",
    "profile": "PROFESSIONAL SUMMARY",
    "objective": "PROFESSIONAL SUMMARY",
    "about": "PROFESSIONAL SUMMARY",
    "skills": "CORE COMPETENCIES",
    "experience": "PROFESSIONAL EXPERIENCE",
    "work experience": "PROFESSIONAL EXPERIENCE",
    "employment": "PROFESSIONAL EXPERIENCE",
    "work history": "PROFESSIONAL EXPERIENCE",
}
_BULLET = re.compile(r"^\s*([-*•–▪●·])\s+")
_ENTRY = re.compile(
    r"^(?P<title>.+?),\s*(?P<company>.+?)\s*\((?P<span>[^()]*\d{4}[^()]*|[^()]*present[^()]*)\)\s*$",
    re.I,
)
_LABEL = re.compile(r"^(?P<label>[A-Z][A-Za-z0-9 &/+-]{1,32}):\s+(?P<rest>\S.*)$")
_EMAIL = re.compile(r"[^\s|]+@[^\s|]+\.[^\s|]+")
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9$])")


def is_heading(text: str) -> bool:
    t = text.strip().rstrip(":")
    if not (2 <= len(t) <= 40) or "@" in t or any(c.isdigit() for c in t):
        return False
    words = re.findall(r"[a-z]+", t.lower())
    return 0 < len(words) <= 4 and bool(set(words) & HEADING_WORDS)


def _cp(t: str) -> str:
    """What the standard fonts can draw (Windows Latin-1: bullets, dashes and curly quotes work)."""
    return t.encode("cp1252", "replace").decode("cp1252")


def _width(t: str, face: str, size: float) -> float:
    return float(stringWidth(_cp(t), face, size))


def _wrap(t: str, face: str, size: float, width: float) -> list[str]:
    out: list[str] = []
    cur = ""
    for word in t.split():
        trial = f"{cur} {word}".strip()
        if cur and _width(trial, face, size) > width:
            out.append(cur)
            cur = word
        else:
            cur = trial
    return out + ([cur] if cur else [])


def _heading_title(raw: str) -> str:
    key = " ".join(raw.strip().rstrip(":").lower().split())
    return TITLES.get(key, key.upper())


class _Writer:
    def __init__(self, buf: io.BytesIO) -> None:
        self.c = Canvas(buf, pagesize=(PAGE_W, PAGE_H), pageCompression=0, invariant=1)
        self.y = PAGE_H - TOP
        self.width = PAGE_W - LEFT - RIGHT_MARGIN

    def room(self, need: float) -> None:
        if self.y - need < BOTTOM:
            self.c.showPage()
            self.y = PAGE_H - TOP

    def text(self, t: str, x: float, face: str, size: float) -> None:
        self.c.setFont(face, size)
        self.c.drawString(x, self.y, _cp(t))

    def centred(self, t: str, face: str, size: float) -> None:
        self.c.setFont(face, size)
        self.c.drawCentredString(PAGE_W / 2, self.y, _cp(t))

    def right(self, t: str, x_right: float, face: str, size: float) -> None:
        self.c.setFont(face, size)
        self.c.drawRightString(x_right, self.y, _cp(t))

    def line(self, face: str = REG, size: float = BODY_SIZE) -> None:
        self.y -= size * 1.18

    def paragraph(self, t: str, face: str = REG, indent: float = 0.0) -> None:
        for piece in _wrap(t, face, BODY_SIZE, self.width - indent):
            self.room(LEAD)
            self.line()
            self.text(piece, LEFT + indent, face, BODY_SIZE)

    def bullet(self, t: str) -> None:
        pieces = _wrap(t, REG, BODY_SIZE, self.width - BULLET_TEXT)
        for n, piece in enumerate(pieces):
            self.room(LEAD)
            self.line()
            if n == 0:  # a filled round bullet, as in the reference
                self.c.circle(LEFT + BULLET_AT + 2.2, self.y + 3.3, 2.0, stroke=0, fill=1)
            self.text(piece, LEFT + BULLET_TEXT, REG, BODY_SIZE)

    def heading(self, title: str) -> None:
        self.room(HEAD_SIZE * 3 + LEAD * 2)
        self.y -= 19.0
        self.text(title, LEFT, BOLD, HEAD_SIZE)
        self.c.setLineWidth(1.0)
        self.c.line(LEFT, self.y - 3.2, PAGE_W - RIGHT_MARGIN, self.y - 3.2)
        self.y -= 6.0

    def job(self, title: str, company: str, span: str) -> None:
        self.room(LEAD * 3)
        self.y -= 4.5
        self.line()
        self.text(title, LEFT, BOLD, BODY_SIZE)
        self.right(span.replace(" - ", " – "), PAGE_W - RIGHT_MARGIN - DATE_RIGHT, ITAL, BODY_SIZE)
        self.line()
        self.text(company, LEFT, ITAL, BODY_SIZE)

    def mixed(self, parts: list[tuple[str, str]], x: float) -> None:
        """One line made of runs in different faces, written as one piece of text so a reader (or
        an applicant-tracking system) gets it back as a single line."""
        obj = self.c.beginText(x, self.y)
        for text, face in parts:
            obj.setFont(face, BODY_SIZE)
            obj.textOut(_cp(text))
        self.c.drawText(obj)

    def labelled(self, label: str, rest: str) -> None:
        """'Analytics: Mixpanel · SQL' with the label in bold."""
        head = f"{label}: "
        pieces = _wrap(rest, REG, BODY_SIZE, self.width - _width(head, BOLD, BODY_SIZE))
        if not pieces:
            return
        self.room(LEAD)
        self.line()
        self.mixed([(head, BOLD), (pieces[0], REG)], LEFT)
        if len(pieces) > 1:
            self.paragraph(" ".join(pieces[1:]))

    def bold_lead(self, line: str) -> None:
        """'MBA — Miva University': the part before the dash in bold."""
        m = re.match(r"^(?P<a>.+?)\s+[\u2014\u2013-]\s+(?P<b>.+)$", line)
        if not m:
            self.paragraph(line)
            return
        head, sep = m.group("a"), " \u2014 "
        first_width = self.width - _width(head + sep, BOLD, BODY_SIZE)
        tail = _wrap(m.group("b"), REG, BODY_SIZE, first_width)
        self.room(LEAD)
        self.line()
        self.mixed([(head, BOLD), (sep, REG), (tail[0] if tail else "", REG)], LEFT)
        if len(tail) > 1:
            self.paragraph(" ".join(tail[1:]))

    def skills(self, items: list[str]) -> None:
        self.paragraph("  •  ".join(items))


def _contact_line(parts: list[str]) -> str:
    """Location, phone, email, then links: the order a reader looks for them."""
    flat: list[str] = []
    for p in parts:
        flat += [x.strip() for x in p.split("|") if x.strip()]
    email = [x for x in flat if _EMAIL.search(x)]
    links = [x for x in flat if re.search(r"linkedin|github|https?://|www\.|\.com/", x, re.I)]
    phone = [x for x in flat if re.search(r"\d{6,}|\+\d", x.replace(" ", "")) and x not in email]
    place = [x for x in flat if x not in email + links + phone]
    return " | ".join(place + phone + email + links)


def _skill_items(lines: list[str]) -> list[str]:
    joined = " ".join(_BULLET.sub("", ln) for ln in lines)
    return [x.strip() for x in re.split(r"[,;•·|]", joined) if x.strip()]


def _bullets(text: str) -> list[str]:
    """One bullet per sentence when a role's text is a paragraph; lines are kept as they are."""
    body = _BULLET.sub("", text).strip()
    parts = _SENTENCE.split(body) if len(body) > 160 else [body]
    return [p.strip() for p in parts if p.strip()]


def render_pdf(text: str) -> bytes:
    """The CV text as a PDF in the house layout."""
    buf = io.BytesIO()
    w = _Writer(buf)
    raw = [ln.rstrip() for ln in text.splitlines()]
    first = next((i for i, ln in enumerate(raw) if ln.strip()), None)
    if first is None:
        w.c.showPage()
        w.c.save()
        return buf.getvalue()
    # the name, then the contact lines straight under it up to the first blank line or heading
    w.y -= NAME_SIZE
    w.centred(raw[first].strip().upper(), BOLD, NAME_SIZE)
    i = first + 1
    contact: list[str] = []
    while i < len(raw) and raw[i].strip() and not is_heading(raw[i]):
        contact.append(raw[i].strip())
        i += 1
    if contact:
        for piece in _wrap(_contact_line(contact), REG, CONTACT_SIZE, w.width):
            w.y -= CONTACT_SIZE * 1.55
            w.centred(piece, REG, CONTACT_SIZE)
    section = ""
    pending: list[str] = []  # the skills lines, written together

    def flush_skills() -> None:
        if pending:
            w.skills(_skill_items(pending))
            pending.clear()

    for ln in raw[i:]:
        t = ln.strip()
        if not t:
            continue
        if is_heading(t):
            flush_skills()
            key = " ".join(t.rstrip(":").lower().split())
            section = TITLES.get(key, key.upper()).lower()
            w.heading(_heading_title(t))
            continue
        if "competencies" in section or section == "skills":
            pending.append(t)
            continue
        in_entries = "education" not in section
        m = _ENTRY.match(t) if in_entries and not _BULLET.match(t) else None
        if m:
            w.job(m.group("title").strip(), m.group("company").strip(), m.group("span").strip())
        elif _BULLET.match(t):
            for b in _bullets(t):
                w.bullet(b)
        elif "education" in section:
            w.bold_lead(t)
        elif "experience" in section or "leadership" in section or "achievements" in section:
            for b in _bullets(t):
                w.bullet(b)
        elif (lab := _LABEL.match(t)) is not None:
            w.labelled(lab.group("label"), lab.group("rest"))
        else:
            w.paragraph(t)
    flush_skills()
    w.c.save()
    return buf.getvalue()


def render_letter(text: str) -> bytes:
    """A plain one-column letter (the cover note), not the CV layout."""
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=(PAGE_W, PAGE_H), pageCompression=0, invariant=1)
    width = PAGE_W - 120
    y = PAGE_H - 72
    for raw in text.splitlines() or [""]:
        pieces = _wrap(raw, REG, 11, width) or [""]
        for piece in pieces:
            if y < 72:
                c.showPage()
                y = PAGE_H - 72
            c.setFont(REG, 11)
            c.drawString(60, y, _cp(piece))
            y -= 14.5
    c.save()
    return buf.getvalue()


def pdf_text(data: bytes) -> str:
    """The text inside a PDF made here (used by tests to prove what was attached)."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()


# --------------------------------------------------------------- the CV that is actually sent

MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


async def sent_cv(db: object, user_id: object, cv_text: str) -> tuple[bytes, str, str]:
    """(bytes, file name, media type) of the CV that goes to employers: the file the candidate
    uploaded, exactly as it is, under its own name. Only when no file was kept (a CV uploaded
    before files were kept, or pasted as text) is a PDF made from the CV text instead."""
    from sqlalchemy import select

    from app.models import Note

    row = (
        await db.execute(  # type: ignore[attr-defined]
            select(Note.cv_file, Note.cv_kind, Note.cv_filename).where(Note.user_id == user_id)
        )
    ).first()
    if row is not None and row.cv_file and row.cv_kind in MIME:
        name = (row.cv_filename or "").strip() or f"CV.{row.cv_kind}"
        if not name.lower().endswith("." + row.cv_kind):
            name = f"{name}.{row.cv_kind}"
        return bytes(row.cv_file), name, MIME[row.cv_kind]
    return render_pdf(cv_text), "CV.pdf", MIME["pdf"]
