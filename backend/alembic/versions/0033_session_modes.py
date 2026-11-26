"""Interview modes: mock practice, authorised live assistance, or a standard interview

Additive: existing sessions become "mock", which is what they were.

Revision ID: 0033
Revises: 0032

Follows 0032 (job sources) since the worker and privacy branches were merged.
"""

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions", sa.Column("mode", sa.String(10), nullable=False, server_default="mock")
    )
    op.add_column("sessions", sa.Column("assist_authorized_by", sa.String(200), nullable=True))
    op.add_column(
        "sessions", sa.Column("assist_authorized_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("sessions", "assist_authorized_at")
    op.drop_column("sessions", "assist_authorized_by")
    op.drop_column("sessions", "mode")
