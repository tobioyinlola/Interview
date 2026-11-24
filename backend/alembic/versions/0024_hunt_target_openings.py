"""Startup notes carry the matching openings found on the startup's careers page

Revision ID: 0024
Revises: 0023
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aa_hunt_targets",
        sa.Column("openings", pg.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("aa_hunt_targets", "openings")
