"""Explicit task dependency edges for delivery sequencing."""
from alembic import op
import sqlalchemy as sa

revision = "0032_task_dependencies"
down_revision = "0031_calendar_blocks"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "task_dependencies",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("predecessor_task_id", sa.String(length=36), sa.ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("successor_task_id", sa.String(length=36), sa.ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "predecessor_task_id", "successor_task_id", name="uq_task_dependency_edge"),
    )
    op.create_index("ix_task_dependencies_user_id", "task_dependencies", ["user_id"])
    op.create_index("ix_task_dependencies_project_id", "task_dependencies", ["project_id"])

def downgrade():
    op.drop_index("ix_task_dependencies_project_id", table_name="task_dependencies")
    op.drop_index("ix_task_dependencies_user_id", table_name="task_dependencies")
    op.drop_table("task_dependencies")
