"""Outreach has its own pause, apart from Auto-Apply's (which now pauses applications only); the
CV file as uploaded is kept, so that exact file is what employers receive

Additive: nullable columns only.

Revision ID: 0042
Revises: 0041
"""

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("aa_hunt_settings", sa.Column("outreach_paused_at", sa.DateTime(timezone=True)))
    op.add_column("notes", sa.Column("cv_file", sa.LargeBinary(), nullable=True))
    op.add_column("notes", sa.Column("cv_kind", sa.String(8), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "cv_kind")
    op.drop_column("notes", "cv_file")
    op.drop_column("aa_hunt_settings", "outreach_paused_at")
