"""Add grounded business coach interaction history.

Revision ID: 0018_grounded_business_coach
Revises: 0017_business_workspace
"""
from alembic import op
import sqlalchemy as sa
revision = "0018_grounded_business_coach"
down_revision = "0017_business_workspace"
branch_labels = None
depends_on = None
def upgrade():
    op.create_table("coach_interactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("sources_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("generation_mode", sa.String(40), nullable=False, server_default="rules_fallback"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_coach_interactions_user_id", "coach_interactions", ["user_id"])
    op.create_index("ix_coach_interactions_created_at", "coach_interactions", ["created_at"])
def downgrade():
    op.drop_index("ix_coach_interactions_created_at", table_name="coach_interactions")
    op.drop_index("ix_coach_interactions_user_id", table_name="coach_interactions")
    op.drop_table("coach_interactions")
