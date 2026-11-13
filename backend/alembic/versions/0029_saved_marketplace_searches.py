"""Add per-user scheduled marketplace search preferences."""
from alembic import op
import sqlalchemy as sa

revision = "0029_saved_marketplace_searches"
down_revision = "0028_marketplace_credential_vault"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_marketplace_searches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False, server_default="upwork"),
        sa.Column("search_term", sa.String(160), nullable=False),
        sa.Column("result_limit", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("interval_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "provider", "search_term", name="uq_user_provider_saved_search"),
    )
    op.create_index("ix_saved_marketplace_searches_user_id", "saved_marketplace_searches", ["user_id"])
    op.create_index("ix_saved_marketplace_searches_next_run_at", "saved_marketplace_searches", ["next_run_at"])


def downgrade():
    op.drop_index("ix_saved_marketplace_searches_next_run_at", table_name="saved_marketplace_searches")
    op.drop_index("ix_saved_marketplace_searches_user_id", table_name="saved_marketplace_searches")
    op.drop_table("saved_marketplace_searches")
