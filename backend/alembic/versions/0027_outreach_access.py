"""Startup outreach by invitation: who asked, who the operator switched it on for

Revision ID: 0027
Revises: 0026
"""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("outreach_access", sa.String(12), nullable=False, server_default="none"),
    )
    op.add_column("users", sa.Column("outreach_requested_at", sa.DateTime(timezone=True)))
    # people who already set outreach up keep it
    op.execute(
        "UPDATE users SET outreach_access = 'active' "
        "WHERE id IN (SELECT user_id FROM aa_hunt_settings)"
    )


def downgrade() -> None:
    op.drop_column("users", "outreach_requested_at")
    op.drop_column("users", "outreach_access")
