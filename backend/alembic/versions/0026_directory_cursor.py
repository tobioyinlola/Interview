"""Where a long, paged directory was read up to

Revision ID: 0026
Revises: 0025
"""

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("aa_directories", sa.Column("cursor", sa.String(500)))


def downgrade() -> None:
    op.drop_column("aa_directories", "cursor")
