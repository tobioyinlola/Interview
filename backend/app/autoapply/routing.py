"""How an application is carried out: the ladder of methods, from the lightest and most direct to
handing it to the candidate, and where each one runs.

    1. authorized API    an employer's own interface that this app has been granted
    2. HTTP form         the form's own web request, with no browser
    3. email             an explicit application address, from the candidate's own mailbox
    4. browser           a deterministic fill of the employer's form (desktop or cloud)
    5. AI-assisted       the form driven by a model, step by step
    6. candidate         the job and CV ready, the candidate presses the button

The first method that is available and switched on is the one used. What is not built says so
plainly, so nothing is claimed that does not exist: there is no authorized employer API access yet,
no direct HTTP form submission, and no model that drives a page (a model only suggests answers
while the package is prepared; it never fills or submits anything). Those rungs are kept as
extension points: adding one means registering it here and nothing else changes.

Where a browser application runs is a separate, per-moment choice: the candidate's own computer
when it is open and they have not asked for the servers (it costs the platform nothing and they
can watch), otherwise the one background worker, one browser job at a time."""

from dataclasses import dataclass, field

from app.autoapply import ats
from app.autoapply.runlog import who_runs_forms

# (method, the channel it uses, whether it exists in this app)
LADDER: tuple[tuple[str, str, bool], ...] = (
    ("authorized_api", "api", False),
    ("http_form", "http", False),
    ("email", "email", True),
    ("browser", "form", True),
    ("ai_assisted", "ai", False),
    ("candidate", "manual", True),
)
CHANNEL_OF = {m: c for m, c, _ in LADDER}


@dataclass
class Step:
    method: str
    available: bool
    why: str


@dataclass
class Route:
    method: str
    channel: str
    ladder: list[Step] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "method": self.method,
            "channel": self.channel,
            "ladder": [{"method": s.method, "available": s.available, "why": s.why} for s in self.ladder],
        }


def choose(
    routes: list[str] | set[str], channels: dict[str, bool], application_url: str = ""
) -> Route:
    """The first method on the ladder that this job offers and the candidate has switched on.
    `routes` is what the posting offers (see matching): "form" and/or "email"."""
    steps: list[Step] = []
    chosen: str | None = None
    for method, channel, built in LADDER:
        if not built:
            steps.append(Step(method, False, "not built yet"))
            continue
        if method == "candidate":
            ok, why = True, "always possible"
        elif channel not in routes:
            ok, why = False, "this job does not offer it"
        elif not channels.get(channel):
            ok, why = False, "you switched it off"
        elif channel == "form" and ats.detect(application_url).needs_account:
            ok, why = False, "this system asks for an account"
        else:
            ok, why = True, "available"
        steps.append(Step(method, ok, why))
        if ok and chosen is None:
            chosen = method
    method = chosen or "candidate"
    return Route(method, CHANNEL_OF[method], steps)


def where_forms_run(state: object, desktop_open: bool) -> str:
    """'desktop' or 'cloud' for a browser application (see runlog.who_runs_forms)."""
    return who_runs_forms(state, desktop_open)  # type: ignore[arg-type]
