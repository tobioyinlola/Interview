"""passwords, token purposes, login failures

Revision ID: 0005
Revises: 0004
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.Text(), nullable=True))
    op.add_column(
        "login_tokens",
        sa.Column("purpose", sa.String(length=10), server_default="login", nullable=False),
    )
    op.add_column("login_tokens", sa.Column("password_hash", sa.Text(), nullable=True))
    op.create_table(
        "login_failures",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_failures_email_created", "login_failures", ["email", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_login_failures_email_created", table_name="login_failures")
    op.drop_table("login_failures")
    op.drop_column("login_tokens", "password_hash")
    op.drop_column("login_tokens", "purpose")
    op.drop_column("users", "password_hash")
