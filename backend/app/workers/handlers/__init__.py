"""Importing this registers every background task the worker knows how to run."""

from app.workers.handlers import autoapply, hunt, maintenance  # noqa: F401
