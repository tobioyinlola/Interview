"""Auto-Apply: postings, aliases, discovery runs, applications

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _fk(col: str, target: str, **kw: object) -> sa.Column:
    return sa.Column(col, UUID, sa.ForeignKey(target, ondelete="CASCADE"), **kw)


def upgrade() -> None:
    op.create_table(
        "aa_postings",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("canonical_key", sa.String(400), nullable=False, unique=True),
        sa.Column("company", sa.String(160), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("requisition_id", sa.String(120)),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("region", sa.String(200)),
        sa.Column("arrangement", sa.String(10)),
        sa.Column("contract", sa.String(12)),
        sa.Column("seniority", sa.String(12)),
        sa.Column("industry", sa.String(80)),
        sa.Column("salary_min", sa.Float),
        sa.Column("salary_max", sa.Float),
        sa.Column("salary_currency", sa.String(3)),
        sa.Column("salary_period", sa.String(6)),
        sa.Column("sponsorship", sa.String(12)),
        sa.Column("posted_at", TS),
        sa.Column("expires_at", TS),
        sa.Column("application_url", sa.Text),
        sa.Column("apply_email", sa.String(320)),
        sa.Column("apply_instructions", sa.Text, nullable=False),
        sa.Column("hiring_contact", sa.String(320)),
        sa.Column("questions", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("evidence", JSONB, nullable=False),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("last_seen_at", TS, nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )
    op.create_table(
        "aa_posting_aliases",
        sa.Column("id", UUID, primary_key=True),
        _fk("posting_id", "aa_postings.id", nullable=False, index=True),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("source_url", sa.Text, nullable=False, unique=True),
        sa.Column("seen_at", TS, nullable=False),
    )
    op.create_table(
        "aa_discovery_runs",
        sa.Column("id", UUID, primary_key=True),
        _fk("user_id", "users.id", nullable=False, index=True),
        _fk("campaign_id", "aa_campaigns.id", nullable=False, index=True),
        sa.Column("local_day", sa.Date, nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("found", sa.Integer, nullable=False),
        sa.Column("new", sa.Integer, nullable=False),
        sa.Column("eligible", sa.Integer, nullable=False),
        sa.Column("needs_input", sa.Integer, nullable=False),
        sa.Column("skipped", sa.Integer, nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("started_at", TS, nullable=False),
        sa.Column("finished_at", TS),
        sa.UniqueConstraint("user_id", "local_day"),
    )
    op.create_table(
        "aa_applications",
        sa.Column("id", UUID, primary_key=True),
        _fk("user_id", "users.id", nullable=False),
        _fk("posting_id", "aa_postings.id", nullable=False),
        sa.Column("campaign_id", UUID, sa.ForeignKey("aa_campaigns.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(22), nullable=False),
        sa.Column("channel", sa.String(8)),
        sa.Column("match", JSONB, nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("needs_input", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("answers", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("package", JSONB),
        sa.Column("package_frozen_at", TS),
        sa.Column("profile_version", sa.Integer, nullable=False),
        sa.Column("skip_reason", sa.String(300)),
        sa.Column("recruiting_stage", sa.String(20)),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.UniqueConstraint("user_id", "posting_id"),
    )
    op.create_index("ix_aa_applications_user_status", "aa_applications", ["user_id", "status"])
    op.create_table(
        "aa_application_events",
        sa.Column("id", UUID, primary_key=True),
        _fk("application_id", "aa_applications.id", nullable=False, index=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("detail", JSONB, nullable=False),
        sa.Column("created_at", TS, nullable=False),
    )


def downgrade() -> None:
    for t in (
        "aa_application_events",
        "aa_applications",
        "aa_discovery_runs",
        "aa_posting_aliases",
        "aa_postings",
    ):
        op.drop_table(t)
