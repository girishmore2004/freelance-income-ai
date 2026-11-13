
"""Record task completion timestamps for delivery variance analysis."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0034_task_completion_tracking"
down_revision = "0033_schedule_plan_governance"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())

    if "project_tasks" not in inspector.get_table_names():
        raise RuntimeError("Required table 'project_tasks' does not exist.")

    columns = {
        column["name"]
        for column in inspector.get_columns("project_tasks")
    }

    if "completed_at" not in columns:
        op.add_column(
            "project_tasks",
            sa.Column(
                "completed_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )


def downgrade():
    # Preserve task completion timestamps.
    pass
