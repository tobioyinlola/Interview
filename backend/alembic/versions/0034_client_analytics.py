"""Usage statistics from the app: client events and the per-account opt-out

Additive. Existing people stay opted in (the default); nothing is backfilled.

Revision ID: 0034
Revises: 0033
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("analytics_opt_out", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "client_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", sa.String(36), nullable=False),
        sa.Column("session_id", sa.String(36), nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("route", sa.String(80), nullable=True),
        sa.Column(
            "props",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("form_factor", sa.String(8), nullable=False),
        sa.Column("app_version", sa.String(20), nullable=False, server_default=""),
        sa.Column("locale", sa.String(12), nullable=False, server_default=""),
        sa.Column("viewport", sa.String(3), nullable=False, server_default=""),
    )
    op.create_index("ix_client_events_ts", "client_events", ["ts"])
    op.create_index("ix_client_events_user_ts", "client_events", ["user_id", "ts"])
    op.create_index("ix_client_events_device_ts", "client_events", ["device_id", "ts"])
    op.create_index("ix_client_events_name_ts", "client_events", ["name", "ts"])
    op.create_index("ix_client_events_platform_ts", "client_events", ["platform", "ts"])


def downgrade() -> None:
    op.drop_table("client_events")
    op.drop_column("users", "analytics_opt_out")
