"""Everyone reconnects their mailbox, now with an app password

Revision ID: 0029
Revises: 0028
"""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sends and reads for these people stop until they connect again; the page asks them to.
    op.execute("UPDATE aa_mailboxes SET status = 'reauth_needed' WHERE status = 'connected'")


def downgrade() -> None:
    pass
