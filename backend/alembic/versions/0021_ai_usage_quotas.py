"""Persist per-user AI usage and quota abuse events.
Revision ID: 0021_ai_usage_quotas
Revises: 0020_agent_workflow_operations
"""
from alembic import op
import sqlalchemy as sa
revision = "0021_ai_usage_quotas"
down_revision = "0020_agent_workflow_operations"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "ai_usage_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("input_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_usage_events_user_id", "ai_usage_events", ["user_id"])
    op.create_index("ix_ai_usage_events_created_at", "ai_usage_events", ["created_at"])
    op.create_table(
        "abuse_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("detail", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_abuse_events_user_id", "abuse_events", ["user_id"])
    op.create_index("ix_abuse_events_event_type", "abuse_events", ["event_type"])
    op.create_index("ix_abuse_events_created_at", "abuse_events", ["created_at"])

def downgrade():
    op.drop_index("ix_abuse_events_created_at", table_name="abuse_events")
    op.drop_index("ix_abuse_events_event_type", table_name="abuse_events")
    op.drop_index("ix_abuse_events_user_id", table_name="abuse_events")
    op.drop_table("abuse_events")
    op.drop_index("ix_ai_usage_events_created_at", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_user_id", table_name="ai_usage_events")
    op.drop_table("ai_usage_events")
