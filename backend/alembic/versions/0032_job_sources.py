"""A registry of job boards read once for everyone, and which board each listing came from

Revision ID: 0032
Revises: 0031
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "aa_job_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("board", sa.String(120), nullable=False),
        sa.Column("company", sa.String(200), nullable=True),
        sa.Column("domain", sa.String(253), nullable=True),
        sa.Column("origin", sa.String(12), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("every_minutes", sa.Integer(), nullable=False),
        sa.Column("next_sync_at", TS, nullable=False),
        sa.Column("last_synced_at", TS, nullable=True),
        sa.Column("last_changed_at", TS, nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("jobs_listed", sa.Integer(), nullable=False),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("health", sa.String(10), nullable=False),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.UniqueConstraint("kind", "board"),
    )
    op.create_index("ix_aa_job_sources_due", "aa_job_sources", ["enabled", "next_sync_at"])
    op.add_column(
        "aa_posting_aliases",
        sa.Column(
            "job_source_id",
            UUID(as_uuid=True),
            sa.ForeignKey("aa_job_sources.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_aa_posting_aliases_job_source_id", "aa_posting_aliases", ["job_source_id"])


def downgrade() -> None:
    op.drop_index("ix_aa_posting_aliases_job_source_id", table_name="aa_posting_aliases")
    op.drop_column("aa_posting_aliases", "job_source_id")
    op.drop_table("aa_job_sources")
