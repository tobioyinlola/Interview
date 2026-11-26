"""One durable queue for the background worker, and the schedule of recurring jobs

Revision ID: 0031
Revises: 0030
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "bg_tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(60), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("resource", sa.String(10), nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("campaign_id", UUID(as_uuid=True), nullable=True),
        sa.Column("application_id", UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.String(200), nullable=True),
        sa.Column("payload", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("run_at", TS, nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("lease_until", TS, nullable=True),
        sa.Column("locked_by", sa.String(80), nullable=True),
        sa.Column("heartbeat_at", TS, nullable=True),
        sa.Column("error_class", sa.String(40), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("started_at", TS, nullable=True),
        sa.Column("finished_at", TS, nullable=True),
        sa.Column("run_seconds", sa.Float(), nullable=True),
    )
    op.create_index("ix_bg_tasks_user_id", "bg_tasks", ["user_id"])
    op.create_index("ix_bg_tasks_claim", "bg_tasks", ["status", "priority", "run_at"])
    op.create_index("ix_bg_tasks_lease", "bg_tasks", ["status", "lease_until"])
    op.create_index(
        "uq_bg_tasks_live_key",
        "bg_tasks",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.create_table(
        "bg_schedules",
        sa.Column("name", sa.String(60), primary_key=True),
        sa.Column("every_seconds", sa.Integer(), nullable=False),
        sa.Column("next_run_at", TS, nullable=False),
        sa.Column("last_run_at", TS, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("bg_schedules")
    op.drop_table("bg_tasks")
