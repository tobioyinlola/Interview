"""Optional bio data on the account

Revision ID: 0020
Revises: 0019
"""

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(30)))
    op.add_column("users", sa.Column("location", sa.String(120)))
    op.add_column("users", sa.Column("headline", sa.String(120)))
    op.add_column("users", sa.Column("linkedin_url", sa.String(300)))


def downgrade() -> None:
    for c in ("linkedin_url", "headline", "location", "phone"):
        op.drop_column("users", c)
