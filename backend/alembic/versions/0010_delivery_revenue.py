"""Add time tracking for delivery and revenue analytics."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0010_delivery_revenue"
down_revision = "0009_evidence_provenance"
branch_labels = None
depends_on = None

def upgrade():
    if "time_entries" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "time_entries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("task_id", sa.String(36), sa.ForeignKey("project_tasks.id", ondelete="SET NULL"), nullable=True),
            sa.Column("work_date", sa.String(10), nullable=False),
            sa.Column("duration_minutes", sa.Integer(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("billable", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("hourly_rate", sa.Float(), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_time_entries_user_id", "time_entries", ["user_id"])
        op.create_index("ix_time_entries_project_id", "time_entries", ["project_id"])
        op.create_index("ix_time_entries_task_id", "time_entries", ["task_id"])
        op.create_index("ix_time_entries_work_date", "time_entries", ["work_date"])

def downgrade():
    if "time_entries" in inspect(op.get_bind()).get_table_names():
        op.drop_table("time_entries")
