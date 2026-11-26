"""Every CV is drawn in one house layout, so the per-upload layout profile goes

Revision ID: 0038
Revises: 0037
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("notes", "cv_layout")


def downgrade() -> None:
    op.add_column("notes", sa.Column("cv_layout", postgresql.JSONB(), nullable=True))
