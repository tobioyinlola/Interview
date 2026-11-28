"""Startup outreach: how far to reach, sending that pauses itself, mail checks and replies

Additive: new columns only.

Revision ID: 0041
Revises: 0040
"""

import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    s = "aa_hunt_settings"
    op.add_column(s, sa.Column("reach", sa.String(10), nullable=False, server_default="most"))
    op.add_column(s, sa.Column("auto_paused_at", TS, nullable=True))
    op.add_column(s, sa.Column("auto_pause_reason", sa.String(300), nullable=True))
    op.add_column(s, sa.Column("health_since", TS, nullable=True))
    c = "aa_startup_contacts"
    op.add_column(c, sa.Column("mx_ok", sa.Boolean(), nullable=True))
    op.add_column(c, sa.Column("mx_checked_at", TS, nullable=True))
    t = "aa_hunt_targets"
    op.add_column(t, sa.Column("source", sa.String(10), nullable=False, server_default="written"))
    op.add_column(t, sa.Column("replied_at", TS, nullable=True))
    op.add_column(t, sa.Column("reply_kind", sa.String(10), nullable=True))


def downgrade() -> None:
    for t, cols in (
        ("aa_hunt_targets", ("reply_kind", "replied_at", "source")),
        ("aa_startup_contacts", ("mx_checked_at", "mx_ok")),
        ("aa_hunt_settings", ("health_since", "auto_pause_reason", "auto_paused_at", "reach")),
    ):
        for c in cols:
            op.drop_column(t, c)
