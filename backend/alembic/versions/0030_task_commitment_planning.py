
"""Add explicit task effort and planned start for workload planning."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0030_task_commitment_planning"
down_revision = "0029_saved_marketplace_searches"
branch_labels = None
depends_on = None


def _columns(table_name):
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        raise RuntimeError(f"Required table {table_name!r} does not exist.")

    return {
        column["name"]
        for column in inspector.get_columns(table_name)
    }


def upgrade():
    existing = _columns("project_tasks")

    if "estimated_hours" not in existing:
        op.add_column(
            "project_tasks",
            sa.Column("estimated_hours", sa.Float(), nullable=True),
        )

    existing = _columns("project_tasks")

    if "planned_start_date" not in existing:
        op.add_column(
            "project_tasks",
            sa.Column(
                "planned_start_date",
                sa.String(length=10),
                nullable=False,
                server_default="",
            ),
        )


def downgrade():
    # Preserve planning data. Columns may have been created by the initial
    # metadata baseline before this migration was reached.
    pass
