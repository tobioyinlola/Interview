"""Auto-Apply: operator kill switches

Revision ID: 0019
Revises: 0018
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "aa_kill_switches",
        sa.Column("name", sa.String(60), primary_key=True),
        sa.Column("on", sa.Boolean, nullable=False),
        sa.Column("reason", sa.String(300), nullable=False),
        sa.Column(
            "set_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("set_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("aa_kill_switches")
