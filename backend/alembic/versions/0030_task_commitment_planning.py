"""Add explicit task effort and planned start for forward workload planning."""
from alembic import op
import sqlalchemy as sa

revision = "0030_task_commitment_planning"
down_revision = "0029_saved_marketplace_searches"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("project_tasks", sa.Column("estimated_hours", sa.Float(), nullable=True))
    op.add_column("project_tasks", sa.Column("planned_start_date", sa.String(length=10), nullable=False, server_default=""))


def downgrade():
    op.drop_column("project_tasks", "planned_start_date")
    op.drop_column("project_tasks", "estimated_hours")
