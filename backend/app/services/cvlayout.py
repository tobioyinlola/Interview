"""How an uploaded CV looks, kept as a small style profile (never the file, never its words).

When a CV is uploaded we read its look: the typeface family, the sizes, bold and colour of the name,
the contact line, the section headings and the body, whether headings are underlined, how things
are lined up, and the page margins. A tailored CV is then drawn in that look (see autoapply/cvfile).

Only what a plain, one-column PDF can show is kept; a two-column CV keeps its fonts, sizes and
colours and is laid out in one column. Every number is clamped and every colour checked when the
profile is read back, so a odd file can never make an unusable page."""

import io
import math
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from typing import Any
from xml.etree import ElementTree

from pypdf import PdfReader

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MAX_PAGES = 3  # the look is read from the first pages only
FAMILIES = ("Helvetica", "Times-Roman", "Courier")
HEADING_WORDS = {
    "summary", "profile", "objective", "about", "experience", "employment", "work", "history",
    "education", "skills", "projects", "certifications", "certificates", "awards", "languages",
    "interests", "references", "publications", "volunteer", "volunteering", "achievements",
    "qualifications", "training", "courses", "contact",
}  # fmt: skip
_DATE = re.compile(r"(19|20)\d{2}|present|current", re.I)
BLACK = "#000000"
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass
class Line:
    text: str
    size: float
    bold: bool
    color: str
    x0: float
    x1: float
    y: float  # larger is higher on the page
    family: str = "Helvetica"
    align: str = "left"
    rule: bool = False  # a line is drawn right under it


@dataclass
class Page:
    w: float = 595.0
    h: float = 842.0
    left: float = 50.0
    right: float = 50.0
    top: float = 50.0
    bottom: float = 50.0
    lines: list[Line] = field(default_factory=list)


def is_heading(text: str) -> bool:
    t = text.strip().rstrip(":")
    if not (2 <= len(t) <= 40) or "@" in t or any(c.isdigit() for c in t):
        return False
    words = re.findall(r"[a-z]+", t.lower())
    return 0 < len(words) <= 4 and bool(set(words) & HEADING_WORDS)


def family_of(fontname: str) -> str:
    f = fontname.lower()
    if re.search(r"courier|mono|consolas|menlo", f):
        return "Courier"
    if re.search(
        r"times|serif|georgia|garamond|cambria|palatino|minion|book|roman|charter", f
    ) and ("sans" not in f):
        return "Times-Roman"
    return "Helvetica"


def _hex(r: float, g: float, b: float) -> str:
    def c(v: float) -> int:
        return max(0, min(255, round(v * 255)))

    return f"#{c(r):02x}{c(g):02x}{c(b):02x}"


def _near_black(color: str) -> bool:
    n = int(color[1:], 16)
    return max(n >> 16, (n >> 8) & 255, n & 255) < 70


# ----------------------------------------------------------------------------------------- PDF


def read_pdf(data: bytes) -> list[Page]:
    reader = PdfReader(io.BytesIO(data), strict=False)
    if reader.is_encrypted and not reader.decrypt(""):
        return []
    pages: list[Page] = []
    for pdf_page in reader.pages[:MAX_PAGES]:
        page = _read_pdf_page(pdf_page)
        if page is not None:
            pages.append(page)
    return pages


def _read_pdf_page(pdf_page: Any) -> Page | None:
    box = pdf_page.mediabox
    page = Page(w=float(box.width), h=float(box.height))
    state: dict[str, Any] = {"color": BLACK, "rules": [], "path": None}
    spans: list[tuple[str, float, str, str, float, float, float]] = []

    def operand(op: bytes, args: list[Any], cm: list[float], tm: list[float]) -> None:
        try:
            if op == b"rg" and len(args) == 3:
                state["color"] = _hex(*(float(a) for a in args))
            elif op == b"g" and len(args) == 1:
                state["color"] = _hex(*(float(args[0]),) * 3)
            elif op == b"k" and len(args) == 4:
                c, m, y, k = (float(a) for a in args)
                state["color"] = _hex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
            elif op == b"re" and len(args) == 4:  # a thin filled bar is a rule
                x, y, w, h = (float(a) for a in args)
                if abs(h) <= 2.5 and abs(w) >= page.w * 0.25:
                    state["rules"].append(y * cm[3] + cm[5])
            elif op == b"m" and len(args) == 2:
                state["path"] = (float(args[0]), float(args[1]))
            elif op == b"l" and len(args) == 2 and state["path"]:
                x0, y0 = state["path"]
                x1, y1 = float(args[0]), float(args[1])
                if abs(y1 - y0) < 0.5 and abs(x1 - x0) >= page.w * 0.25:
                    state["rules"].append(y1 * cm[3] + cm[5])
        except (TypeError, ValueError, IndexError):
            return

    def text(t: str, cm: list[float], tm: list[float], font: Any, size: float) -> None:
        if not t.strip():
            return
        try:
            scale = abs(tm[3]) * (abs(cm[3]) if cm else 1.0) or 1.0
            px = tm[4] * cm[0] + cm[4]
            py = tm[5] * cm[3] + cm[5]
            base = str((font or {}).get("/BaseFont", ""))
            spans.append((t, abs(size) * scale, base, state["color"], px, py, len(t)))
        except (TypeError, ValueError, IndexError, KeyError):
            return

    try:
        pdf_page.extract_text(visitor_operand_before=operand, visitor_text=text)
    except Exception:  # noqa: BLE001 - a strange file just gives no look
        return None
    # glue the pieces on one baseline into lines
    rows: dict[int, list[tuple[str, float, str, str, float, float, float]]] = {}
    for s in spans:
        rows.setdefault(round(s[5] / 2), []).append(s)
    for key in sorted(rows, reverse=True):
        parts = sorted(rows[key], key=lambda s: s[4])
        joined = "".join(p[0] for p in parts).strip()
        if not joined:
            continue
        main = max(parts, key=lambda p: p[6])
        base = main[2]
        x0 = parts[0][4]
        x1 = parts[-1][4] + parts[-1][6] * parts[-1][1] * 0.5
        page.lines.append(
            Line(
                joined,
                round(main[1], 1),
                bool(re.search(r"bold|black|heavy|semibold|demi", base, re.I)),
                main[3],
                x0,
                x1,
                parts[0][5],
                family_of(base),
            )
        )
    rules = state["rules"]
    for ln in page.lines:
        ln.rule = any(-2 <= ln.y - r <= ln.size * 1.1 for r in rules)
    if page.lines:
        # only the left and top edges can be told from the text; the other two are kept equal
        page.left = max(20.0, min(ln.x0 for ln in page.lines))
        page.right = page.left
        page.top = max(20.0, page.h - max(ln.y for ln in page.lines))
        page.bottom = page.top
        mid = page.w / 2
        for ln in page.lines:
            width = ln.x1 - ln.x0
            if width < page.w * 0.8 and abs((ln.x0 + ln.x1) / 2 - mid) < page.w * 0.04:
                ln.align = "center"
    return page if page.lines else None


# ---------------------------------------------------------------------------------------- DOCX


def _props(rpr: ElementTree.Element | None, ppr: ElementTree.Element | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if rpr is not None:
        sz = rpr.find(f"{_W}sz")
        if sz is not None and sz.get(f"{_W}val", "").isdigit():
            out["size"] = int(sz.get(f"{_W}val", "0")) / 2
        b = rpr.find(f"{_W}b")
        if b is not None:
            out["bold"] = b.get(f"{_W}val", "1") not in ("0", "false")
        col = rpr.find(f"{_W}color")
        if col is not None and re.fullmatch(r"[0-9A-Fa-f]{6}", col.get(f"{_W}val", "")):
            out["color"] = "#" + col.get(f"{_W}val", "").lower()
        rf = rpr.find(f"{_W}rFonts")
        if rf is not None:
            out["font"] = rf.get(f"{_W}ascii") or rf.get(f"{_W}hAnsi") or ""
    if ppr is not None:
        jc = ppr.find(f"{_W}jc")
        if jc is not None:
            out["align"] = {"center": "center", "right": "right"}.get(
                jc.get(f"{_W}val", ""), "left"
            )
        if ppr.find(f"{_W}pBdr/{_W}bottom") is not None:
            out["rule"] = True
    return out


def _style_table(
    styles: ElementTree.Element | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    table: dict[str, dict[str, Any]] = {}
    if styles is None:
        return table, {}
    default = _props(styles.find(f"{_W}docDefaults/{_W}rPrDefault/{_W}rPr"), None)
    for st in styles.iter(f"{_W}style"):
        sid = st.get(f"{_W}styleId")
        if sid:
            table[sid] = _props(st.find(f"{_W}rPr"), st.find(f"{_W}pPr"))
    return table, default


def read_docx(data: bytes) -> list[Page]:
    def part(z: zipfile.ZipFile, name: str) -> ElementTree.Element | None:
        try:
            info = z.getinfo(name)
        except KeyError:
            return None
        if info.file_size > 8 * 1024 * 1024:
            return None
        with z.open(info) as f:
            xml = f.read(8 * 1024 * 1024 + 1)
        if len(xml) > 8 * 1024 * 1024 or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
            return None
        return ElementTree.fromstring(xml)  # noqa: S314 - refused above if it declares entities

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            doc = part(z, "word/document.xml")
            styles = part(z, "word/styles.xml")
    except (zipfile.BadZipFile, ElementTree.ParseError, OSError, RuntimeError):
        return []
    if doc is None:
        return []
    table, default = _style_table(styles)
    page = Page()
    sect = doc.find(f".//{_W}sectPr")
    if sect is not None:
        pg_size = sect.find(f"{_W}pgSz")
        mar = sect.find(f"{_W}pgMar")
        try:
            if pg_size is not None:
                page.w = int(pg_size.get(f"{_W}w", "11906")) / 20
                page.h = int(pg_size.get(f"{_W}h", "16838")) / 20
            if mar is not None:
                page.left = int(mar.get(f"{_W}left", "1000")) / 20
                page.right = int(mar.get(f"{_W}right", "1000")) / 20
                page.top = int(mar.get(f"{_W}top", "1000")) / 20
                page.bottom = int(mar.get(f"{_W}bottom", "1000")) / 20
        except ValueError:
            pass
    y = page.h
    for para in doc.iter(f"{_W}p"):
        text = "".join(t.text or "" for t in para.iter(f"{_W}t")).strip()
        y -= 14
        if not text:
            continue
        ppr = para.find(f"{_W}pPr")
        sid_el = ppr.find(f"{_W}pStyle") if ppr is not None else None
        sty = table.get(sid_el.get(f"{_W}val", ""), {}) if sid_el is not None else {}
        direct = _props(None, ppr)
        weight: Counter[tuple[float, bool, str, str]] = Counter()
        for run in para.iter(f"{_W}r"):
            rtext = "".join(t.text or "" for t in run.iter(f"{_W}t"))
            if not rtext.strip():
                continue
            rp = _props(run.find(f"{_W}rPr"), None)
            merged = {**default, **sty, **{k: v for k, v in direct.items() if k != "align"}, **rp}
            weight[
                (
                    float(merged.get("size", 11)),
                    bool(merged.get("bold", False)),
                    str(merged.get("color", BLACK)),
                    str(merged.get("font", "")),
                )
            ] += len(rtext)
        if not weight:
            continue
        (size, bold, color, font), _ = weight.most_common(1)[0]
        align = direct.get("align") or sty.get("align") or "left"
        rule = bool(direct.get("rule") or sty.get("rule"))
        mid = page.w / 2
        page.lines.append(
            Line(
                text,
                float(size),
                bool(bold),
                str(color),
                page.left if align == "left" else mid - 60 if align == "center" else mid + 60,
                page.left + 10 if align == "left" else mid + 60,
                y,
                family_of(str(font)),
                align,
                rule,
            )
        )
    return [page] if page.lines else []


# ---------------------------------------------------------------------------------- the profile


def build_profile(pages: list[Page]) -> dict[str, Any] | None:
    lines = [ln for p in pages for ln in p.lines]
    if len(lines) < 5 or not pages:
        return None
    first = pages[0]
    body_pool = [ln for ln in lines if not is_heading(ln.text)]
    # the name: the biggest line near the top of the first page
    name = max(first.lines[:6], key=lambda ln: ln.size, default=None)
    if name is None:
        return None
    rest = [ln for ln in body_pool if ln is not name]
    sizes: Counter[float] = Counter()
    for ln in rest:
        sizes[ln.size] += len(ln.text)
    body_size = sizes.most_common(1)[0][0] if sizes else 10.0
    body_lines = [ln for ln in rest if abs(ln.size - body_size) < 0.6]
    body_color = (
        Counter(ln.color for ln in body_lines).most_common(1)[0][0] if body_lines else BLACK
    )
    heads = [ln for ln in lines if is_heading(ln.text) and ln is not name]
    if heads:
        key = Counter((ln.size, ln.bold, ln.color, ln.text == ln.text.upper()) for ln in heads)
        (h_size, h_bold, h_color, h_upper), _ = key.most_common(1)[0]
        h_align = Counter(ln.align for ln in heads).most_common(1)[0][0]
        h_rule = sum(1 for ln in heads if ln.rule) * 2 >= len(heads)
    else:
        h_size, h_bold, h_color, h_upper, h_align, h_rule = (
            max(body_size + 1.5, 11.0), True, BLACK, True, "left", False,
        )  # fmt: skip
    idx = first.lines.index(name)
    contact = next(
        (
            ln
            for ln in first.lines[idx + 1 : idx + 4]
            if "@" in ln.text or "|" in ln.text or re.search(r"\d{5,}", ln.text)
        ),
        None,
    )
    dated = [ln for ln in body_lines if _DATE.search(ln.text)]
    entry_bold = bool(dated) and sum(1 for ln in dated if ln.bold) * 2 >= len(dated)
    family = Counter(ln.family for ln in lines for _ in range(len(ln.text))).most_common(1)[0][0]
    accent = next((c for c in (h_color, name.color) if c != BLACK and not _near_black(c)), BLACK)
    return {
        "v": 1,
        "page": {
            "w": first.w, "h": first.h, "left": first.left, "right": first.right,
            "top": first.top, "bottom": first.bottom,
        },
        "font": family,
        "name": {"size": name.size, "bold": name.bold, "color": name.color, "align": name.align},
        "contact": {
            "size": contact.size if contact else body_size,
            "color": contact.color if contact else body_color,
            "align": contact.align if contact else name.align,
        },
        "heading": {
            "size": h_size, "bold": h_bold, "color": h_color, "upper": h_upper,
            "align": h_align, "rule": h_rule,
        },
        "body": {"size": body_size, "color": body_color, "entry_bold": entry_bold},
        "accent": accent,
    }  # fmt: skip


def read_layout(data: bytes, kind: str) -> dict[str, Any] | None:
    """The look of an uploaded file, or None (plain text, a scan, anything unreadable)."""
    try:
        if kind == "pdf":
            return build_profile(read_pdf(data))
        if kind == "docx":
            return build_profile(read_docx(data))
    except Exception:  # noqa: BLE001 - the look is a nicety; a failure must never block an upload
        return None
    return None


# --------------------------------------------------------------------------- safe reading back


def _num(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(f) else max(lo, min(hi, f))


def _col(v: Any) -> str:
    return v if isinstance(v, str) and _HEX.match(v) else BLACK


def _align(v: Any) -> str:
    return v if v in ("left", "center", "right") else "left"


def clean_profile(raw: Any) -> dict[str, Any] | None:
    """A stored profile with every value forced into a range the renderer can draw."""
    if not isinstance(raw, dict) or raw.get("v") != 1:
        return None

    def g(k: str) -> dict[str, Any]:
        v = raw.get(k)
        return v if isinstance(v, dict) else {}

    page, name, contact, head, body = g("page"), g("name"), g("contact"), g("heading"), g("body")
    return {
        "page": {
            "w": _num(page.get("w"), 300, 900, 595),
            "h": _num(page.get("h"), 400, 1300, 842),
            "left": _num(page.get("left"), 28, 110, 50),
            "right": _num(page.get("right"), 28, 110, 50),
            "top": _num(page.get("top"), 28, 110, 50),
            "bottom": _num(page.get("bottom"), 28, 110, 50),
        },
        "font": raw.get("font") if raw.get("font") in FAMILIES else "Helvetica",
        "name": {
            "size": _num(name.get("size"), 12, 40, 20),
            "bold": bool(name.get("bold")),
            "color": _col(name.get("color")),
            "align": _align(name.get("align")),
        },
        "contact": {
            "size": _num(contact.get("size"), 7, 14, 10),
            "color": _col(contact.get("color")),
            "align": _align(contact.get("align")),
        },
        "heading": {
            "size": _num(head.get("size"), 8, 20, 12),
            "bold": bool(head.get("bold")),
            "color": _col(head.get("color")),
            "upper": bool(head.get("upper")),
            "align": _align(head.get("align")),
            "rule": bool(head.get("rule")),
        },
        "body": {
            "size": _num(body.get("size"), 7, 14, 10),
            "color": _col(body.get("color")),
            "entry_bold": bool(body.get("entry_bold")),
        },
        "accent": _col(raw.get("accent")),
    }
