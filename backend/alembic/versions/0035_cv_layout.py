"""The look of the uploaded CV, kept as a small style profile

Additive. People who uploaded before this have no profile until they upload again; their tailored
CVs keep the plain look until then.

Revision ID: 0035
Revises: 0034
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("cv_layout", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "cv_layout")
