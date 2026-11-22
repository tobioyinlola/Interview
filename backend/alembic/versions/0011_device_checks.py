"""device checks for invites: devices seen per account, and held referrals

Revision ID: 0011
Revises: 0010
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for col in ("device_cookie_hash", "device_print_hash", "device_ip_hash"):
        op.add_column("login_tokens", sa.Column(col, sa.String(length=64), nullable=True))
    op.add_column(
        "referrals",
        sa.Column("status", sa.String(length=10), nullable=False, server_default="counted"),
    )
    op.add_column("referrals", sa.Column("held_reason", sa.String(length=30), nullable=True))
    op.create_table(
        "user_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cookie_hash", sa.String(length=64), nullable=True),
        sa.Column("print_hash", sa.String(length=64), nullable=True),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_devices_user_id", "user_devices", ["user_id"])


def downgrade() -> None:
    op.drop_table("user_devices")
    op.drop_column("referrals", "held_reason")
    op.drop_column("referrals", "status")
    for col in ("device_ip_hash", "device_print_hash", "device_cookie_hash"):
        op.drop_column("login_tokens", col)
