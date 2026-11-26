import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Category = Literal["question", "bug", "billing", "account", "feedback", "other"]
Status = Literal["open", "answered", "resolved", "closed"]


class TicketContext(BaseModel):
    """Where the message was sent from. Optional; the app fills it in."""

    platform: str = Field(default="", max_length=20)  # web | desktop | android | ios
    app_version: str = Field(default="", max_length=30)
    page: str = Field(default="", max_length=120)  # the route, never its query


class TicketIn(BaseModel):
    subject: str = Field(min_length=3, max_length=160)
    category: Category = "question"
    body: str = Field(min_length=3, max_length=4000)
    context: TicketContext | None = None


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class StatusIn(BaseModel):
    status: Status


class MessageOut(BaseModel):
    id: uuid.UUID
    kind: Literal["user", "staff", "note"]
    author: str  # "You" / "Support team" for the person; a name or email for staff
    body: str
    created_at: datetime


class TicketOut(BaseModel):
    id: uuid.UUID
    subject: str
    category: str
    status: str
    unread: bool
    created_at: datetime
    updated_at: datetime
    last_message: str  # a short preview


class TicketDetailOut(TicketOut):
    messages: list[MessageOut]


class TicketListOut(BaseModel):
    items: list[TicketOut]


class UnreadOut(BaseModel):
    count: int


# ---- back office


class AdminTicketOut(BaseModel):
    id: uuid.UUID
    subject: str
    category: str
    status: str
    unread: bool
    user_id: uuid.UUID
    user_email: str
    user_name: str | None
    platform: str
    created_at: datetime
    updated_at: datetime
    last_message: str
    messages: int


class AdminTicketListOut(BaseModel):
    items: list[AdminTicketOut]
    counts: dict[str, int]  # open / answered / resolved / closed


class AdminMessageOut(BaseModel):
    id: uuid.UUID
    kind: Literal["user", "staff", "note"]
    author: str
    body: str
    created_at: datetime


class AdminTicketDetailOut(AdminTicketOut):
    context: TicketContext | None
    user_joined: datetime
    assigned_to: str | None
    thread: list[AdminMessageOut]
