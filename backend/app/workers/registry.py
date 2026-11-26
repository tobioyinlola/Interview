"""What each kind of background task is: its handler, the resource it uses, how urgent it is, how
long it may run and how often it may be retried. Handlers are plain async functions; everything
they need comes from the WorkerContext."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.models import BgTask
    from app.workers.context import WorkerContext

# The resource classes the dispatcher limits separately. "light" is database and bookkeeping work.
RESOURCES = ("light", "http", "ai", "email", "document", "browser")
HEAVY = ("ai", "document", "browser")  # held back while the worker is short of memory or CPU

Handler = Callable[["WorkerContext", "BgTask"], Awaitable[Any]]


class Permanent(Exception):  # noqa: N818 - reads as "raise Permanent(...)"
    """A failure retrying will not fix (bad input, a refusal): the task goes straight to dead."""


@dataclass(frozen=True)
class TaskSpec:
    kind: str
    handler: Handler
    resource: str = "light"
    priority: int = 20
    timeout_seconds: int = 300
    max_attempts: int = 3


_SPECS: dict[str, TaskSpec] = {}


def task(
    kind: str,
    *,
    resource: str = "light",
    priority: int = 20,
    timeout_seconds: int = 300,
    max_attempts: int = 3,
) -> Callable[[Handler], Handler]:
    """Register a handler: @task("autoapply.user_pass", resource="http", priority=NORMAL)."""
    if resource not in RESOURCES:
        raise ValueError(f"unknown resource {resource!r}")

    def wrap(fn: Handler) -> Handler:
        _SPECS[kind] = TaskSpec(kind, fn, resource, priority, timeout_seconds, max_attempts)
        return fn

    return wrap


def spec(kind: str) -> TaskSpec | None:
    return _SPECS.get(kind)


def kinds() -> list[str]:
    return sorted(_SPECS)


def priorities(overrides: str) -> dict[str, int]:
    """'kind=number,kind=number' from settings, over the registered defaults."""
    out = {k: s.priority for k, s in _SPECS.items()}
    for part in overrides.split(","):
        name, _, value = part.partition("=")
        if name.strip() and value.strip().lstrip("-").isdigit():
            out[name.strip()] = int(value)
    return out
