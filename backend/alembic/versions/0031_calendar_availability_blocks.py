"""User-entered calendar availability blocks.

Revision ID: 0031_calendar_availability_blocks
Revises: 0030_task_commitment_planning
"""
from alembic import op
import sqlalchemy as sa

revision = "0031_calendar_availability_blocks"
down_revision = "0030_task_commitment_planning"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "calendar_availability_blocks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block_date", sa.String(length=10), nullable=False),
        sa.Column("unavailable_hours", sa.Float(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(length=30), nullable=False, server_default="personal"),
        sa.Column("note", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_calendar_availability_blocks_user_id", "calendar_availability_blocks", ["user_id"])
    op.create_index("ix_calendar_availability_blocks_block_date", "calendar_availability_blocks", ["block_date"])

def downgrade():
    op.drop_index("ix_calendar_availability_blocks_block_date", table_name="calendar_availability_blocks")
    op.drop_index("ix_calendar_availability_blocks_user_id", table_name="calendar_availability_blocks")
    op.drop_table("calendar_availability_blocks")
