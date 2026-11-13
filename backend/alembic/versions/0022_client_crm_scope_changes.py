"""Add client CRM and project scope change approvals.

Revision ID: 0022_client_crm_scope
Revises: 0021_ai_usage_quotas
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_client_crm_scope"
down_revision = "0021_ai_usage_quotas"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "clients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("company", sa.String(200), nullable=False, server_default=""),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(40), nullable=False, server_default=""),
        sa.Column("website", sa.String(1200), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(30), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "email", name="uq_client_user_email"),
    )
    op.create_index("ix_clients_user_id", "clients", ["user_id"])
    op.add_column("projects", sa.Column("client_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_projects_client_id_clients", "projects", "clients",
        ["client_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_projects_client_id", "projects", ["client_id"])
    op.create_table(
        "scope_change_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("budget_delta", sa.Float(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("timeline_delta_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("client_accepted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("client_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_scope_change_requests_user_id", "scope_change_requests", ["user_id"])
    op.create_index("ix_scope_change_requests_project_id", "scope_change_requests", ["project_id"])


def downgrade():
    op.drop_index("ix_scope_change_requests_project_id", table_name="scope_change_requests")
    op.drop_index("ix_scope_change_requests_user_id", table_name="scope_change_requests")
    op.drop_table("scope_change_requests")
    op.drop_index("ix_projects_client_id", table_name="projects")
    op.drop_constraint("fk_projects_client_id_clients", "projects", type_="foreignkey")
    op.drop_column("projects", "client_id")
    op.drop_index("ix_clients_user_id", table_name="clients")
    op.drop_table("clients")
