"""cv upload: remember the file name and when it was uploaded

Revision ID: 0006
Revises: 0005
"""

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("cv_filename", sa.String(length=255), nullable=True))
    op.add_column("notes", sa.Column("cv_uploaded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("notes", "cv_uploaded_at")
    op.drop_column("notes", "cv_filename")
