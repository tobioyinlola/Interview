"""session credits (free trial, referral rewards) and referrals

Revision ID: 0010
Revises: 0009
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("referral_code", sa.String(length=16), nullable=True))
    op.add_column("login_tokens", sa.Column("referral_code", sa.String(length=16), nullable=True))
    op.create_table(
        "referrals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "referrer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "referred_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_referrals_referrer_id", "referrals", ["referrer_id"])
    op.create_table(
        "session_credits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_session_credits_user_id", "session_credits", ["user_id"])
    # Everyone who already has an account gets an invite code and their free trial session.
    op.execute(
        "UPDATE users SET referral_code = substr(md5(random()::text || id::text), 1, 10) "
        "WHERE referral_code IS NULL"
    )
    op.create_unique_constraint("uq_users_referral_code", "users", ["referral_code"])
    op.execute(
        "INSERT INTO session_credits (id, user_id, kind, created_at) "
        "SELECT gen_random_uuid(), id, 'trial', now() FROM users"
    )


def downgrade() -> None:
    op.drop_table("session_credits")
    op.drop_table("referrals")
    op.drop_constraint("uq_users_referral_code", "users", type_="unique")
    op.drop_column("login_tokens", "referral_code")
    op.drop_column("users", "referral_code")
