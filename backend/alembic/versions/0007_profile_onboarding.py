"""full name and onboarding on the user

Revision ID: 0007
Revises: 0006
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(length=120), nullable=True))
    op.add_column(
        "users", sa.Column("onboarding", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column("users", sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("login_tokens", sa.Column("full_name", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("login_tokens", "full_name")
    op.drop_column("users", "onboarded_at")
    op.drop_column("users", "onboarding")
    op.drop_column("users", "full_name")
