"""Record task completion timestamps for delivery variance analysis."""
from alembic import op
import sqlalchemy as sa

revision = "0034_task_completion_tracking"
down_revision = "0033_schedule_plan_governance"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("project_tasks", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("project_tasks", "completed_at")
