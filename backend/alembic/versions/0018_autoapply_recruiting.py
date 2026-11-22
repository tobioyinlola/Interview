"""Auto-Apply: recruiting events and interview links

Revision ID: 0018
Revises: 0017
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "aa_recruiting_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "mailbox_id", UUID, sa.ForeignKey("aa_mailboxes.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider_message_id", sa.String(200), nullable=False),
        sa.Column("thread_id", sa.String(200)),
        sa.Column("kind", sa.String(14), nullable=False),
        sa.Column("application_id", UUID, sa.ForeignKey("aa_applications.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(14), nullable=False),
        sa.Column("evidence", JSONB, nullable=False),
        sa.Column("links", JSONB, nullable=False),
        sa.Column("scheduled_at", TS),
        sa.Column("time_zone_unclear", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("round", sa.Integer),
        sa.Column("received_at", TS, nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.UniqueConstraint("mailbox_id", "provider_message_id"),
    )
    op.create_index("ix_aa_recruiting_events_user_id", "aa_recruiting_events", ["user_id"])
    op.create_table(
        "aa_interviews",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "application_id",
            UUID,
            sa.ForeignKey("aa_applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("company_id", UUID, sa.ForeignKey("companies.id", ondelete="SET NULL")),
        sa.Column("round", sa.Integer, nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("scheduling_url", sa.Text),
        sa.Column("meeting_url", sa.Text),
        sa.Column("scheduled_at", TS),
        sa.Column("time_zone_unclear", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column(
            "last_event_id", UUID, sa.ForeignKey("aa_recruiting_events.id", ondelete="SET NULL")
        ),
        sa.Column("history", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.UniqueConstraint("application_id", "round"),
    )
    op.create_index("ix_aa_interviews_user_id", "aa_interviews", ["user_id"])


def downgrade() -> None:
    op.drop_table("aa_interviews")
    op.drop_table("aa_recruiting_events")
