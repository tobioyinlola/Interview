"""Startup outreach: the candidate's own email templates, their details, and when things go out

Additive: new columns on the candidate's startup-outreach settings.

Revision ID: 0040
Revises: 0039
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None

T = "aa_hunt_settings"


def upgrade() -> None:
    op.add_column(T, sa.Column("use_template", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column(
        T,
        sa.Column("template", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        T,
        sa.Column("variables", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        T, sa.Column("follow_up_enabled", sa.Boolean(), nullable=False, server_default=sa.true())
    )
    op.add_column(T, sa.Column("follow_up_days", sa.Integer(), nullable=False, server_default="5"))
    op.add_column(T, sa.Column("send_not_before", sa.DateTime(timezone=True), nullable=True))
    op.add_column(T, sa.Column("window_start", sa.Integer(), nullable=False, server_default="8"))
    op.add_column(T, sa.Column("window_end", sa.Integer(), nullable=False, server_default="18"))


def downgrade() -> None:
    for c in (
        "window_end", "window_start", "send_not_before", "follow_up_days",
        "follow_up_enabled", "variables", "template", "use_template",
    ):  # fmt: skip
        op.drop_column(T, c)
