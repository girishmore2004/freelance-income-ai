"""Approved schedule plan snapshots, audit decisions and planned finish dates."""
from alembic import op
import sqlalchemy as sa

revision = "0033_schedule_plan_governance"
down_revision = "0032_task_dependencies"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("project_tasks", sa.Column("planned_finish_date", sa.String(length=10), nullable=False, server_default=""))
    op.create_table(
        "schedule_plan_versions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("before_after", sa.JSON(), nullable=False),
        sa.Column("decision_reason", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "version", name="uq_schedule_plan_user_version"),
    )
    op.create_index("ix_schedule_plan_versions_user_id", "schedule_plan_versions", ["user_id"])


def downgrade():
    op.drop_index("ix_schedule_plan_versions_user_id", table_name="schedule_plan_versions")
    op.drop_table("schedule_plan_versions")
    op.drop_column("project_tasks", "planned_finish_date")
