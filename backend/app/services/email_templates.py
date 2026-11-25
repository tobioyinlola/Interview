"""The emails we send, with their copy. Every message has an HTML body and a plain-text body built
from the same blocks, so the two always say the same thing.

The HTML is built for real inboxes: table layout, inline styles, a 560px column, a button that also
works in Outlook, a hidden preview line, and dark-mode styles for clients that support them. Every
value that came from a person (a name, an address) is escaped. Links must be http(s)."""

import html
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.adapters.email import EmailMessage
from app.services.names import first_name

ACCENT, INK, MUTED, CANVAS, LINE = "#7B47F3", "#1C1B2E", "#5E5C75", "#F7F4FF", "#E6E1F5"
FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
PRACTICE_RULE = "InterviewMeet is for mock interviews with a partner who knows the assistant is on."


@dataclass(frozen=True)
class Brand:
    """Where the web app lives, and who answers questions (optional)."""

    web_origin: str
    support_email: str = ""


# A body is a list of blocks: ("p", text) a paragraph, ("steps", [(title, text), ...]) a numbered
# list, ("button", label, url) the one call to action, ("note", text) small print.
Block = tuple[Any, ...]


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _check_url(url: str) -> str:
    if not url.startswith(("https://", "http://")):
        raise ValueError("email links must be http(s)")
    return url


def _subject_word(first: str | None) -> str | None:
    """A first name made safe for a subject line: no control characters, no line breaks."""
    if not first:
        return None
    cleaned = "".join(ch for ch in first if ch.isprintable()).strip()
    return cleaned or None


def _greeting(name: str | None) -> str:
    first = first_name(name)
    return f"Hi {first}," if first else "Hi there,"


def _button_html(label: str, url: str) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px">'
        f'<tr><td bgcolor="{ACCENT}" style="border-radius:12px">'
        f'<a href="{_e(_check_url(url))}" style="display:inline-block;padding:14px 28px;'
        f"font-family:{FONT};font-size:16px;font-weight:600;line-height:1.2;color:#FFFFFF;"
        f'text-decoration:none;border-radius:12px">{_e(label)}</a></td></tr></table>'
        f'<p class="m" style="margin:14px 0 0;font-size:13px;line-height:1.5;color:{MUTED}">'
        "Button not working? Paste this link into your browser:<br>"
        f'<a href="{_e(url)}" class="lk" style="color:{ACCENT};word-break:break-all">{_e(url)}</a></p>'
    )


def _render_html(
    brand: Brand, *, preheader: str, heading: str, blocks: list[Block], why: str
) -> str:
    body: list[str] = []
    for block in blocks:
        kind = block[0]
        if kind == "p":
            body.append(
                f'<p class="t" style="margin:0 0 16px;font-size:16px;line-height:1.6;color:{INK}">'
                f"{_e(block[1])}</p>"
            )
        elif kind == "steps":
            rows = "".join(
                "<tr>"
                f'<td valign="top" style="padding:0 14px 16px 0"><div style="width:28px;height:28px;'
                f"border-radius:14px;background:{CANVAS};color:{ACCENT};font-family:{FONT};"
                f'font-size:14px;font-weight:700;line-height:28px;text-align:center">{i}</div></td>'
                f'<td valign="top" style="padding:0 0 16px"><div class="t" style="font-size:16px;'
                f'font-weight:600;line-height:1.4;color:{INK}">{_e(title)}</div>'
                f'<div class="m" style="font-size:15px;line-height:1.55;color:{MUTED}">{_e(text)}</div></td>'
                "</tr>"
                for i, (title, text) in enumerate(block[1], start=1)
            )
            body.append(
                f'<table role="presentation" cellpadding="0" cellspacing="0" border="0">{rows}</table>'
            )
        elif kind == "button":
            body.append(_button_html(block[1], block[2]))
        elif kind == "note":
            body.append(
                f'<p class="m rule" style="margin:24px 0 0;padding-top:16px;border-top:1px solid {LINE};'
                f'font-size:14px;line-height:1.55;color:{MUTED}">{_e(block[1])}</p>'
            )
    support = (
        f'Questions? Write to <a href="mailto:{_e(brand.support_email)}" class="lk" style="color:{ACCENT}">'
        f"{_e(brand.support_email)}</a>."
        if brand.support_email
        else ""
    )
    origin = _e(brand.web_origin.rstrip("/"))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>{_e(heading)}</title>
<style>
@media (prefers-color-scheme: dark) {{
  .bg {{ background:#14131F !important }} .card {{ background:#1F1E2E !important }}
  .t {{ color:#F1EFFB !important }} .m {{ color:#B9B6D1 !important }}
  .rule {{ border-top-color:#34324A !important }} .lk {{ color:#B79CFF !important }} .fl {{ color:#B9B6D1 !important }}
}}
@media only screen and (max-width:600px) {{ .card {{ padding:24px 20px !important }} }}
</style></head>
<body class="bg" style="margin:0;padding:0;background:{CANVAS}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">{_e(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="{CANVAS}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 4px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px"><img src="{origin}/email-logo.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:10px"></td>
<td valign="middle" class="t" style="font-family:{FONT};font-size:20px;font-weight:700;color:{INK}">InterviewMeet</td>
</tr></table></td></tr>
<tr><td class="card" style="background:#FFFFFF;border-radius:16px;padding:36px 32px;font-family:{FONT}">
<h1 class="t" style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:700;color:{INK}">{_e(heading)}</h1>
{"".join(body)}
</td></tr>
<tr><td class="m" style="padding:20px 8px 0;font-family:{FONT};font-size:12px;line-height:1.6;color:{MUTED};text-align:center">
{_e(why)}<br>{_e(PRACTICE_RULE)}<br>
<a href="{origin}/terms" class="fl" style="color:{MUTED}">Terms</a> &nbsp;·&nbsp; <a href="{origin}/privacy" class="fl" style="color:{MUTED}">Privacy</a>{("<br>" + support) if support else ""}
</td></tr>
</table></td></tr></table></body></html>"""


def _render_text(brand: Brand, *, heading: str, blocks: list[Block], why: str) -> str:
    out = [heading.upper(), ""]
    for block in blocks:
        kind = block[0]
        if kind == "p":
            out += [block[1], ""]
        elif kind == "steps":
            out += [f"{i}. {t}: {x}" for i, (t, x) in enumerate(block[1], start=1)] + [""]
        elif kind == "button":
            out += [f"{block[1]}:", _check_url(block[2]), ""]
        elif kind == "note":
            out += ["--", block[1], ""]
    origin = brand.web_origin.rstrip("/")
    out += ["--", why, PRACTICE_RULE, f"Terms: {origin}/terms   Privacy: {origin}/privacy"]
    if brand.support_email:
        out.append(f"Questions? Write to {brand.support_email}")
    return "\n".join(out) + "\n"


def _message(
    kind: str,
    brand: Brand,
    to: str,
    *,
    subject: str,
    preheader: str,
    heading: str,
    blocks: list[Block],
    why: str,
    link: str | None = None,
) -> EmailMessage:
    return EmailMessage(
        kind=kind,
        to=to,
        subject=subject,
        html=_render_html(brand, preheader=preheader, heading=heading, blocks=blocks, why=why),
        text=_render_text(brand, heading=heading, blocks=blocks, why=why),
        link=link,
        reply_to=brand.support_email or None,
    )


# ---------------------------------------------------------------------------------- the messages


def signup_confirmation(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    first = first_name(name)
    return _message(
        "signup",
        brand,
        to,
        subject="Confirm your email for InterviewMeet",
        preheader="One click and your account is ready.",
        heading=f"Welcome, {first}. Confirm your email" if first else "Confirm your email",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "You're one click away from mock interviews with answers grounded in your "
                "own CV. Confirm your email address to create your account.",
            ),
            ("button", "Confirm email and sign in", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't sign up "
                "for InterviewMeet, ignore this email: no account will be created.",
            ),
        ],
        why="You got this email because someone used this address to sign up for InterviewMeet.",
        link=link,
    )


def sign_in_link(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    return _message(
        "login",
        brand,
        to,
        subject="Your InterviewMeet sign-in link",
        preheader="Use this link to sign in. It works once.",
        heading="Sign in to InterviewMeet",
        blocks=[
            ("p", _greeting(name)),
            ("p", "Use the button below to sign in. There's no password to type."),
            ("button", "Sign in", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't ask for "
                "it, you can ignore this email: nobody can sign in to your account without it.",
            ),
        ],
        why="You got this email because someone asked for a sign-in link for this address.",
        link=link,
    )


def staff_sign_in_link(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    return _message(
        "staff_login",
        brand,
        to,
        subject="Your InterviewMeet back-office sign-in link",
        preheader="Use this link to open the back office. It works once.",
        heading="Sign in to the back office",
        blocks=[
            ("p", _greeting(name)),
            ("p", "Use the button below to open the InterviewMeet back office."),
            ("button", "Open the back office", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't ask for "
                "it, ignore this email and tell the owner: someone typed your address.",
            ),
        ],
        why="You got this email because someone asked to sign in to the back office as you.",
        link=link,
    )


def password_reset(
    brand: Brand, to: str, name: str | None, link: str, ttl_minutes: int
) -> EmailMessage:
    return _message(
        "reset",
        brand,
        to,
        subject="Reset your InterviewMeet password",
        preheader="Choose a new password for your account.",
        heading="Choose a new password",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "We got a request to reset the password for your InterviewMeet account. Use the "
                "button below to choose a new one. You'll be signed in, and signed out everywhere else.",
            ),
            ("button", "Choose a new password", link),
            (
                "note",
                f"This link works once and expires in {ttl_minutes} minutes. If you didn't ask for "
                "a reset, ignore this email: your password stays exactly as it is.",
            ),
        ],
        why="You got this email because someone asked to reset the password for this address.",
        link=link,
    )


def welcome(brand: Brand, to: str, name: str | None) -> EmailMessage:
    first = first_name(name)
    subject_first = _subject_word(first)
    return _message(
        "welcome",
        brand,
        to,
        subject=f"Welcome to InterviewMeet, {subject_first}"
        if subject_first
        else "Welcome to InterviewMeet",
        preheader="Three steps to your first mock interview.",
        heading=f"You're in, {first}" if first else "You're in",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "Your account is ready. Here's the quickest way to your first mock interview:",
            ),
            (
                "steps",
                [
                    (
                        "Upload your CV",
                        "Your own stories in an answer come only from it, so every point can be traced back.",
                    ),
                    (
                        "Add the company you're interviewing with",
                        "We build a brief where every fact cites its source.",
                    ),
                    (
                        "Run a mock interview on Google Meet with a friend",
                        "Share the Meet tab and get an answer for each question they ask. Your first interview is free.",
                    ),
                ],
            ),
            ("button", "Go to your dashboard", f"{brand.web_origin.rstrip('/')}/dashboard"),
            (
                "note",
                "Always tell your interview partner that the assistant is listening. You agreed to "
                "that when you signed up.",
            ),
        ],
        why="You got this email because you created an InterviewMeet account.",
    )


def password_changed(brand: Brand, to: str, name: str | None, when: datetime) -> EmailMessage:
    stamp = when.strftime("%B %-d, %Y at %H:%M UTC")
    return _message(
        "password_changed",
        brand,
        to,
        subject="Your InterviewMeet password was changed",
        preheader="If this wasn't you, reset it right away.",
        heading="Your password was changed",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                f"The password for your InterviewMeet account was changed on {stamp}. We also "
                "signed you out of your other devices.",
            ),
            ("p", "If that was you, there's nothing more to do."),
            ("p", "If it wasn't you, reset your password now to lock the account down:"),
            ("button", "Reset my password", f"{brand.web_origin.rstrip('/')}/forgot-password"),
        ],
        why="You got this email because the password on your account changed.",
    )


def account_deleted(brand: Brand, to: str, name: str | None) -> EmailMessage:
    return _message(
        "account_deleted",
        brand,
        to,
        subject="Your InterviewMeet account has been deleted",
        preheader="Your CV, companies and sessions are gone.",
        heading="Your account has been deleted",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "As you asked, we've deleted your InterviewMeet account along with your CV text, "
                "companies and interview sessions. Backups age out within 30 days.",
            ),
            (
                "p",
                "We kept nothing except this message. You're welcome back any time: you can "
                "create a new account whenever you like.",
            ),
            ("button", "Create a new account", f"{brand.web_origin.rstrip('/')}/signup"),
            (
                "note",
                "If you didn't delete your account, write to us straight away"
                + (f" at {brand.support_email}." if brand.support_email else "."),
            ),
        ],
        why="You got this email because your InterviewMeet account was deleted.",
    )


def _origin(brand: Brand) -> str:
    return brand.web_origin.rstrip("/")


def brief_ready(
    brand: Brand, to: str, name: str | None, company: str, company_id: str
) -> EmailMessage:
    word = _subject_word(company) or "your company"
    return _message(
        "brief_ready",
        brand,
        to,
        subject=f"Your brief on {word} is ready",
        preheader="What they do, who they sell to, and the questions to expect.",
        heading=f"{word} is researched",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                f"We've finished researching {word}: what the company does and how, who it sells "
                "to, recent news, and the questions it is likely to ask. Every fact shows its "
                "source.",
            ),
            (
                "steps",
                [
                    (
                        "Read the brief",
                        "Check the facts, and pin the ones you want answers to use.",
                    ),
                    ("Run a mock interview", f"Pick {word} when you start, so answers fit them."),
                ],
            ),
            ("button", "Open the brief", f"{_origin(brand)}/companies/{company_id}"),
        ],
        why=f"You got this email because you asked InterviewMeet to research {word}.",
    )


def review_ready(
    brand: Brand,
    to: str,
    name: str | None,
    session_id: str,
    answers: int,
    average: int | None,
) -> EmailMessage:
    blocks: list[Block] = [
        ("p", _greeting(name)),
        (
            "p",
            f"Your interview review is ready. We scored {answers} of your answers on structure, "
            "specificity, impact, relevance and pace, with a specific fix for each.",
        ),
    ]
    if average is not None:
        blocks.append(("p", f"Your average score was {average} out of 100."))
    blocks.append(("button", "See your review", f"{_origin(brand)}/sessions/{session_id}"))
    return _message(
        "review_ready",
        brand,
        to,
        subject="Your interview review is ready",
        preheader="Your answers are scored, with a fix for each.",
        heading="Your review is ready",
        blocks=blocks,
        why="You got this email because you asked InterviewMeet to score an interview.",
    )


def friend_joined(
    brand: Brand,
    to: str,
    name: str | None,
    friend_first: str | None,
    progress: int,
    per_reward: int,
) -> EmailMessage:
    who = _subject_word(friend_first) or "A friend"
    return _message(
        "friend_joined",
        brand,
        to,
        subject=f"{who} joined with your link",
        preheader=f"{progress} of {per_reward} toward a free interview.",
        heading=f"{who} joined",
        blocks=[
            ("p", _greeting(name)),
            ("p", f"{who} just signed up to InterviewMeet with your invite link."),
            ("p", f"That's {progress} of {per_reward} toward your next free interview."),
            ("button", "See your invites", f"{_origin(brand)}/referrals"),
        ],
        why="You got this email because someone signed up with your invite link.",
    )


def reward_earned(brand: Brand, to: str, name: str | None, per_reward: int) -> EmailMessage:
    return _message(
        "reward_earned",
        brand,
        to,
        subject="You earned a free interview",
        preheader="Redeem it whenever you're ready.",
        heading="You earned a free interview",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                f"{per_reward} friends have joined with your link, so you've earned a free "
                "interview session.",
            ),
            ("p", "Redeem it to add it to your account. You can use it whenever you like."),
            ("button", "Redeem your free interview", f"{_origin(brand)}/referrals"),
        ],
        why="You got this email because you earned a reward by inviting friends.",
    )


def trial_used(brand: Brand, to: str, name: str | None, per_reward: int) -> EmailMessage:
    return _message(
        "trial_used",
        brand,
        to,
        subject="Your free interview is done. What next?",
        preheader="Invite friends to earn another.",
        heading="Your free interview is done",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "Your first interview was on us. More interviews will be paid for one at a time; "
                "payments are coming soon.",
            ),
            (
                "p",
                f"Until then, invite {per_reward} friends who sign up with your link and you earn "
                "another free interview.",
            ),
            ("button", "Invite friends", f"{_origin(brand)}/referrals"),
            ("note", "Your review and transcript stay on your Sessions page."),
        ],
        why="You got this email because you used your free InterviewMeet interview.",
    )


def credit_granted(
    brand: Brand, to: str, name: str | None, count: int, reason: str | None
) -> EmailMessage:
    many = count != 1
    blocks: list[Block] = [
        ("p", _greeting(name)),
        (
            "p",
            f"We've added {count} free {'interviews' if many else 'interview'} to your account.",
        ),
    ]
    if reason:
        blocks.append(("p", reason))
    blocks.append(("button", "Start an interview", f"{_origin(brand)}/session/new"))
    return _message(
        "credit_granted",
        brand,
        to,
        subject="We added a free interview to your account",
        preheader="It's ready to use.",
        heading="A free interview, on us",
        blocks=blocks,
        why="You got this email because the InterviewMeet team added a free interview to your account.",
    )


def outreach_approved(brand: Brand, to: str, name: str | None) -> EmailMessage:
    return _message(
        "outreach_approved",
        brand,
        to,
        subject="You now have access to startup outreach",
        preheader="Connect your Gmail and start reaching startups.",
        heading="Startup outreach is open to you",
        blocks=[
            ("p", _greeting(name)),
            (
                "p",
                "Your request was approved. You can now reach startups that are hiring for your "
                "role, with a short note written from your CV.",
            ),
            (
                "p",
                "Connect your Gmail with an app password, then look at each note before it goes.",
            ),
            ("button", "Open startup outreach", f"{_origin(brand)}/startups"),
        ],
        why="You got this email because the InterviewMeet team approved your request for startup outreach.",
    )


# ---------------------------------------------------------------------------- the catalogue

# Every message the platform sends, for the admin console: what it is, when it goes out, who gets it,
# and a builder that fills it with obviously-sample data so it can be previewed.
SAMPLE_LINK = "https://example.com/login/verify?token=SAMPLE-TOKEN"

CATALOG: list[tuple[str, str, str, str]] = [
    (
        "signup",
        "Confirm your email",
        "Someone creates an account with a password.",
        "The new person",
    ),
    (
        "login",
        "Sign-in link",
        "Someone asks for an emailed sign-in link.",
        "Anyone with an account",
    ),
    (
        "staff_login",
        "Back-office sign-in link",
        "A staff member asks to sign in to the back office.",
        "Staff only",
    ),
    ("reset", "Reset password", "Someone asks to reset their password.", "Account owner"),
    ("welcome", "Welcome", "An account is created (link, password or Google).", "The new person"),
    ("password_changed", "Password changed", "A password is reset or changed.", "Account owner"),
    ("account_deleted", "Account deleted", "Someone deletes their account.", "The person who left"),
    ("brief_ready", "Company brief ready", "Company research finishes.", "Who added the company"),
    ("review_ready", "Interview review ready", "Answer scoring finishes.", "Who ran the interview"),
    ("friend_joined", "A friend joined", "A friend signs up with an invite link.", "The inviter"),
    (
        "reward_earned",
        "Free interview earned",
        "A set of invited friends is complete.",
        "The inviter",
    ),
    (
        "trial_used",
        "Free interview used",
        "The last available interview ends (once).",
        "The person",
    ),
    ("credit_granted", "Free interview added", "An admin adds free interviews.", "The person"),
    (
        "outreach_approved",
        "Startup outreach approved",
        "An admin switches startup outreach on for someone.",
        "The person",
    ),
]


def sample_message(kind: str, brand: Brand, to: str = "jordan@example.com") -> EmailMessage:
    """The message for `kind` filled with sample data, for previews."""
    name = "Jordan Reyes"
    builders = {
        "signup": lambda: signup_confirmation(brand, to, name, SAMPLE_LINK, 15),
        "login": lambda: sign_in_link(brand, to, name, SAMPLE_LINK, 15),
        "staff_login": lambda: staff_sign_in_link(brand, to, name, SAMPLE_LINK, 15),
        "reset": lambda: password_reset(brand, to, name, SAMPLE_LINK, 15),
        "welcome": lambda: welcome(brand, to, name),
        "password_changed": lambda: password_changed(
            brand, to, name, datetime(2026, 11, 17, 9, 5, tzinfo=UTC)
        ),
        "account_deleted": lambda: account_deleted(brand, to, name),
        "brief_ready": lambda: brief_ready(brand, to, name, "Northwind Payments", "sample"),
        "review_ready": lambda: review_ready(brand, to, name, "sample", 4, 71),
        "friend_joined": lambda: friend_joined(brand, to, name, "Sam", 2, 3),
        "reward_earned": lambda: reward_earned(brand, to, name, 3),
        "trial_used": lambda: trial_used(brand, to, name, 3),
        "credit_granted": lambda: credit_granted(brand, to, name, 2, "Thanks for your feedback."),
        "outreach_approved": lambda: outreach_approved(brand, to, name),
    }
    if kind not in builders:
        raise KeyError(kind)
    return builders[kind]()
