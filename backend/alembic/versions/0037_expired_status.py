"""Applications whose listing expired get their own status

Data only. Roles that were skipped because the listing's own end date had passed (at matching or
just before sending) move from "skipped" to "expired". Nothing about the table changes.

Revision ID: 0037
Revises: 0036
"""

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE aa_applications SET status = 'expired' "
        "WHERE status = 'skipped' "
        "AND skip_reason IN ('The listing has expired.', 'The listing expired.')"
    )


def downgrade() -> None:
    op.execute("UPDATE aa_applications SET status = 'skipped' WHERE status = 'expired'")
