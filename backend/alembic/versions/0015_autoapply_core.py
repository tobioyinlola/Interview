"""Auto-Apply: candidate facts, answers, search profile, campaigns

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _id() -> sa.Column:
    return sa.Column("id", UUID, primary_key=True)


def _user(unique: bool = False) -> sa.Column:
    return sa.Column(
        "user_id",
        UUID,
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=unique,
        index=not unique,
    )


def upgrade() -> None:
    op.create_table(
        "aa_candidate_facts",
        _id(),
        _user(unique=True),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("verified_at", TS),
        sa.Column("cv_hash", sa.String(64)),
        sa.Column("updated_at", TS, nullable=False),
    )
    op.create_table(
        "aa_answers",
        _id(),
        _user(),
        sa.Column("field", sa.String(60), nullable=False),
        sa.Column("question", sa.String(300), nullable=False),
        sa.Column("value", sa.Text, nullable=False),
        sa.Column("normalized", sa.String(200), nullable=False),
        sa.Column("provenance", sa.String(20), nullable=False),
        sa.Column("confirmed_at", TS),
        sa.Column("reusable", sa.Boolean, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.UniqueConstraint("user_id", "field"),
    )
    op.create_table(
        "aa_profiles",
        _id(),
        _user(unique=True),
        sa.Column("criteria", JSONB, nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("active_hours", JSONB, nullable=False),
        sa.Column("channels", JSONB, nullable=False),
        sa.Column("daily_application_cap", sa.Integer, nullable=False),
        sa.Column("daily_outreach_cap", sa.Integer, nullable=False),
        sa.Column("policy_version", sa.String(20)),
        sa.Column("authorized_at", TS),
        sa.Column("paused", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("paused_at", TS),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
    )
    op.create_table(
        "aa_campaigns",
        _id(),
        _user(),
        sa.Column(
            "profile_id", UUID, sa.ForeignKey("aa_profiles.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("activated_at", TS, nullable=False),
        sa.Column("ends_at", TS, nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("ended_at", TS),
        sa.Column("daily_application_cap", sa.Integer, nullable=False),
        sa.Column("daily_outreach_cap", sa.Integer, nullable=False),
        sa.Column("channels", JSONB, nullable=False),
        sa.Column("policy_version", sa.String(20), nullable=False),
        sa.Column("authorization", JSONB, nullable=False),
    )
    op.create_index(
        "uq_aa_campaign_active",
        "aa_campaigns",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    for t in ("aa_campaigns", "aa_profiles", "aa_answers", "aa_candidate_facts"):
        op.drop_table(t)
