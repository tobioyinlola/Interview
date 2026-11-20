"""After an outline is written, check that its bullets introduce nothing new: no number and no
capitalised name that is absent from the candidate's CV, the company brief or the question."""

import re

_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$")
_LABEL = re.compile(r"\[(?:(?:note|brief)\s*:[^\]]*|general|sample)\]", re.IGNORECASE)
# Bullets labelled like this are general advice or an illustrative example, not claims about the
# candidate or the company, so they are not checked against the CV and the brief.
_CITES = re.compile(r"\[(?:note|brief)\s*:", re.IGNORECASE)
_UNCHECKED = re.compile(r"\[(?:general|sample)\]", re.IGNORECASE)
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?%?")
_NAME = re.compile(r"\b[A-Z][a-zA-Z0-9&'’-]*(?:\s+[A-Z][a-zA-Z0-9&'’-]*)*")
NO_STORY_PHRASES = ("no matching story in your cv", "no matching story in your notes")

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


def _raw_bullets(outline: str) -> list[str]:
    """Each bullet of the outline as written, labels included."""
    out: list[str] = []
    for line in outline.splitlines():
        m = _BULLET.match(line)
        if m:
            out.append(m.group(1).strip())
    return out


def bullets(outline: str) -> list[str]:
    """The text of each bullet in the POINTS section, source labels removed."""
    return [_LABEL.sub("", b).strip() for b in _raw_bullets(outline)]


def _is_unchecked(raw: str) -> bool:
    """General advice or an illustrative example, with no claim about the CV or the brief."""
    return bool(_UNCHECKED.search(raw)) and not _CITES.search(raw)


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


_ANSWER = re.compile(
    r"^\s*(?:SAMPLE\s+)?ANSWER\s*:\s*(.*?)(?=^\s*(?:SOURCES|POINTS|CLOSE)\s*:|\Z)",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def answer_text(outline: str) -> str:
    """The spoken answer: what follows ANSWER: up to the SOURCES list. Empty for the old format."""
    m = _ANSWER.search(outline)
    return " ".join(m.group(1).split()) if m else ""


def check_outline(outline: str, allowed: list[str]) -> list[str]:
    """Return the bullets (shortened) that mention a number or name found in none of `allowed`."""
    corpus = _norm(" ".join(allowed))
    corpus_nums = {n.rstrip(",.") for n in _NUMBER.findall(" ".join(allowed))}
    flagged: list[str] = []
    for raw in _raw_bullets(outline):
        bullet = _LABEL.sub("", raw).strip()
        if any(p in bullet.lower() for p in NO_STORY_PHRASES) or _is_unchecked(raw):
            continue
        numbers, names = _claims(bullet)
        bad = any(n not in corpus_nums and n.replace(",", "") not in corpus_nums for n in numbers)
        bad = bad or any(
            all(_norm(part).strip() in corpus for part in n.split()) is False for n in names
        )
        if bad:
            flagged.append(bullet[:120])
    # The answer itself has no labels, so only numbers are checked: every figure it states must be
    # in the CV, the brief or the question. (Names are too common in general advice to check.)
    for sentence in _SENTENCE.split(answer_text(outline)):
        if any(
            n not in corpus_nums and n.replace(",", "") not in corpus_nums
            for n in {n.rstrip(",.") for n in _NUMBER.findall(sentence)}
        ):
            flagged.append(sentence[:120])
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
