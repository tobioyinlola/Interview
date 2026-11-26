"""Which employer-form adapter this server uses, from its settings."""

import importlib.util
import logging

from app.autoapply.adapters import FormAdapter
from app.autoapply.fixtures import FixtureForm
from app.config import Settings

log = logging.getLogger("app.autoapply")


def build(settings: Settings, manager: object = None) -> FormAdapter:
    """The fixture (which touches nobody) unless AUTOAPPLY_FORM_ADAPTER=browser. Submissions to real
    employers also need AUTOAPPLY_FORM_DISPATCH, like every real channel."""
    if settings.autoapply_form_adapter == "browser":
        from app.autoapply.browserform import DEFAULT_HOSTS, BrowserForm

        if importlib.util.find_spec("playwright") is None:
            log.warning(
                "AUTOAPPLY_FORM_ADAPTER=browser but Playwright is not installed (WITH_BROWSER=1)"
            )
        hosts = tuple(
            h.strip().lower() for h in settings.autoapply_form_hosts.split(",") if h.strip()
        )
        return BrowserForm(
            hosts=hosts or DEFAULT_HOSTS,
            executable_path=settings.autoapply_browser_path or None,
            manager=manager,  # the unified worker shares one browser across tasks
        )
    return FixtureForm()
