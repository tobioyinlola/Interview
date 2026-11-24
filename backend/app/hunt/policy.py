"""What may be sent, to whom, and what every note must carry. Pure functions, no I/O.

The rules encode the common floor for the US (CAN-SPAM) and the EU/UK (GDPR/PECR, business
contacts under legitimate interest): an honest sender, a real postal address, a plain way to say
no, first contact plus one follow-up at most, and nobody who asked us to stop. This is engineering
policy, not legal advice; each candidate stays responsible for what is sent in their name."""

import re
from urllib.parse import urlparse

EU = {
    "austria", "belgium", "bulgaria", "croatia", "cyprus", "czechia", "czech republic",
    "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland",
    "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland",
    "portugal", "romania", "slovakia", "slovenia", "spain", "sweden", "norway",
    "switzerland", "iceland", "liechtenstein",
}  # fmt: skip
UK = {"united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "great britain"}
US = {"united states", "usa", "us", "u.s.", "united states of america"}
GULF = {
    "uae": {"united arab emirates", "uae", "u.a.e.", "dubai", "abu dhabi", "sharjah"},
    "ksa": {"saudi arabia", "ksa", "saudi", "riyadh", "jeddah"},
}
# Only these are ever written to. Other places we list (the Gulf, and the rest of the world) can be
# browsed and their open roles seen, but nobody is emailed there.
REGIONS = ("us", "eu", "uk")

FREE_MAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
    "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de",
    "web.de", "yandex.com", "mail.com", "qq.com", "163.com",
}  # fmt: skip
# Addresses that exist for something other than meeting people about work.
NEVER = {
    "noreply", "no-reply", "donotreply", "do-not-reply", "privacy", "legal", "abuse",
    "security", "billing", "dpo", "postmaster", "webmaster", "mailer-daemon", "unsubscribe",
    "press", "pr", "compliance", "gdpr", "invoices", "accounts", "support", "help",
}  # fmt: skip
ROLE = {
    "jobs",
    "careers",
    "career",
    "hiring",
    "talent",
    "people",
    "recruiting",
    "recruitment",
    "join",
    "work",
}
GENERAL = {"hello", "hi", "contact", "team", "info", "founders", "hey", "office", "welcome"}

EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")
OPT_OUT = re.compile(
    r"\b(unsubscribe|remove me|take me off|stop (emailing|writing|contacting)|"
    r"do not (contact|email|write)|don'?t (contact|email|write)|no thanks?|not interested|"
    r"opt[- ]?out)\b",
    re.IGNORECASE,
)
BOUNCE_FROM = re.compile(r"mailer-daemon|postmaster|mail delivery", re.IGNORECASE)
BOUNCE_SUBJECT = re.compile(
    r"undeliver|delivery (status|failure)|returned mail|failure notice|couldn'?t be delivered",
    re.IGNORECASE,
)


def classify_region(country: str | None) -> str:
    c = (country or "").strip().lower().rstrip(".")
    if c in US:
        return "us"
    if c in UK:
        return "uk"
    if c in EU:
        return "eu"
    for label, names in GULF.items():
        if c in names:
            return label
    return "other"


def domain_of(url_or_email: str) -> str:
    """The host of a website or the domain of an address, lower case, without 'www.'."""
    if "@" in url_or_email and "//" not in url_or_email:
        host = url_or_email.rsplit("@", 1)[1]
    else:
        host = (
            urlparse(url_or_email if "//" in url_or_email else f"//{url_or_email}").hostname or ""
        )
    host = host.lower().strip(".")
    return host[4:] if host.startswith("www.") else host


def contact_kind(email: str) -> str | None:
    """person | role | general, or None when the address is not for hiring conversations."""
    local = email.split("@", 1)[0].lower()
    if local in NEVER or any(local.startswith(n + "+") for n in NEVER):
        return None
    if local in ROLE:
        return "role"
    if local in GENERAL:
        return "general"
    return "person"


def may_write_to(region: str, email: str, startup_domain: str) -> str | None:
    """None when allowed, else the plain reason it is not."""
    if not EMAIL.match(email):
        return "That is not a valid address."
    dom = domain_of(email)
    if dom in FREE_MAIL:
        return "A personal mailbox, not a company address."
    if dom != startup_domain and not dom.endswith("." + startup_domain):
        return "The address is not on the startup's own domain."
    if contact_kind(email) is None:
        return "That address is not for hiring conversations."
    if region not in REGIONS:
        return "Outside the regions you chose."
    return None


def footer(region: str, sender_name: str, postal_address: str, source_url: str) -> str:
    """Honest disclosure and a plain way out, on every note."""
    host = domain_of(source_url)
    lines = [
        "--",
        f"{sender_name}" + (f" · {postal_address}" if postal_address else ""),
        f"I found this address on {host or 'your website'}. If you would rather not hear from "
        "me, reply with 'no thanks' and I will not write again.",
    ]
    if region in ("eu", "uk"):
        lines.append(
            "I am writing about a possible role under legitimate interest and keep only this "
            "address and your reply; tell me and I will delete both."
        )
    return "\n".join(lines)


def is_opt_out(text: str) -> bool:
    return bool(OPT_OUT.search(text))


def is_bounce(from_addr: str, subject: str) -> bool:
    return bool(BOUNCE_FROM.search(from_addr) or BOUNCE_SUBJECT.search(subject))
