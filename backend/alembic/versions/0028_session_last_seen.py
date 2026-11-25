"""Sign people out after a stretch of inactivity: remember when a session was last used

Revision ID: 0028
Revises: 0027
"""

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_sessions",
        sa.Column(
            "last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_column("auth_sessions", "last_seen_at")
