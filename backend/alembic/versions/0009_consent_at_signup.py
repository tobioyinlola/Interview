"""consent is agreed once, at sign-up; drop the per-session leftovers

Revision ID: 0009
Revises: 0008
"""

from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Everyone who already has an account agreed to the terms (which carry the partner rule) when
    # they made it; record that. People who started sessions also ticked the box each time.
    op.execute(
        "UPDATE users SET practice_consent_at = created_at WHERE practice_consent_at IS NULL"
    )
    op.drop_column("users", "consent_each_time")
    op.drop_column("login_tokens", "partner_consent")


def downgrade() -> None:
    op.add_column(
        "login_tokens",
        sa.Column("partner_consent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("consent_each_time", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
