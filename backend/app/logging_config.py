"""Structured JSON logging. Content fields (transcript, notes, audio) are never logged."""

import contextvars
import json
import logging
from datetime import UTC, datetime
from typing import Any

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Any field with one of these names is dropped before a log line is written.
FORBIDDEN_FIELDS = frozenset({"text", "audio", "notes", "content", "extracted_text", "known_text"})


def scrub(data: Any) -> Any:
    """Recursively remove forbidden content fields from a structure."""
    if isinstance(data, dict):
        return {k: scrub(v) for k, v in data.items() if k not in FORBIDDEN_FIELDS}
    if isinstance(data, list | tuple):
        return [scrub(v) for v in data]
    return data


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(scrub(extra))
        if record.exc_info:
            # Type only: tracebacks can embed content in messages.
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
