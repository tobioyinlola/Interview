"""where accounts came from, for the admin marketing view

Revision ID: 0014
Revises: 0013
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("attribution", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column(
        "login_tokens",
        sa.Column("attribution", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    # Accounts that already exist: we know how they signed up only if they have a password.
    op.execute(
        "UPDATE users SET attribution = jsonb_build_object("
        "'method', CASE WHEN password_hash IS NULL THEN 'unknown' ELSE 'password' END, "
        "'referred', EXISTS (SELECT 1 FROM referrals r WHERE r.referred_id = users.id))"
    )


def downgrade() -> None:
    op.drop_column("login_tokens", "attribution")
    op.drop_column("users", "attribution")
