"""Keeping a candidate's own mailbox in good standing, and reading how outreach is going.

Every note goes from the person's own address, so a bad run (many bounces, many people asking to
stop) hurts their ordinary email too. Four things protect it, all deterministic and explainable:

* a daily limit that starts low and rises over three weeks (the ramp), and holds back when
  bounces creep up;
* sending that stops by itself when bounces or "please stop" replies pass a line, and starts
  again only when the person says so (what happened before that no longer counts);
* a check that an address's domain can receive mail, before a note is written to it;
* a read of each reply (interested, not hiring, asked to stop) from its words.

Spam complaints are not visible to us, so "asked to stop" stands in for them.
"""

import re
from datetime import datetime, timedelta
from typing import Any

import dns.asyncresolver
import dns.resolver

from app.models import HuntSettings

REACH = {"best": 50, "most": 25, "everyone": 0}  # the lowest fit that is written to
WINDOW = timedelta(days=30)
MIN_SAMPLE = 10  # fewer than this many sent: too few to judge
BOUNCE_PAUSE = 0.03  # more than 3 in 100 bounced: stop
BOUNCE_HOLD = 0.015  # more than 1.5 in 100: do not raise the limit
OPTOUT_PAUSE = 0.10  # more than 1 in 10 asked us to stop: stop
RAMP = ((0, 10), (7, 15), (14, 20), (21, 25))  # (days since the first note, notes a day)


def reach_floor(reach: str) -> int:
    return REACH.get(reach, REACH["most"])


def ramp_cap(first_sent: datetime | None, now: datetime) -> int:
    """The most notes a day this person's sending history has earned."""
    if first_sent is None:
        return RAMP[0][1]
    days = max((now - first_sent).days, 0)
    return [cap for start, cap in RAMP if days >= start][-1]


def rates(sent: int, bounced: int, optouts: int) -> dict[str, float]:
    return {
        "bounce": bounced / sent if sent else 0.0,
        "optout": optouts / sent if sent else 0.0,
    }


def daily_cap(
    st: HuntSettings, first_sent: datetime | None, now: datetime, sent: int, bounced: int, hard: int
) -> int:
    """The person's own limit, held down by the ramp, and by a bounce rate that is creeping up."""
    cap = min(st.daily_cap, hard, ramp_cap(first_sent, now))
    if sent >= MIN_SAMPLE and rates(sent, bounced, 0)["bounce"] > BOUNCE_HOLD:
        cap = min(cap, RAMP[0][1])
    return max(cap, 1)


def pause_reason(sent: int, bounced: int, optouts: int) -> str | None:
    """Why sending should stop now, in words the person can read, or None."""
    if sent < MIN_SAMPLE:
        return None
    r = rates(sent, bounced, optouts)
    if r["bounce"] > BOUNCE_PAUSE:
        return (
            f"{bounced} of your last {sent} emails bounced ({r['bounce']:.0%}). Sending stopped "
            "to protect your mailbox. Check your list, then turn it back on."
        )
    if r["optout"] > OPTOUT_PAUSE:
        return (
            f"{optouts} of your last {sent} emails got a reply asking you to stop. Sending "
            "stopped so you can look at who it is going to. Then turn it back on."
        )
    return None


# ------------------------------------------------------------------------------ replies

_POSITIVE = re.compile(
    r"\b(interested|would love|love to (chat|talk|connect|meet)|"
    r"let'?s (chat|talk|connect|schedule|set up)|"
    r"happy to (chat|talk|connect|meet)|schedule|calendar|are you free|available (for|on)|"
    r"send (over )?(your )?(cv|resume)|next steps?|open to (a )?(call|chat|talking)|"
    r"book (a )?(time|call)|set up a call|come in|intro(duce| call))\b",
    re.IGNORECASE,
)
_NEGATIVE = re.compile(
    r"\b(not hiring|no (open )?(roles|openings|positions|vacancies)|nothing (open|available)|"
    r"not (looking|recruiting|taking)|at this time|unfortunately|we('re| are) not|"
    r"hiring freeze|filled|not a fit|no longer (hiring|recruiting))\b",
    re.IGNORECASE,
)


def reply_kind(text: str) -> str:
    """positive, negative or neutral, from the words of a reply. A reply asking us to stop is
    'optout' and is decided elsewhere (policy.is_opt_out)."""
    if _NEGATIVE.search(text) and not _POSITIVE.search(text):
        return "negative"
    if _POSITIVE.search(text):
        return "positive"
    return "neutral"


# ------------------------------------------------------------------------------ mail checks


async def mail_domain_works(domain: str) -> bool | None:
    """Does this domain publish a mail server (or at least an address)? False: it cannot receive
    mail. None: could not tell (a slow or failing lookup), which is never held against a startup."""
    try:
        res = dns.asyncresolver.Resolver()
        res.lifetime = 3.0
        try:
            await res.resolve(domain, "MX")
            return True
        except dns.resolver.NoAnswer:
            pass  # no mail server named: mail falls back to the address record
        await res.resolve(domain, "A")
        return True
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return False
    except Exception:  # noqa: BLE001 - a lookup that failed says nothing about the domain
        return None


def explain(h: dict[str, Any]) -> str:
    return f"{h['sent']} sent, {h['bounced']} bounced, {h['optouts']} asked to stop"
