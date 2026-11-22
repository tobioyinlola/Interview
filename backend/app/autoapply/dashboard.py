"""What the candidate sees first, and what they should do next."""

from datetime import datetime, timedelta

from app.models import Campaign, InterviewLink

PAST_GRACE = timedelta(hours=2)  # an interview stays "next" until it is well under way


def is_upcoming(link: InterviewLink, now: datetime) -> bool:
    return (
        link.status == "scheduled"
        and link.scheduled_at is not None
        and link.scheduled_at + PAST_GRACE > now
    )


def action_for(link: InterviewLink, now: datetime) -> str | None:
    """What the person can do with this interview right now."""
    if link.status == "invited":
        return "book" if link.scheduling_url else None
    if link.status == "scheduled":
        if link.time_zone_unclear:
            return "confirm_time"
        return "prepare" if is_upcoming(link, now) else None
    return None


def decide(
    *,
    campaign: Campaign | None,
    campaign_state: str,
    paused: bool,
    has_profile: bool,
    needs_reconnect: bool,
    upcoming: InterviewLink | None,
    open_invite: InterviewLink | None,
    first_waiting: str | None,
    last_run_status: str | None,
    last_run_eligible: int,
    run_count: int,
) -> tuple[str, str, str]:
    """(state, action kind, label). Interviews come before everything else, then anything that
    blocks sending, then questions, then the plain state of the search."""
    if upcoming is not None:
        return "prepare", "prepare", "Prepare for interview"
    if open_invite is not None:
        return "book", "book", "Book interview"
    if campaign is None:
        return "setup", "setup", "Set up Auto-Apply" if not has_profile else "Start Auto-Apply"
    if needs_reconnect:
        return "reconnect", "reconnect", "Reconnect email"
    if first_waiting is not None:
        return "answer", "answer", "Resolve the question"
    if campaign_state == "ended":
        return "ended", "results", "View results or start another 30 days"
    if run_count == 0:
        return "awaiting_first_run", "preferences", "View search preferences"
    if last_run_status == "done" and last_run_eligible == 0:
        return "no_matches", "last_run", "View last run and matching criteria"
    return ("paused" if paused else "running"), "preferences", "View search preferences"
