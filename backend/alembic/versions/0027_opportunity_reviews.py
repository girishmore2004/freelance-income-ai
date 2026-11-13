"""Add opportunity shortlist and review workflow."""
from alembic import op
import sqlalchemy as sa

revision = "0027_opportunity_reviews"
down_revision = "0026_client_cost_entries"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "opportunity_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("opportunity_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("decision", sa.String(30), nullable=False, server_default="saved"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("next_action_date", sa.String(10), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "opportunity_id", name="uq_user_opportunity_review"),
    )
    op.create_index("ix_opportunity_reviews_user_id", "opportunity_reviews", ["user_id"])
    op.create_index("ix_opportunity_reviews_opportunity_id", "opportunity_reviews", ["opportunity_id"])


def downgrade():
    op.drop_index("ix_opportunity_reviews_opportunity_id", table_name="opportunity_reviews")
    op.drop_index("ix_opportunity_reviews_user_id", table_name="opportunity_reviews")
    op.drop_table("opportunity_reviews")
