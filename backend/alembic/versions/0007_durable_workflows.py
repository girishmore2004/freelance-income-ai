"""Add durable workflow runs and node checkpoints."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0007_durable_workflows"
down_revision = "0006_discovery_freshness"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())
    if "workflow_runs" not in tables:
        op.create_table(
            "workflow_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("opportunity_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("proposals.id", ondelete="SET NULL"), nullable=True),
            sa.Column("approval_id", sa.String(36), sa.ForeignKey("approvals.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(40), nullable=False, server_default="queued"),
            sa.Column("current_step", sa.String(80), nullable=False, server_default="queued"),
            sa.Column("state_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("proposed_price", sa.Float(), nullable=True),
            sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
            sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
    inspector = inspect(bind)
    indexes = {i["name"] for i in inspector.get_indexes("workflow_runs")}
    for name, column in [
        ("ix_workflow_runs_user_id", "user_id"),
        ("ix_workflow_runs_opportunity_id", "opportunity_id"),
        ("ix_workflow_runs_proposal_id", "proposal_id"),
        ("ix_workflow_runs_approval_id", "approval_id"),
        ("ix_workflow_runs_status", "status"),
    ]:
        if name not in indexes:
            op.create_index(name, "workflow_runs", [column])
    tables = set(inspect(bind).get_table_names())
    if "workflow_checkpoints" not in tables:
        op.create_table(
            "workflow_checkpoints",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("workflow_id", sa.String(36), sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("node_name", sa.String(80), nullable=False),
            sa.Column("state_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    indexes = {i["name"] for i in inspect(bind).get_indexes("workflow_checkpoints")}
    for name, column in [
        ("ix_workflow_checkpoints_workflow_id", "workflow_id"),
        ("ix_workflow_checkpoints_sequence", "sequence"),
    ]:
        if name not in indexes:
            op.create_index(name, "workflow_checkpoints", [column])

def downgrade():
    op.drop_table("workflow_checkpoints")
    op.drop_table("workflow_runs")
