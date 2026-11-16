"""Error tracking that can never receive content. Sentry is optional and only starts when
SENTRY_DSN is set; every event is scrubbed to ids, types and timings first."""

import logging
from typing import Any

from app.config import Settings

log = logging.getLogger("app.observability")
_SAFE_CONTEXTS = {"runtime", "os", "trace"}


def scrub_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Remove anything that could carry user content: request bodies, headers, cookies, query
    strings, user identity, breadcrumbs, extra data, and exception MESSAGES (a message can embed a
    transcript line). Exception types and stack frames' function names stay."""
    event.pop("request", None)
    event.pop("user", None)
    event.pop("breadcrumbs", None)
    event.pop("extra", None)
    event.pop("logentry", None)
    if isinstance(event.get("contexts"), dict):
        event["contexts"] = {k: v for k, v in event["contexts"].items() if k in _SAFE_CONTEXTS}
    for exc in (event.get("exception") or {}).get("values", []) or []:
        exc["value"] = ""  # keep the type, drop the message
        for frame in (exc.get("stacktrace") or {}).get("frames", []) or []:
            frame.pop("vars", None)  # local variables hold content
            frame.pop("pre_context", None)
            frame.pop("context_line", None)
            frame.pop("post_context", None)
    event["message"] = ""
    return event


def init_sentry(settings: Settings) -> bool:
    """Start Sentry if configured. Returns whether it started."""
    if not settings.sentry_dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed; error tracking is off")
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        traces_sample_rate=0.0,
        before_send=scrub_event,
        before_breadcrumb=lambda crumb, hint: None,
    )
    return True
