"""Email links asked for by an installed app hand the person back to the app

Revision ID: 0022
Revises: 0021
"""

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("login_tokens", sa.Column("app_challenge", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("login_tokens", "app_challenge")
