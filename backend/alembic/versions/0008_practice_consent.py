"""standing practice consent on the user

Revision ID: 0008
Revises: 0007
"""

from alembic import op
import sqlalchemy as sa


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("practice_consent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column("consent_each_time", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "login_tokens",
        sa.Column("partner_consent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("login_tokens", "partner_consent")
    op.drop_column("users", "consent_each_time")
    op.drop_column("users", "practice_consent_at")
