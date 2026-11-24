"""How well a startup suits a candidate, from facts both sides published. Deterministic, so the
same inputs always give the same score and every point can be explained."""

import re
from typing import Any

from app.models import Startup

MIN_FIT = 25
_WORD = re.compile(r"[a-z][a-z+#.]{2,}")
_FILLER = {
    "senior", "junior", "lead", "principal", "staff", "head", "the", "and", "for", "with",
    "manager", "engineer", "developer", "associate", "remote",
}  # fmt: skip


def _words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def score(
    roles: list[str], facts: dict[str, Any] | None, startup: Startup
) -> tuple[int, list[str]]:
    """(0-100, reasons). Region is checked by the caller; this is about substance."""
    r = startup.research or {}
    corpus = " ".join(
        [
            startup.one_liner,
            startup.sector or "",
            r.get("summary", ""),
            " ".join(r.get("roles", [])),
        ]
    )
    corpus_words = _words(corpus)
    points, why = 0, []

    named = [t for t in r.get("roles", []) if isinstance(t, str)]
    for want in roles:
        want_core = _words(want) - _FILLER
        for title in named:
            if want_core and want_core <= _words(title):
                points += 45
                why.append(f"They list a {title} opening.")
                break
        else:
            continue
        break
    else:
        if r.get("hiring"):
            points += 20
            why.append("Their site says they are hiring.")

    skills = [s for s in (facts or {}).get("skills", []) if isinstance(s, str)]
    hits = [s for s in skills if _words(s) and _words(s) <= corpus_words]
    if hits:
        points += min(30, 10 * len(hits))
        why.append("Overlaps with your skills: " + ", ".join(hits[:3]) + ".")

    history_words: set[str] = set()
    for h in (facts or {}).get("history", []):
        history_words |= _words(f"{h.get('title', '')} {h.get('summary', '')}")
    shared = (history_words & corpus_words) - _FILLER - {"the", "and", "led", "grew", "shipped"}
    if shared:
        points += min(25, 5 * len(shared))
        why.append("Your past work touches: " + ", ".join(sorted(shared)[:3]) + ".")
    return min(points, 100), why


def openings_for(roles: list[str], startup: Startup) -> list[dict[str, str]]:
    """The startup's published openings that match what the candidate wants, with their links."""
    out: list[dict[str, str]] = []
    for o in (startup.research or {}).get("openings", []):
        if not isinstance(o, dict):
            continue
        title = str(o.get("title", ""))
        for want in roles:
            core = _words(want) - _FILLER
            if core and core <= _words(title):
                out.append({"title": title, "url": str(o.get("url", ""))})
                break
    return out[:3]
