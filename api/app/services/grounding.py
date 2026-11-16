"""After an outline is written, check that its bullets introduce nothing new: no number and no
capitalised name that is absent from the candidate's notes, the company brief or the question."""

import re

_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$")
_LABEL = re.compile(r"\[(?:note|brief)\s*:[^\]]*\]", re.IGNORECASE)
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?%?")
_NAME = re.compile(r"\b[A-Z][a-zA-Z0-9&'’-]*(?:\s+[A-Z][a-zA-Z0-9&'’-]*)*")
NO_STORY = "no matching story in your notes"

# Words that are capitalised for grammar or because they name a method, not a fact.
_STOP = {
    "i", "i'm", "i've", "i'd", "i'll", "the", "a", "an", "and", "but", "so", "then", "this",
    "that", "it", "we", "my", "our", "you", "your", "in", "on", "at", "for", "to", "with",
    "star", "situation", "task", "action", "result", "results", "tip", "example", "key",
    "mention", "explain", "describe", "highlight", "emphasise", "emphasize", "start", "close",
    "opener", "points", "type", "note", "brief", "use", "tie", "link", "focus", "say", "share",
    "talk", "discuss", "bring", "pick", "choose", "frame", "lead", "show", "be", "if", "when",
    "how", "why", "what", "who", "where", "also", "first", "second", "third", "finally",
}  # fmt: skip


def bullets(outline: str) -> list[str]:
    """The text of each bullet in the POINTS section, source labels removed."""
    out: list[str] = []
    for line in outline.splitlines():
        m = _BULLET.match(line)
        if m:
            out.append(_LABEL.sub("", m.group(1)).strip())
    return out


def _claims(bullet: str) -> tuple[set[str], set[str]]:
    numbers = {n.rstrip(",.") for n in _NUMBER.findall(bullet)}
    names: set[str] = set()
    for m in _NAME.finditer(bullet):
        words = [w for w in m.group(0).split() if w.lower().strip("'’") not in _STOP]
        if m.start() == 0 and len(words) == 1:
            continue  # a sentence-initial word is capitalised by grammar, not because it is a name
        if words:
            names.add(" ".join(words))
    return numbers, names


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9%.]+", " ", text.lower())


def check_outline(outline: str, allowed: list[str]) -> list[str]:
    """Return the bullets (shortened) that mention a number or name found in none of `allowed`."""
    corpus = _norm(" ".join(allowed))
    corpus_nums = {n.rstrip(",.") for n in _NUMBER.findall(" ".join(allowed))}
    flagged: list[str] = []
    for bullet in bullets(outline):
        if NO_STORY in bullet.lower():
            continue
        numbers, names = _claims(bullet)
        bad = any(n not in corpus_nums and n.replace(",", "") not in corpus_nums for n in numbers)
        bad = bad or any(
            all(_norm(part).strip() in corpus for part in n.split()) is False for n in names
        )
        if bad:
            flagged.append(bullet[:120])
    return flagged


def cited_sources(outline: str) -> list[str]:
    """The distinct [note: ...] / [brief: ...] labels used, for the suggestion record."""
    seen: list[str] = []
    for m in re.finditer(r"\[((?:note|brief)\s*:[^\]]*)\]", outline, re.IGNORECASE):
        label = " ".join(m.group(1).split())
        if label not in seen:
            seen.append(label)
    return seen


def outline_type(outline: str) -> str:
    m = re.search(r"^\s*TYPE\s*:\s*([A-Za-z\- ]+)", outline, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip().lower()[:20] if m else ""
