"""Add business goals and workspace audit events.

Revision ID: 0017_business_workspace
Revises: 0016_project_opportunity_attribution
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_business_workspace"
down_revision = "0016_proj_opp_attr"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "business_goals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("monthly_income_target", sa.Float(), nullable=False, server_default="0"),
        sa.Column("weekly_hours_target", sa.Float(), nullable=False, server_default="10"),
        sa.Column("monthly_proposals_target", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("monthly_outreach_target", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_business_goals_user_id", "business_goals", ["user_id"])
    op.create_table(
        "business_workspace_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("entity_type", sa.String(60), nullable=False, server_default=""),
        sa.Column("entity_id", sa.String(36), nullable=False, server_default=""),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_business_workspace_events_user_id", "business_workspace_events", ["user_id"])
    op.create_index("ix_business_workspace_events_event_type", "business_workspace_events", ["event_type"])
    op.create_index("ix_business_workspace_events_created_at", "business_workspace_events", ["created_at"])


def downgrade():
    op.drop_index("ix_business_workspace_events_created_at", table_name="business_workspace_events")
    op.drop_index("ix_business_workspace_events_event_type", table_name="business_workspace_events")
    op.drop_index("ix_business_workspace_events_user_id", table_name="business_workspace_events")
    op.drop_table("business_workspace_events")
    op.drop_index("ix_business_goals_user_id", table_name="business_goals")
    op.drop_table("business_goals")
