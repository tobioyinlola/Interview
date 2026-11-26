"""The CV as a file an employer can open: a PDF made from the CV text, so the exact text the
candidate approved is the text that is attached. When the candidate's own CV file was read when
they uploaded it (services/cvlayout), the PDF is drawn in its look: the same typeface family,
sizes, colours, heading style and margins. Without that, a small plain PDF."""

import io
import re
import textwrap
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas

from app.services.cvlayout import clean_profile, is_heading

PAGE_LINES = 52
WIDTH = 92


def _esc(line: str) -> str:
    safe = line.encode("latin-1", "replace").decode("latin-1")
    return safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_pdf(text: str, layout: dict[str, Any] | None = None) -> bytes:
    look = clean_profile(layout) if layout else None
    if look is not None and text.strip():
        return _render_styled(text, look)
    lines: list[str] = []
    for raw in text.splitlines() or [""]:
        lines += textwrap.wrap(raw, WIDTH) or [""]
    pages = [lines[i : i + PAGE_LINES] for i in range(0, len(lines), PAGE_LINES)] or [[""]]
    objects: list[bytes] = []

    def add(body: str | bytes) -> int:
        objects.append(body.encode("latin-1") if isinstance(body, str) else body)
        return len(objects)

    add("<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(len(pages)))
    add(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>")
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, page in enumerate(pages):
        stream = (
            "BT /F1 10 Tf 50 790 Td 14 TL\n" + "\n".join(f"({_esc(ln)}) '" for ln in page) + "\nET"
        )
        add(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>"
        )
        add(f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)


_BULLET = re.compile(r"^\s*([-*\u2022\u2013\u25aa\u25cf])\s+")
_FACE = {
    "Helvetica": ("Helvetica", "Helvetica-Bold"),
    "Times-Roman": ("Times-Roman", "Times-Bold"),
    "Courier": ("Courier", "Courier-Bold"),
}


def _safe(t: str) -> str:
    return t.encode("cp1252", "replace").decode("cp1252")  # what the standard fonts can draw


def _wrap(t: str, face: str, size: float, width: float) -> list[str]:
    out: list[str] = []
    cur = ""
    for word in t.split():
        trial = f"{cur} {word}".strip()
        if cur and stringWidth(trial, face, size) > width:
            out.append(cur)
            cur = word
        else:
            cur = trial
    return out + ([cur] if cur else [])


def _render_styled(text: str, look: dict[str, Any]) -> bytes:
    pg, nm, ct = look["page"], look["name"], look["contact"]
    hd, bd = look["heading"], look["body"]
    regular, bold = _FACE[look["font"]]
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=(pg["w"], pg["h"]), pageCompression=0, invariant=1)
    left, right = pg["left"], pg["w"] - pg["right"]
    width = right - left
    state = {"y": pg["h"] - pg["top"]}

    def room(need: float) -> None:
        if state["y"] - need < pg["bottom"]:
            c.showPage()
            state["y"] = pg["h"] - pg["top"]

    def put(t: str, face: str, size: float, color: str, align: str, indent: float = 0.0) -> None:
        c.setFont(face, size)
        c.setFillColor(HexColor(color))
        t = _safe(t)
        if align == "center":
            c.drawCentredString((left + right) / 2, state["y"], t)
        elif align == "right":
            c.drawRightString(right, state["y"], t)
        else:
            c.drawString(left + indent, state["y"], t)

    raw = [ln.rstrip() for ln in text.splitlines()]
    first = next((i for i, ln in enumerate(raw) if ln.strip()), None)
    if first is None:
        return render_pdf("")
    # the name, then the contact lines straight under it, up to the first blank line
    room(nm["size"] * 1.5)
    state["y"] -= nm["size"]
    for piece in _wrap(raw[first].strip(), bold if nm["bold"] else regular, nm["size"], width):
        put(piece, bold if nm["bold"] else regular, nm["size"], nm["color"], nm["align"])
        state["y"] -= nm["size"] * 1.2
    i = first + 1
    while i < len(raw) and raw[i].strip() and not is_heading(raw[i]):
        for piece in _wrap(raw[i].strip(), regular, ct["size"], width):
            room(ct["size"] * 1.5)
            put(piece, regular, ct["size"], ct["color"], ct["align"])
            state["y"] -= ct["size"] * 1.35
        i += 1
    entry = False
    for ln in raw[i:]:
        t = ln.strip()
        if not t:
            state["y"] -= bd["size"] * 0.55
            continue
        if is_heading(t):
            label = t.rstrip(":")
            label = label.upper() if hd["upper"] else label.title() if label.isupper() else label
            room(hd["size"] * 3)
            state["y"] -= hd["size"] * 0.7
            face = bold if hd["bold"] else regular
            put(label, face, hd["size"], hd["color"], hd["align"])
            if hd["rule"]:
                c.setStrokeColor(
                    HexColor(look["accent"] if look["accent"] != "#000000" else hd["color"])
                )
                c.setLineWidth(0.7)
                c.line(left, state["y"] - 4, right, state["y"] - 4)
            state["y"] -= hd["size"] * 1.35
            entry = label.lower().startswith(("experience", "employment", "work"))
            continue
        marker = _BULLET.match(t)
        body = _BULLET.sub("", t)
        # a job line ("Title, Company (2021 - 2025)") is set bold when the original did that
        is_entry = bd["entry_bold"] and entry and bool(re.search(r"\(.*\d{4}.*\)\s*$", t))
        face = bold if is_entry else regular
        indent = 12.0 if marker else 0.0
        for n, piece in enumerate(_wrap(body, face, bd["size"], width - indent)):
            room(bd["size"] * 1.6)
            if marker and n == 0:
                put("\u2022", regular, bd["size"], bd["color"], "left")
            put(piece, face, bd["size"], bd["color"], "left", indent)
            state["y"] -= bd["size"] * 1.32
    c.save()
    return buf.getvalue()


def pdf_text(data: bytes) -> str:
    """The text inside a PDF made here (used by tests to prove what was attached)."""
    found = re.findall(rb"\((.*)\) '", data)  # the plain PDF: one line per call, blanks kept
    if found:
        return "\n".join(re.sub(r"\\(.)", r"\1", f.decode("latin-1")) for f in found)
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
