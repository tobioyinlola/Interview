"""Startup outreach: directory startups, published contacts, settings, targets, suppressions

Revision ID: 0023
Revises: 0022
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def _id() -> sa.Column:
    return sa.Column("id", pg.UUID(as_uuid=True), primary_key=True)


def _fk(name: str, target: str, **kw: object) -> sa.Column:
    return sa.Column(
        name,
        pg.UUID(as_uuid=True),
        sa.ForeignKey(target, ondelete="CASCADE"),
        **kw,  # type: ignore[arg-type]
    )


def upgrade() -> None:
    op.create_table(
        "aa_startups",
        _id(),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("domain", sa.String(253), nullable=False, unique=True),
        sa.Column("website", sa.String(500), nullable=False),
        sa.Column("directory", sa.String(120), nullable=False),
        sa.Column("directory_url", sa.String(500), nullable=False),
        sa.Column("batch", sa.String(60)),
        sa.Column("one_liner", sa.String(500), nullable=False, server_default=""),
        sa.Column("sector", sa.String(120)),
        sa.Column("region", sa.String(8), nullable=False, server_default="other"),
        sa.Column("country", sa.String(80)),
        sa.Column("status", sa.String(12), nullable=False, server_default="new"),
        sa.Column("research", pg.JSONB),
        sa.Column("researched_at", TS),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_table(
        "aa_startup_contacts",
        _id(),
        _fk("startup_id", "aa_startups.id", nullable=False, index=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200)),
        sa.Column("title", sa.String(200)),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=False),
        sa.Column("found_at", TS, nullable=False),
        sa.UniqueConstraint("startup_id", "email"),
    )
    op.create_table(
        "aa_hunt_settings",
        _id(),
        _fk("user_id", "users.id", nullable=False, unique=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("regions", pg.JSONB, nullable=False),
        sa.Column("roles", pg.JSONB, nullable=False),
        sa.Column("pitch", sa.Text, nullable=False, server_default=""),
        sa.Column("daily_cap", sa.Integer, nullable=False, server_default="8"),
        sa.Column("auto_send", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("sender_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("postal_address", sa.String(300), nullable=False, server_default=""),
        sa.Column("updated_at", TS, nullable=False),
    )
    op.create_table(
        "aa_hunt_targets",
        _id(),
        _fk("user_id", "users.id", nullable=False, index=True),
        _fk("startup_id", "aa_startups.id", nullable=False),
        _fk("contact_id", "aa_startup_contacts.id", nullable=False),
        sa.Column("step", sa.Integer, nullable=False, server_default="1"),
        sa.Column("fit", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fit_reasons", pg.JSONB, nullable=False),
        sa.Column("subject", sa.String(300), nullable=False, server_default=""),
        sa.Column("body", sa.Text, nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False, server_default="drafted"),
        sa.Column("reason", sa.String(300)),
        sa.Column("message_id", sa.String(300)),
        sa.Column("thread_id", sa.String(200)),
        sa.Column("claimed_at", TS),
        sa.Column("sent_at", TS),
        sa.Column("created_at", TS, nullable=False),
        sa.UniqueConstraint("user_id", "contact_id", "step"),
    )
    op.create_table(
        "aa_suppressions",
        _id(),
        _fk("user_id", "users.id", index=True),
        sa.Column("email", sa.String(320), index=True),
        sa.Column("domain", sa.String(253), index=True),
        sa.Column("reason", sa.String(12), nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )


def downgrade() -> None:
    for t in (
        "aa_suppressions",
        "aa_hunt_targets",
        "aa_hunt_settings",
        "aa_startup_contacts",
        "aa_startups",
    ):
        op.drop_table(t)
