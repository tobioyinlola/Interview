"""The CV as a file an employer can open. A small, plain PDF made from the CV text, so the exact
text the candidate approved is the text that is attached."""

import re
import textwrap

PAGE_LINES = 52
WIDTH = 92


def _esc(line: str) -> str:
    safe = line.encode("latin-1", "replace").decode("latin-1")
    return safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_pdf(text: str) -> bytes:
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


def pdf_text(data: bytes) -> str:
    """The text inside a PDF made by render_pdf (used by tests to prove what was attached)."""
    found = re.findall(rb"\((.*)\) '", data)
    return "\n".join(re.sub(r"\\(.)", r"\1", f.decode("latin-1")) for f in found)
