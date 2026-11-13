"""Add operational error metadata to durable agent workflows.
Revision ID: 0020_agent_workflow_operations
Revises: 0019_durable_agent_workflows
"""
from alembic import op
import sqlalchemy as sa
revision = "0020_agent_workflow_operations"
down_revision = "0019_durable_agent_workflows"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("agent_workflow_runs", sa.Column("error_code", sa.String(60), nullable=False, server_default=""))
    op.add_column("agent_workflow_runs", sa.Column("last_error_node", sa.String(80), nullable=False, server_default=""))

def downgrade():
    op.drop_column("agent_workflow_runs", "last_error_node")
    op.drop_column("agent_workflow_runs", "error_code")
