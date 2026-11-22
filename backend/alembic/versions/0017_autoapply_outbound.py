"""Auto-Apply: mailbox connections, submission attempts, outreach

Revision ID: 0017
Revises: 0016
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _fk(col: str, target: str, **kw: object) -> sa.Column:
    return sa.Column(col, UUID, sa.ForeignKey(target, ondelete="CASCADE"), **kw)


def upgrade() -> None:
    op.add_column("aa_applications", sa.Column("not_before", TS))
    op.create_table(
        "aa_mailboxes",
        sa.Column("id", UUID, primary_key=True),
        _fk("user_id", "users.id", nullable=False, unique=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("address", sa.String(320), nullable=False),
        sa.Column("capabilities", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("token_encrypted", sa.Text),
        sa.Column("status", sa.String(14), nullable=False),
        sa.Column("cursor", sa.Text),
        sa.Column("last_synced_at", TS),
        sa.Column("connected_at", TS, nullable=False),
    )
    op.create_table(
        "aa_attempts",
        sa.Column("id", UUID, primary_key=True),
        _fk("user_id", "users.id", nullable=False),
        _fk("application_id", "aa_applications.id", nullable=False, index=True),
        sa.Column("channel", sa.String(8), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False, unique=True),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("local_day", sa.Date, nullable=False),
        sa.Column("provider_ref", sa.String(200)),
        sa.Column("thread_ref", sa.String(200)),
        sa.Column("receipt", JSONB),
        sa.Column("failure_class", sa.String(30)),
        sa.Column("failure_message", sa.Text),
        sa.Column("claimed_at", TS, nullable=False),
        sa.Column("dispatched_at", TS),
        sa.Column("finished_at", TS),
    )
    op.create_index("ix_aa_attempts_user_day", "aa_attempts", ["user_id", "local_day"])
    op.create_index("ix_aa_attempts_state", "aa_attempts", ["state"])
    op.create_table(
        "aa_outreach",
        sa.Column("id", UUID, primary_key=True),
        _fk("user_id", "users.id", nullable=False),
        _fk("posting_id", "aa_postings.id", nullable=False),
        sa.Column("application_id", UUID, sa.ForeignKey("aa_applications.id", ondelete="SET NULL")),
        sa.Column("recipient", sa.String(320), nullable=False),
        sa.Column("recipient_source", sa.String(20), nullable=False),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("reason", sa.String(300)),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("sent_at", TS),
        sa.UniqueConstraint("user_id", "posting_id"),
    )


def downgrade() -> None:
    for t in ("aa_outreach", "aa_attempts", "aa_mailboxes"):
        op.drop_table(t)
    op.drop_column("aa_applications", "not_before")
