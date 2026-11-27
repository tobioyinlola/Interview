"""The application run: who carries each attempt out, what the candidate asked, and what happened

Additive: new columns on attempts and three new tables.

Revision ID: 0039
Revises: 0038
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aa_attempts",
        sa.Column("executor", sa.String(8), nullable=False, server_default="cloud"),
    )
    op.add_column("aa_attempts", sa.Column("executor_id", sa.String(64), nullable=True))
    op.add_column(
        "aa_attempts", sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("aa_attempts", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.create_table(
        "aa_run_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("stopped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("speed", sa.String(8), nullable=False, server_default="normal"),
        sa.Column("execution_mode", sa.String(8), nullable=False, server_default="auto"),
        sa.Column("command", sa.String(8), nullable=True),
        sa.Column("command_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_attempt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("current", postgresql.JSONB(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "aa_run_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "application_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("aa_applications.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("attempt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(28), nullable=False),
        sa.Column("executor", sa.String(8), nullable=False, server_default=""),
        sa.Column(
            "data", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_aa_run_events_user_seq", "aa_run_events", ["user_id", "id"])
    op.create_index("ix_aa_run_events_application_id", "aa_run_events", ["application_id"])
    op.create_table(
        "aa_executors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("executor_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(80), nullable=False, server_default=""),
        sa.Column("platform", sa.String(20), nullable=False, server_default=""),
        sa.Column("app_version", sa.String(30), nullable=False, server_default=""),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "executor_id"),
    )


def downgrade() -> None:
    op.drop_table("aa_executors")
    op.drop_table("aa_run_events")
    op.drop_table("aa_run_state")
    op.drop_column("aa_attempts", "duration_ms")
    op.drop_column("aa_attempts", "lease_until")
    op.drop_column("aa_attempts", "executor_id")
    op.drop_column("aa_attempts", "executor")
