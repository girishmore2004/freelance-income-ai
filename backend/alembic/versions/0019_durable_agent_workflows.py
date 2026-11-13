"""Add durable multi-agent workflow runs and checkpoints.

Revision ID: 0019_durable_agent_workflows
Revises: 0018_grounded_business_coach
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_durable_agent_workflows"
down_revision = "0018_grounded_business_coach"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agent_workflow_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_type", sa.String(40), nullable=False, server_default="business_review"),
        sa.Column("idempotency_key", sa.String(100), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="queued"),
        sa.Column("current_step", sa.String(80), nullable=False, server_default="queued"),
        sa.Column("state_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_agent_workflow_user_idempotency"),
    )
    op.create_index("ix_agent_workflow_runs_user_id", "agent_workflow_runs", ["user_id"])
    op.create_index("ix_agent_workflow_runs_status", "agent_workflow_runs", ["status"])
    op.create_table(
        "agent_workflow_checkpoints",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workflow_id", sa.String(36), sa.ForeignKey("agent_workflow_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("node_name", sa.String(80), nullable=False),
        sa.Column("state_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workflow_id", "sequence", name="uq_agent_workflow_checkpoint_sequence"),
    )
    op.create_index("ix_agent_workflow_checkpoints_workflow_id", "agent_workflow_checkpoints", ["workflow_id"])


def downgrade():
    op.drop_index("ix_agent_workflow_checkpoints_workflow_id", table_name="agent_workflow_checkpoints")
    op.drop_table("agent_workflow_checkpoints")
    op.drop_index("ix_agent_workflow_runs_status", table_name="agent_workflow_runs")
    op.drop_index("ix_agent_workflow_runs_user_id", table_name="agent_workflow_runs")
    op.drop_table("agent_workflow_runs")
