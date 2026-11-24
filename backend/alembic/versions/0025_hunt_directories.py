"""The accelerator directories startup outreach reads from

Revision ID: 0025
Revises: 0024
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "aa_directories",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("region_hint", sa.String(8), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("builtin", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("last_run_at", sa.DateTime(timezone=True)),
        sa.Column("last_found", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_added", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_problem", sa.String(300)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("aa_directories")
